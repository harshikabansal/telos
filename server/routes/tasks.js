import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { HttpError, notFound, wrap } from '../middleware.js';
import { ownedReference, requireOwned } from '../ownership.js';
import {
  PRIORITIES, REMINDER_OFFSETS, TASK_STATUSES,
  bool, dateOnly, ensureObject, enumValue, int, linkArray,
  recurrence as vRecurrence, requireId, str, stringArray, timeOnly,
} from '../validate.js';
import { serializeSubtask, serializeTask } from '../serialize.js';
import {
  addDays, classify, focusScore, clockFor, nextOccurrence, recordCompletion, todayFor,
} from '../domain.js';
import { syncTaskReminder } from './reminders.js';
import { completeTask } from '../services/tasks.js';

const router = express.Router();

const TASK_SELECT = `
  SELECT t.*,
         p.name  AS project_name,
         a.name  AS area_name,
         o.title AS objective_title,
         m.title AS milestone_title,
         (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
         (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
  FROM tasks t
  LEFT JOIN projects   p ON p.id = t.project_id
  LEFT JOIN areas      a ON a.id = t.area_id
  LEFT JOIN objectives o ON o.id = t.objective_id
  LEFT JOIN milestones m ON m.id = t.milestone_id
`;

const getTaskRow = (id, userId) =>
  db.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.user_id = ?`).get(id, userId);

/* ------------------------------------------------------------------ *
 * Listing
 * ------------------------------------------------------------------ */

router.get(
  '/',
  wrap(async (req, res) => {
    const userId = req.user.id;
    const today = todayFor(req.user.timezone);
    const now = clockFor(req.user.timezone);
    const q = req.query;

    // Predicates are assembled from a fixed vocabulary; user input only ever
    // enters as a bound parameter.
    const where = ['t.user_id = ?'];
    const params = [userId];

    const view = typeof q.view === 'string' ? q.view : 'all';
    switch (view) {
      case 'today':
        where.push(`t.status IN ('not_started','in_progress') AND t.due_date IS NOT NULL AND t.due_date <= ?`);
        params.push(today);
        break;
      case 'overdue':
        where.push(`t.status IN ('not_started','in_progress') AND t.due_date IS NOT NULL AND t.due_date < ?`);
        params.push(today);
        break;
      case 'upcoming':
        where.push(`t.status IN ('not_started','in_progress') AND t.due_date IS NOT NULL AND t.due_date > ?`);
        params.push(today);
        break;
      case 'next7':
        where.push(`t.status IN ('not_started','in_progress') AND t.due_date BETWEEN ? AND ?`);
        params.push(today, addDays(today, 7));
        break;
      case 'next30':
        where.push(`t.status IN ('not_started','in_progress') AND t.due_date BETWEEN ? AND ?`);
        params.push(today, addDays(today, 30));
        break;
      case 'important':
        where.push(`t.status IN ('not_started','in_progress') AND (t.important = 1 OR t.priority = 'urgent')`);
        break;
      case 'meaningful':
        where.push(`t.status IN ('not_started','in_progress') AND (t.meaningful = 1 OR t.objective_id IS NOT NULL)`);
        break;
      case 'recurring':
        where.push(`t.recurrence IS NOT NULL`);
        break;
      case 'completed':
        where.push(`t.status = 'completed'`);
        break;
      case 'unscheduled':
        where.push(`t.status IN ('not_started','in_progress') AND t.due_date IS NULL`);
        break;
      case 'active':
        where.push(`t.status IN ('not_started','in_progress')`);
        break;
      default:
        break;
    }

    if (q.status) {
      where.push(`t.status = ?`);
      params.push(enumValue(q.status, TASK_STATUSES, 'Status'));
    }
    if (q.priority) {
      where.push(`t.priority = ?`);
      params.push(enumValue(q.priority, PRIORITIES, 'Priority'));
    }
    if (q.projectId) {
      where.push(`t.project_id = ?`);
      params.push(requireId(q.projectId, 'Project'));
    }
    if (q.areaId) {
      where.push(`t.area_id = ?`);
      params.push(requireId(q.areaId, 'Area'));
    }
    if (q.objectiveId) {
      where.push(`t.objective_id = ?`);
      params.push(requireId(q.objectiveId, 'Objective'));
    }
    if (q.milestoneId) {
      where.push(`t.milestone_id = ?`);
      params.push(requireId(q.milestoneId, 'Milestone'));
    }
    if (q.from) {
      where.push(`t.due_date >= ?`);
      params.push(dateOnly(q.from, 'From date'));
    }
    if (q.to) {
      where.push(`t.due_date <= ?`);
      params.push(dateOnly(q.to, 'To date'));
    }
    if (q.important === 'true') where.push(`t.important = 1`);
    if (q.tag) {
      where.push(`t.tags LIKE ?`);
      params.push(`%"${str(q.tag, 'Tag', { max: 40 })}"%`);
    }
    if (q.q) {
      const term = `%${str(q.q, 'Search', { max: 120 })}%`;
      where.push(`(t.title LIKE ? OR t.description LIKE ? OR t.notes LIKE ?)`);
      params.push(term, term, term);
    }

    const limit = Math.min(500, Math.max(1, Number.parseInt(q.limit ?? '300', 10) || 300));
    const offset = Math.max(0, Number.parseInt(q.offset ?? '0', 10) || 0);

    const ORDERS = {
      due: `t.due_date IS NULL, t.due_date ASC, t.due_time IS NULL, t.due_time ASC`,
      priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.due_date IS NULL, t.due_date ASC`,
      created: `t.created_at DESC`,
      updated: `t.updated_at DESC`,
      title: `t.title COLLATE NOCASE ASC`,
      status: `CASE t.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, t.due_date IS NULL, t.due_date ASC`,
      manual: `t.position ASC, t.created_at ASC`,
      completed: `t.completed_at DESC`,
    };
    const sortKey = typeof q.sort === 'string' && ORDERS[q.sort] ? q.sort : 'due';

    const rows = db
      .prepare(`${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${ORDERS[sortKey]} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    let tasks = rows.map((row) => ({
      ...serializeTask(row),
      ...classify(row, today),
      focus: focusScore(row, today, now),
    }));

    if (q.sort === 'focus' || (!q.sort && view === 'today')) {
      tasks.sort((a, b) => b.focus - a.focus);
    }

    res.json({ tasks, total: tasks.length, today });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Responsibility');
    const row = getTaskRow(id, req.user.id);
    if (!row) throw notFound('Responsibility not found.');
    const subtasks = db
      .prepare(`SELECT * FROM subtasks WHERE task_id = ? AND user_id = ? ORDER BY position ASC`)
      .all(id, req.user.id);
    const today = todayFor(req.user.timezone);
    res.json({ task: { ...serializeTask(row, { subtasks }), ...classify(row, today) } });
  })
);

/* ------------------------------------------------------------------ *
 * Create
 * ------------------------------------------------------------------ */

function readTaskInput(body, user, { partial = false } = {}) {
  const userId = user.id;
  const fields = {};
  const has = (key) => body[key] !== undefined;

  if (!partial || has('title')) {
    fields.title = str(body.title, 'Title', { min: 1, max: 200, required: !partial });
  }
  if (has('description')) fields.description = str(body.description, 'Description', { max: 4000 }) ?? '';
  if (has('notes')) fields.notes = str(body.notes, 'Notes', { max: 20000 }) ?? '';
  if (has('startDate')) fields.start_date = dateOnly(body.startDate, 'Start date');
  if (has('dueDate')) fields.due_date = dateOnly(body.dueDate, 'Due date');
  if (has('dueTime')) fields.due_time = timeOnly(body.dueTime, 'Due time');
  if (has('priority') || !partial) {
    fields.priority = enumValue(body.priority, PRIORITIES, 'Priority', user.default_priority);
  }
  if (has('important')) fields.important = bool(body.important) ? 1 : 0;
  if (has('meaningful')) fields.meaningful = bool(body.meaningful) ? 1 : 0;
  if (has('status')) fields.status = enumValue(body.status, TASK_STATUSES, 'Status');
  if (has('tags')) fields.tags = JSON.stringify(stringArray(body.tags, 'Tags') ?? []);
  if (has('links')) fields.links = JSON.stringify(linkArray(body.links) ?? []);
  if (has('recurrence')) {
    const rule = vRecurrence(body.recurrence);
    fields.recurrence = rule ? JSON.stringify(rule) : null;
  }
  if (has('recurrenceEnd')) fields.recurrence_end = dateOnly(body.recurrenceEnd, 'Recurrence end');
  if (has('reminder') || !partial) {
    fields.reminder = enumValue(body.reminder, REMINDER_OFFSETS, 'Reminder', user.default_reminder || 'none');
  }
  if (has('estimatedMinutes')) {
    fields.estimated_minutes = int(body.estimatedMinutes, 'Estimated duration', { min: 0, max: 100000 });
  }
  if (has('actualMinutes')) {
    fields.actual_minutes = int(body.actualMinutes, 'Actual duration', { min: 0, max: 100000 });
  }
  if (has('position')) fields.position = int(body.position, 'Position', { min: 0, max: 100000 }) ?? 0;

  if (has('projectId')) fields.project_id = ownedReference(body.projectId, 'projects', userId, 'Project');
  if (has('milestoneId')) fields.milestone_id = ownedReference(body.milestoneId, 'milestones', userId, 'Milestone');
  if (has('objectiveId')) fields.objective_id = ownedReference(body.objectiveId, 'objectives', userId, 'Objective');
  if (has('areaId')) fields.area_id = ownedReference(body.areaId, 'areas', userId, 'Area');

  if (fields.start_date && fields.due_date && fields.start_date > fields.due_date) {
    throw new HttpError(400, 'The start date cannot fall after the due date.');
  }
  return fields;
}

/**
 * When a responsibility sits inside a project, it inherits the project's
 * objective, milestone and area unless it states its own.
 */
function inheritFromProject(fields, userId) {
  if (!fields.project_id) return fields;
  const project = db
    .prepare(`SELECT * FROM projects WHERE id = ? AND user_id = ?`)
    .get(fields.project_id, userId);
  if (!project) return fields;
  if (fields.objective_id == null) fields.objective_id = project.objective_id;
  if (fields.milestone_id == null) fields.milestone_id = project.milestone_id;
  if (fields.area_id == null) fields.area_id = project.area_id;
  return fields;
}

router.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const fields = inheritFromProject(readTaskInput(body, req.user), req.user.id);
    const now = nowIso();
    const id = newId();

    const record = {
      id,
      user_id: req.user.id,
      title: fields.title,
      description: fields.description ?? '',
      notes: fields.notes ?? '',
      project_id: fields.project_id ?? null,
      milestone_id: fields.milestone_id ?? null,
      objective_id: fields.objective_id ?? null,
      area_id: fields.area_id ?? null,
      start_date: fields.start_date ?? null,
      due_date: fields.due_date ?? null,
      due_time: fields.due_time ?? null,
      priority: fields.priority,
      important: fields.important ?? 0,
      meaningful: fields.meaningful ?? 0,
      status: fields.status ?? 'not_started',
      tags: fields.tags ?? '[]',
      links: fields.links ?? '[]',
      recurrence: fields.recurrence ?? null,
      recurrence_end: fields.recurrence_end ?? null,
      reminder: fields.reminder ?? 'none',
      estimated_minutes: fields.estimated_minutes ?? req.user.default_duration ?? null,
      actual_minutes: fields.actual_minutes ?? null,
      position: fields.position ?? 0,
      created_at: now,
      updated_at: now,
      completed_at: null,
      cancelled_at: null,
    };

    const cols = Object.keys(record);
    db.prepare(
      `INSERT INTO tasks (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).run(...Object.values(record));

    // Optional subtasks supplied inline at creation.
    if (Array.isArray(body.subtasks) && body.subtasks.length) {
      const stmt = db.prepare(
        `INSERT INTO subtasks (id, user_id, task_id, title, done, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`
      );
      body.subtasks.slice(0, 50).forEach((raw, index) => {
        const title = str(typeof raw === 'string' ? raw : raw?.title, 'Subtask', { min: 1, max: 200 });
        if (title) stmt.run(newId(), req.user.id, id, title, index, now);
      });
    }

    syncTaskReminder(req.user, id);

    const row = getTaskRow(id, req.user.id);
    const subtasks = db.prepare(`SELECT * FROM subtasks WHERE task_id = ? ORDER BY position`).all(id);
    res.status(201).json({ task: serializeTask(row, { subtasks }) });
  })
);

