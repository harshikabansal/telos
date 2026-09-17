import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { HttpError, notFound, wrap } from '../middleware.js';
import { ownedReference, requireOwned } from '../ownership.js';
import {
  HORIZONS, MILESTONE_STATUSES, OBJECTIVE_STATUSES, PRIORITIES,
  dateOnly, ensureObject, enumValue, int, requireId, str,
} from '../validate.js';
import {
  serializeMilestone, serializeObjective, serializeProject, serializeTask,
} from '../serialize.js';
import { classify, todayFor } from '../domain.js';

const router = express.Router();

const OBJECTIVE_SELECT = `
  SELECT o.*, a.name AS area_name FROM objectives o LEFT JOIN areas a ON a.id = o.area_id
`;

/* ------------------------------------------------------------------ *
 * Objectives
 * ------------------------------------------------------------------ */

router.get(
  '/',
  wrap(async (req, res) => {
    const where = ['o.user_id = ?'];
    const params = [req.user.id];
    if (req.query.status) {
      where.push('o.status = ?');
      params.push(enumValue(req.query.status, OBJECTIVE_STATUSES, 'Status'));
    }
    if (req.query.horizon) {
      where.push('o.horizon = ?');
      params.push(enumValue(req.query.horizon, HORIZONS, 'Horizon'));
    }
    if (req.query.areaId) {
      where.push('o.area_id = ?');
      params.push(requireId(req.query.areaId, 'Area'));
    }

    const rows = db
      .prepare(
        `${OBJECTIVE_SELECT} WHERE ${where.join(' AND ')}
         ORDER BY CASE o.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END,
                  o.deadline IS NULL, o.deadline ASC, o.position ASC`
      )
      .all(...params);

    const includeMilestones = req.query.includeMilestones !== 'false';
    const milestoneStmt = db.prepare(
      `SELECT * FROM milestones WHERE user_id = ? AND objective_id = ? ORDER BY position ASC, created_at ASC`
    );

    res.json({
      objectives: rows.map((row) =>
        serializeObjective(row, req.user.id, {
          milestones: includeMilestones ? milestoneStmt.all(req.user.id, row.id) : undefined,
        })
      ),
    });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Objective');
    const row = db.prepare(`${OBJECTIVE_SELECT} WHERE o.id = ? AND o.user_id = ?`).get(id, req.user.id);
    if (!row) throw notFound('Objective not found.');
    const today = todayFor(req.user.timezone);

    const milestones = db
      .prepare(`SELECT * FROM milestones WHERE user_id = ? AND objective_id = ? ORDER BY position ASC`)
      .all(req.user.id, id);
    const projects = db
      .prepare(
        `SELECT p.*, m.title AS milestone_title, a.name AS area_name FROM projects p
         LEFT JOIN milestones m ON m.id = p.milestone_id
         LEFT JOIN areas a ON a.id = p.area_id
         WHERE p.user_id = ? AND p.objective_id = ? ORDER BY p.position ASC`
      )
      .all(req.user.id, id);
    const tasks = db
      .prepare(
        `SELECT t.*, p.name AS project_name, m.title AS milestone_title,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN milestones m ON m.id = t.milestone_id
         WHERE t.user_id = ? AND t.objective_id = ?
         ORDER BY t.due_date IS NULL, t.due_date ASC LIMIT 200`
      )
      .all(req.user.id, id);

    res.json({
      objective: serializeObjective(row, req.user.id, { milestones }),
      projects: projects.map((p) => serializeProject(p, req.user.id)),
      tasks: tasks.map((t) => ({ ...serializeTask(t), ...classify(t, today) })),
    });
  })
);

