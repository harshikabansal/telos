import db, { newId, nowIso } from '../db.js';
import { requireOwned } from '../ownership.js';
import { nextOccurrence, recordCompletion, todayFor } from '../domain.js';
import { syncTaskReminder } from '../routes/reminders.js';

/**
 * Operations on a responsibility that more than one surface performs.
 *
 * The REST route and the assistant both go through here, so completing a
 * recurring item advances it identically no matter which one asked. Every
 * function takes the authenticated user and re-checks ownership itself — none
 * of them may be called with an id that has not been proven to belong to the
 * caller.
 */

/** The fields worth capturing so an action can be offered back as an undo. */
export function snapshot(task) {
  return {
    status: task.status,
    dueDate: task.due_date,
    dueTime: task.due_time,
    priority: task.priority,
    important: Boolean(task.important),
  };
}

/**
 * Completion — the one place where recurrence advances. Completing an
 * occurrence records it in history and moves the responsibility to its next
 * date rather than closing it.
 */
export function completeTask(user, id, done = true) {
  const task = requireOwned('tasks', id, user.id, 'Responsibility');
  const before = snapshot(task);
  const now = nowIso();
  const today = todayFor(user.timezone);
  let recurred = null;

  db.transaction(() => {
    if (!done) {
      db.prepare(
        `UPDATE tasks SET status = 'not_started', completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?`
      ).run(now, id, user.id);
      // Remove the most recent history entry for this task.
      const last = db
        .prepare(`SELECT id FROM task_completions WHERE user_id = ? AND task_id = ? ORDER BY completed_at DESC LIMIT 1`)
        .get(user.id, id);
      if (last) db.prepare(`DELETE FROM task_completions WHERE id = ?`).run(last.id);
      return;
    }

    recordCompletion(user.id, task);

    const rule = task.recurrence ? JSON.parse(task.recurrence) : null;
    if (rule && task.due_date) {
      // Missed occurrences: 'skip' jumps to the next date ahead of today,
      // 'sequential' advances a single step so nothing is silently dropped.
      let next = nextOccurrence(rule, task.due_date, task.due_date);
      if (user.recurrence_catchup === 'skip') {
        let guard = 0;
        while (next && next < today && guard < 500) {
          next = nextOccurrence(rule, next, task.due_date);
          guard += 1;
        }
      }
      const beyondEnd = task.recurrence_end && next && next > task.recurrence_end;
      if (next && !beyondEnd) {
        db.prepare(
          `UPDATE tasks SET due_date = ?, status = 'not_started', completed_at = NULL, updated_at = ?,
                  start_date = CASE WHEN start_date IS NULL THEN NULL ELSE ? END
           WHERE id = ? AND user_id = ?`
        ).run(next, now, next, id, user.id);
        db.prepare(`UPDATE subtasks SET done = 0, completed_at = NULL WHERE task_id = ?`).run(id);
        recurred = next;
        return;
      }
    }

    db.prepare(
      `UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).run(now, now, id, user.id);
  })();

  syncTaskReminder(user, id);

  const completedToday = db
    .prepare(`SELECT COUNT(*) AS n FROM task_completions WHERE user_id = ? AND completed_at >= ?`)
    .get(user.id, `${today}T00:00:00.000Z`).n;

  return { before, recurredTo: recurred, completedToday };
}

/** Moves a responsibility to a new date, and optionally a new time. */
export function rescheduleTask(user, id, { dueDate = undefined, dueTime = undefined }) {
  const task = requireOwned('tasks', id, user.id, 'Responsibility');
  const before = snapshot(task);
  db.prepare(`UPDATE tasks SET due_date = ?, due_time = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(
      dueDate === undefined ? task.due_date : dueDate,
      dueTime === undefined ? task.due_time : dueTime,
      nowIso(),
      id,
      user.id
    );
  syncTaskReminder(user, id);
  return { before };
}

/** Sets simple scalar fields. Callers must pass already-validated values. */
export function setTaskFields(user, id, fields) {
  const task = requireOwned('tasks', id, user.id, 'Responsibility');
  const before = snapshot(task);
  const columns = {};
  if (fields.priority !== undefined) columns.priority = fields.priority;
  if (fields.important !== undefined) columns.important = fields.important ? 1 : 0;
  if (fields.status !== undefined) {
    columns.status = fields.status;
    columns.completed_at = fields.status === 'completed' ? nowIso() : null;
  }
  if (!Object.keys(columns).length) return { before };

  columns.updated_at = nowIso();
  db.prepare(
    `UPDATE tasks SET ${Object.keys(columns).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...Object.values(columns), id, user.id);
  syncTaskReminder(user, id);
  return { before };
}

/** Creates a responsibility with already-validated values. */
export function createTask(user, fields) {
  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO tasks (id, user_id, project_id, milestone_id, objective_id, area_id, title, description,
                        notes, start_date, due_date, due_time, priority, important, meaningful, status,
                        tags, links, recurrence, recurrence_end, reminder, estimated_minutes, actual_minutes,
                        position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '', '', NULL, ?, ?, ?, ?, 0, 'not_started',
             '[]', '[]', NULL, NULL, ?, NULL, NULL, 0, ?, ?)`
  ).run(
    id, user.id,
    fields.projectId ?? null, fields.milestoneId ?? null, fields.objectiveId ?? null, fields.areaId ?? null,
    fields.title,
    fields.dueDate ?? null, fields.dueTime ?? null,
    fields.priority ?? user.default_priority ?? 'medium',
    fields.important ? 1 : 0,
    user.default_reminder ?? 'none',
    now, now
  );
  syncTaskReminder(user, id);
  return id;
}

export const getTask = (user, id) =>
  db.prepare(`SELECT * FROM tasks WHERE id = ? AND user_id = ?`).get(id, user.id) || null;