/* ------------------------------------------------------------------ *
 * Update
 * ------------------------------------------------------------------ */

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Responsibility');
    const existing = requireOwned('tasks', id, req.user.id, 'Responsibility');
    const body = ensureObject(req.body);
    const fields = readTaskInput(body, req.user, { partial: true });

    if (fields.status !== undefined) {
      if (fields.status === 'completed' && existing.status !== 'completed') {
        fields.completed_at = nowIso();
      } else if (fields.status !== 'completed') {
        fields.completed_at = null;
      }
      fields.cancelled_at = fields.status === 'cancelled' ? nowIso() : null;
    }

    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE tasks SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }

    syncTaskReminder(req.user, id);
    const row = getTaskRow(id, req.user.id);
    const subtasks = db.prepare(`SELECT * FROM subtasks WHERE task_id = ? ORDER BY position`).all(id);
    res.json({ task: serializeTask(row, { subtasks }) });
  })
);

/* ------------------------------------------------------------------ *
 * Completion — the one place where recurrence advances.
 * ------------------------------------------------------------------ */

router.post(
  '/:id/complete',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Responsibility');
    const done = bool(ensureObject(req.body ?? {}).done, true);

    // Shared with the assistant, so a recurring item advances the same way
    // whichever surface completed it.
    const { recurredTo, completedToday } = completeTask(req.user, id, done);

    const row = getTaskRow(id, req.user.id);
    res.json({
      task: serializeTask(row),
      recurredTo,
      completedToday,
    });
  })
);