function readObjectiveInput(body, userId, { partial = false } = {}) {
  const fields = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('title')) fields.title = str(body.title, 'Objective', { min: 1, max: 200, required: !partial });
  if (has('description')) fields.description = str(body.description, 'Description', { max: 4000 }) ?? '';
  if (has('horizon') || !partial) fields.horizon = enumValue(body.horizon, HORIZONS, 'Horizon', 'year');
  if (has('startDate')) fields.start_date = dateOnly(body.startDate, 'Start date');
  if (has('deadline')) fields.deadline = dateOnly(body.deadline, 'Deadline');
  if (has('status') || !partial) fields.status = enumValue(body.status, OBJECTIVE_STATUSES, 'Status', 'active');
  if (has('priority') || !partial) fields.priority = enumValue(body.priority, PRIORITIES, 'Priority', 'medium');
  if (has('progressMode')) fields.progress_mode = enumValue(body.progressMode, ['auto', 'manual'], 'Progress mode');
  if (has('progressManual')) fields.progress_manual = int(body.progressManual, 'Progress', { min: 0, max: 100 }) ?? 0;
  if (has('position')) fields.position = int(body.position, 'Position', { min: 0, max: 100000 }) ?? 0;
  if (has('areaId')) fields.area_id = ownedReference(body.areaId, 'areas', userId, 'Area');
  return fields;
}

router.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const fields = readObjectiveInput(body, req.user.id);
    const now = nowIso();
    const id = newId();

    db.prepare(
      `INSERT INTO objectives (id, user_id, area_id, title, description, horizon, start_date, deadline,
                               status, priority, progress_mode, progress_manual, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, req.user.id, fields.area_id ?? null, fields.title, fields.description ?? '',
      fields.horizon, fields.start_date ?? null, fields.deadline ?? null,
      fields.status, fields.priority, fields.progress_mode ?? 'auto',
      fields.progress_manual ?? 0, fields.position ?? 0, now, now
    );

    // Optional milestones supplied inline (used by onboarding).
    if (Array.isArray(body.milestones) && body.milestones.length) {
      const stmt = db.prepare(
        `INSERT INTO milestones (id, user_id, objective_id, title, description, target_date, status, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, 'active', ?, ?, ?)`
      );
      body.milestones.slice(0, 40).forEach((raw, index) => {
        const title = str(typeof raw === 'string' ? raw : raw?.title, 'Milestone', { min: 1, max: 200 });
        if (!title) return;
        const target = typeof raw === 'object' ? dateOnly(raw.targetDate, 'Target date') : null;
        stmt.run(newId(), req.user.id, id, title, target, index, now, now);
      });
    }

    const row = db.prepare(`${OBJECTIVE_SELECT} WHERE o.id = ?`).get(id);
    const milestones = db
      .prepare(`SELECT * FROM milestones WHERE objective_id = ? ORDER BY position`)
      .all(id);
    res.status(201).json({ objective: serializeObjective(row, req.user.id, { milestones }) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Objective');
    const existing = requireOwned('objectives', id, req.user.id, 'Objective');
    const fields = readObjectiveInput(ensureObject(req.body), req.user.id, { partial: true });

    if (fields.status !== undefined) {
      fields.completed_at = fields.status === 'completed' ? existing.completed_at || nowIso() : null;
    }
    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE objectives SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }
    const row = db.prepare(`${OBJECTIVE_SELECT} WHERE o.id = ?`).get(id);
    const milestones = db.prepare(`SELECT * FROM milestones WHERE objective_id = ? ORDER BY position`).all(id);
    res.json({ objective: serializeObjective(row, req.user.id, { milestones }) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Objective');
    requireOwned('objectives', id, req.user.id, 'Objective');
    // Milestones cascade; projects and responsibilities survive, unlinked.
    db.prepare(`DELETE FROM objectives WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ *
 * Milestones — the bridge between an objective and the work beneath it.
 * ------------------------------------------------------------------ */

router.get(
  '/:id/milestones',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Objective');
    requireOwned('objectives', id, req.user.id, 'Objective');
    const rows = db
      .prepare(`SELECT * FROM milestones WHERE user_id = ? AND objective_id = ? ORDER BY position ASC`)
      .all(req.user.id, id);
    res.json({ milestones: rows.map((m) => serializeMilestone(m, req.user.id)) });
  })
);

