import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { notFound, wrap, HttpError } from '../middleware.js';
import { ownedReference, requireOwned } from '../ownership.js';
import {
  PRIORITIES, PROJECT_STATUSES,
  dateOnly, ensureObject, enumValue, int, requireId, str,
} from '../validate.js';
import { serializeProject, serializeTask } from '../serialize.js';
import { classify, todayFor } from '../domain.js';

const router = express.Router();

const PROJECT_SELECT = `
  SELECT p.*, o.title AS objective_title, m.title AS milestone_title, a.name AS area_name
  FROM projects p
  LEFT JOIN objectives o ON o.id = p.objective_id
  LEFT JOIN milestones m ON m.id = p.milestone_id
  LEFT JOIN areas      a ON a.id = p.area_id
`;

router.get(
  '/',
  wrap(async (req, res) => {
    const where = ['p.user_id = ?'];
    const params = [req.user.id];
    if (req.query.status) {
      where.push('p.status = ?');
      params.push(enumValue(req.query.status, PROJECT_STATUSES, 'Status'));
    }
    if (req.query.objectiveId) {
      where.push('p.objective_id = ?');
      params.push(requireId(req.query.objectiveId, 'Objective'));
    }
    if (req.query.milestoneId) {
      where.push('p.milestone_id = ?');
      params.push(requireId(req.query.milestoneId, 'Milestone'));
    }
    if (req.query.areaId) {
      where.push('p.area_id = ?');
      params.push(requireId(req.query.areaId, 'Area'));
    }
    const rows = db
      .prepare(
        `${PROJECT_SELECT} WHERE ${where.join(' AND ')}
         ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END,
                  p.deadline IS NULL, p.deadline ASC, p.position ASC`
      )
      .all(...params);
    res.json({ projects: rows.map((row) => serializeProject(row, req.user.id)) });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Project');
    const row = db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.user_id = ?`).get(id, req.user.id);
    if (!row) throw notFound('Project not found.');
    const today = todayFor(req.user.timezone);
    const tasks = db
      .prepare(
        `SELECT t.*, a.name AS area_name,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
         FROM tasks t LEFT JOIN areas a ON a.id = t.area_id
         WHERE t.project_id = ? AND t.user_id = ?
         ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
                  t.due_date IS NULL, t.due_date ASC, t.position ASC`
      )
      .all(id, req.user.id);
    res.json({
      project: serializeProject(row, req.user.id),
      tasks: tasks.map((t) => ({ ...serializeTask(t), ...classify(t, today) })),
    });
  })
);

function readProjectInput(body, userId, { partial = false } = {}) {
  const fields = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) fields.name = str(body.name, 'Project name', { min: 1, max: 160, required: !partial });
  if (has('description')) fields.description = str(body.description, 'Description', { max: 4000 }) ?? '';
  if (has('deadline')) fields.deadline = dateOnly(body.deadline, 'Deadline');
  if (has('priority') || !partial) fields.priority = enumValue(body.priority, PRIORITIES, 'Priority', 'medium');
  if (has('status') || !partial) fields.status = enumValue(body.status, PROJECT_STATUSES, 'Status', 'active');
  if (has('position')) fields.position = int(body.position, 'Position', { min: 0, max: 100000 }) ?? 0;
  if (has('objectiveId')) fields.objective_id = ownedReference(body.objectiveId, 'objectives', userId, 'Objective');
  if (has('milestoneId')) fields.milestone_id = ownedReference(body.milestoneId, 'milestones', userId, 'Milestone');
  if (has('areaId')) fields.area_id = ownedReference(body.areaId, 'areas', userId, 'Area');
  return fields;
}

router.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const fields = readProjectInput(body, req.user.id);

    // A project attached to a milestone inherits that milestone's objective.
    if (fields.milestone_id && !fields.objective_id) {
      const milestone = db.prepare(`SELECT objective_id FROM milestones WHERE id = ? AND user_id = ?`)
        .get(fields.milestone_id, req.user.id);
      if (milestone) fields.objective_id = milestone.objective_id;
    }

    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO projects (id, user_id, objective_id, milestone_id, area_id, name, description, deadline,
                             priority, status, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, req.user.id,
      fields.objective_id ?? null, fields.milestone_id ?? null, fields.area_id ?? null,
      fields.name, fields.description ?? '', fields.deadline ?? null,
      fields.priority, fields.status, fields.position ?? 0, now, now
    );

    // Optional starter responsibilities.
    if (Array.isArray(body.tasks) && body.tasks.length) {
      const stmt = db.prepare(
        `INSERT INTO tasks (id, user_id, project_id, objective_id, milestone_id, area_id, title, priority,
                            status, tags, links, reminder, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', '[]', '[]', 'none', ?, ?, ?)`
      );
      body.tasks.slice(0, 60).forEach((raw, index) => {
        const title = str(typeof raw === 'string' ? raw : raw?.title, 'Responsibility', { min: 1, max: 200 });
        if (!title) return;
        stmt.run(
          newId(), req.user.id, id, fields.objective_id ?? null, fields.milestone_id ?? null,
          fields.area_id ?? null, title, fields.priority, index, now, now
        );
      });
    }

    const row = db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id);
    res.status(201).json({ project: serializeProject(row, req.user.id) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Project');
    const existing = requireOwned('projects', id, req.user.id, 'Project');
    const fields = readProjectInput(ensureObject(req.body), req.user.id, { partial: true });

    if (fields.status !== undefined) {
      fields.completed_at =
        fields.status === 'completed'
          ? existing.completed_at || nowIso()
          : null;
    }
    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE projects SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }
    const row = db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).get(id);
    res.json({ project: serializeProject(row, req.user.id) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Project');
    requireOwned('projects', id, req.user.id, 'Project');
    const withTasks = req.query.withTasks === 'true';
    db.transaction(() => {
      if (withTasks) db.prepare(`DELETE FROM tasks WHERE project_id = ? AND user_id = ?`).run(id, req.user.id);
      db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    })();
    res.json({ ok: true });
  })
);

router.post(
  '/reorder',
  wrap(async (req, res) => {
    const ids = ensureObject(req.body).order;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Provide the new order as a list of project ids.');
    const stmt = db.prepare(`UPDATE projects SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?`);
    const now = nowIso();
    db.transaction(() => {
      ids.forEach((raw, index) => stmt.run(index, now, requireId(raw, 'Project'), req.user.id));
    })();
    res.json({ ok: true });
  })
);

export default router;