/* ------------------------------------------------------------------ *
 * Reschedule / duplicate / bulk
 * ------------------------------------------------------------------ */

router.post(
  '/:id/reschedule',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Responsibility');
    const task = requireOwned('tasks', id, req.user.id, 'Responsibility');
    const body = ensureObject(req.body);
    const today = todayFor(req.user.timezone);

    let due = task.due_date;
    if (body.dueDate !== undefined) due = dateOnly(body.dueDate, 'Due date');
    else if (body.preset) {
      const preset = enumValue(body.preset, ['today', 'tomorrow', 'next_week', 'next_month', 'clear'], 'Preset');
      due =
        preset === 'today' ? today
        : preset === 'tomorrow' ? addDays(today, 1)
        : preset === 'next_week' ? addDays(today, 7)
        : preset === 'next_month' ? addDays(today, 30)
        : null;
    }
    const time = body.dueTime !== undefined ? timeOnly(body.dueTime, 'Due time') : task.due_time;

    db.prepare(`UPDATE tasks SET due_date = ?, due_time = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(due, time, nowIso(), id, req.user.id);
    syncTaskReminder(req.user, id);
    res.json({ task: serializeTask(getTaskRow(id, req.user.id)) });
  })
);

router.post(
  '/:id/duplicate',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Responsibility');
    const task = requireOwned('tasks', id, req.user.id, 'Responsibility');
    const now = nowIso();
    const copyId = newId();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO tasks (id, user_id, project_id, milestone_id, objective_id, area_id, title, description,
                            notes, start_date, due_date, due_time, priority, important, meaningful, status, tags,
                            links, recurrence, recurrence_end, reminder, estimated_minutes, actual_minutes,
                            position, created_at, updated_at)
         SELECT ?, user_id, project_id, milestone_id, objective_id, area_id, title || ' (copy)', description,
                notes, start_date, due_date, due_time, priority, important, meaningful, 'not_started', tags,
                links, recurrence, recurrence_end, reminder, estimated_minutes, NULL,
                position, ?, ?
         FROM tasks WHERE id = ? AND user_id = ?`
      ).run(copyId, now, now, id, req.user.id);

      const subs = db.prepare(`SELECT * FROM subtasks WHERE task_id = ? ORDER BY position`).all(id);
      const stmt = db.prepare(
        `INSERT INTO subtasks (id, user_id, task_id, title, done, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`
      );
      subs.forEach((s, i) => stmt.run(newId(), req.user.id, copyId, s.title, i, now));
    })();

    const row = getTaskRow(copyId, req.user.id);
    const subtasks = db.prepare(`SELECT * FROM subtasks WHERE task_id = ? ORDER BY position`).all(copyId);
    res.status(201).json({ task: serializeTask(row, { subtasks }) });
  })
);