router.post(
  '/:id/milestones',
  wrap(async (req, res) => {
    const objectiveId = requireId(req.params.id, 'Objective');
    requireOwned('objectives', objectiveId, req.user.id, 'Objective');
    const body = ensureObject(req.body);
    const title = str(body.title, 'Milestone', { min: 1, max: 200, required: true });
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM milestones WHERE user_id = ? AND objective_id = ?`)
      .get(req.user.id, objectiveId).n;
    if (count >= 50) throw new HttpError(400, 'An objective can hold up to 50 milestones.');

    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO milestones (id, user_id, objective_id, title, description, target_date, status, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id, req.user.id, objectiveId, title,
      str(body.description, 'Description', { max: 2000 }) ?? '',
      dateOnly(body.targetDate, 'Target date'),
      int(body.position ?? count, 'Position', { min: 0, max: 999 }),
      now, now
    );
    res.status(201).json({
      milestone: serializeMilestone(db.prepare(`SELECT * FROM milestones WHERE id = ?`).get(id), req.user.id),
    });
  })
);

export const milestoneRouter = express.Router();

milestoneRouter.get(
  '/',
  wrap(async (req, res) => {
    const where = ['m.user_id = ?'];
    const params = [req.user.id];
    if (req.query.objectiveId) {
      where.push('m.objective_id = ?');
      params.push(requireId(req.query.objectiveId, 'Objective'));
    }
    if (req.query.status) {
      where.push('m.status = ?');
      params.push(enumValue(req.query.status, MILESTONE_STATUSES, 'Status'));
    }
    const rows = db
      .prepare(
        `SELECT m.*, o.title AS objective_title FROM milestones m
         LEFT JOIN objectives o ON o.id = m.objective_id
         WHERE ${where.join(' AND ')}
         ORDER BY m.target_date IS NULL, m.target_date ASC, m.position ASC`
      )
      .all(...params);
    res.json({ milestones: rows.map((m) => serializeMilestone(m, req.user.id)) });
  })
);

milestoneRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Milestone');
    const row = db
      .prepare(
        `SELECT m.*, o.title AS objective_title FROM milestones m
         LEFT JOIN objectives o ON o.id = m.objective_id WHERE m.id = ? AND m.user_id = ?`
      )
      .get(id, req.user.id);
    if (!row) throw notFound('Milestone not found.');
    const today = todayFor(req.user.timezone);
    const projects = db
      .prepare(`SELECT * FROM projects WHERE user_id = ? AND milestone_id = ? ORDER BY position`)
      .all(req.user.id, id);
    const tasks = db
      .prepare(
        `SELECT t.*, p.name AS project_name,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
         FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.user_id = ? AND t.milestone_id = ? ORDER BY t.due_date IS NULL, t.due_date ASC`
      )
      .all(req.user.id, id);
    res.json({
      milestone: serializeMilestone(row, req.user.id),
      projects: projects.map((p) => serializeProject(p, req.user.id)),
      tasks: tasks.map((t) => ({ ...serializeTask(t), ...classify(t, today) })),
    });
  })
);

milestoneRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Milestone');
    const existing = requireOwned('milestones', id, req.user.id, 'Milestone');
    const body = ensureObject(req.body);
    const fields = {};
    if (body.title !== undefined) fields.title = str(body.title, 'Milestone', { min: 1, max: 200 });
    if (body.description !== undefined) fields.description = str(body.description, 'Description', { max: 2000 }) ?? '';
    if (body.targetDate !== undefined) fields.target_date = dateOnly(body.targetDate, 'Target date');
    if (body.position !== undefined) fields.position = int(body.position, 'Position', { min: 0, max: 999 });
    if (body.objectiveId !== undefined) {
      fields.objective_id = ownedReference(body.objectiveId, 'objectives', req.user.id, 'Objective');
    }
    if (body.status !== undefined) {
      fields.status = enumValue(body.status, MILESTONE_STATUSES, 'Status');
      fields.completed_at = fields.status === 'completed' ? existing.completed_at || nowIso() : null;
    }
    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE milestones SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }
    res.json({
      milestone: serializeMilestone(db.prepare(`SELECT * FROM milestones WHERE id = ?`).get(id), req.user.id),
    });
  })
);

milestoneRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Milestone');
    requireOwned('milestones', id, req.user.id, 'Milestone');
    db.prepare(`DELETE FROM milestones WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

milestoneRouter.post(
  '/reorder',
  wrap(async (req, res) => {
    const ids = ensureObject(req.body).order;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Provide the new order as a list of milestone ids.');
    const stmt = db.prepare(`UPDATE milestones SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?`);
    const now = nowIso();
    db.transaction(() => {
      ids.forEach((raw, index) => stmt.run(index, now, requireId(raw, 'Milestone'), req.user.id));
    })();
    res.json({ ok: true });
  })
);

export default router;