router.post(
  '/bulk',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const ids = Array.isArray(body.ids) ? body.ids.map((i) => requireId(i, 'Responsibility')) : [];
    if (!ids.length) throw new HttpError(400, 'Select at least one responsibility.');
    if (ids.length > 200) throw new HttpError(400, 'Select at most 200 responsibilities at a time.');

    const action = enumValue(
      body.action,
      ['complete', 'delete', 'priority', 'important', 'reschedule', 'area', 'project', 'status'],
      'Action'
    );
    const now = nowIso();
    const today = todayFor(req.user.timezone);
    let affected = 0;

    db.transaction(() => {
      for (const id of ids) {
        const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND user_id = ?`).get(id, req.user.id);
        if (!task) continue; // silently ignore ids that are not the caller's
        switch (action) {
          case 'complete':
            recordCompletion(req.user.id, task);
            db.prepare(`UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`)
              .run(now, now, id);
            break;
          case 'delete':
            db.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`).run(id, req.user.id);
            break;
          case 'priority':
            db.prepare(`UPDATE tasks SET priority = ?, updated_at = ? WHERE id = ?`)
              .run(enumValue(body.priority, PRIORITIES, 'Priority'), now, id);
            break;
          case 'status':
            db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
              .run(enumValue(body.status, TASK_STATUSES, 'Status'), now, id);
            break;
          case 'important':
            db.prepare(`UPDATE tasks SET important = ?, updated_at = ? WHERE id = ?`)
              .run(bool(body.important, true) ? 1 : 0, now, id);
            break;
          case 'reschedule': {
            const due = body.dueDate !== undefined
              ? dateOnly(body.dueDate, 'Due date')
              : body.preset === 'tomorrow' ? addDays(today, 1) : today;
            db.prepare(`UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?`).run(due, now, id);
            break;
          }
          case 'area':
            db.prepare(`UPDATE tasks SET area_id = ?, updated_at = ? WHERE id = ?`)
              .run(ownedReference(body.areaId, 'areas', req.user.id, 'Area'), now, id);
            break;
          case 'project':
            db.prepare(`UPDATE tasks SET project_id = ?, updated_at = ? WHERE id = ?`)
              .run(ownedReference(body.projectId, 'projects', req.user.id, 'Project'), now, id);
            break;
          default:
            break;
        }
        affected += 1;
      }
    })();

    res.json({ ok: true, affected });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Responsibility');
    requireOwned('tasks', id, req.user.id, 'Responsibility');
    db.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ *
 * Subtasks
 * ------------------------------------------------------------------ */

router.post(
  '/:id/subtasks',
  wrap(async (req, res) => {
    const taskId = requireId(req.params.id, 'Responsibility');
    requireOwned('tasks', taskId, req.user.id, 'Responsibility');
    const title = str(ensureObject(req.body).title, 'Subtask', { min: 1, max: 200, required: true });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM subtasks WHERE task_id = ?`).get(taskId).n;
    if (count >= 100) throw new HttpError(400, 'A responsibility can hold up to 100 subtasks.');

    const id = newId();
    db.prepare(
      `INSERT INTO subtasks (id, user_id, task_id, title, done, position, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)`
    ).run(id, req.user.id, taskId, title, count, nowIso());
    res.status(201).json({ subtask: serializeSubtask(db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(id)) });
  })
);

router.patch(
  '/:id/subtasks/:subId',
  wrap(async (req, res) => {
    const taskId = requireId(req.params.id, 'Responsibility');
    const subId = requireId(req.params.subId, 'Subtask');
    requireOwned('tasks', taskId, req.user.id, 'Responsibility');
    const sub = db
      .prepare(`SELECT * FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?`)
      .get(subId, taskId, req.user.id);
    if (!sub) throw notFound('Subtask not found.');

    const body = ensureObject(req.body);
    const fields = {};
    if (body.title !== undefined) fields.title = str(body.title, 'Subtask', { min: 1, max: 200 });
    if (body.done !== undefined) {
      fields.done = bool(body.done) ? 1 : 0;
      fields.completed_at = fields.done ? nowIso() : null;
    }
    if (body.position !== undefined) fields.position = int(body.position, 'Position', { min: 0, max: 999 });

    if (Object.keys(fields).length) {
      db.prepare(
        `UPDATE subtasks SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), subId, req.user.id);
      db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(nowIso(), taskId);
    }
    res.json({ subtask: serializeSubtask(db.prepare(`SELECT * FROM subtasks WHERE id = ?`).get(subId)) });
  })
);

router.delete(
  '/:id/subtasks/:subId',
  wrap(async (req, res) => {
    const taskId = requireId(req.params.id, 'Responsibility');
    const subId = requireId(req.params.subId, 'Subtask');
    requireOwned('tasks', taskId, req.user.id, 'Responsibility');
    db.prepare(`DELETE FROM subtasks WHERE id = ? AND task_id = ? AND user_id = ?`)
      .run(subId, taskId, req.user.id);
    res.json({ ok: true });
  })
);

export default router;
