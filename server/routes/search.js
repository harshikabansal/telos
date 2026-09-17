import express from 'express';
import db from '../db.js';
import { wrap } from '../middleware.js';
import { str } from '../validate.js';
import { serializeNote, serializeTask } from '../serialize.js';
import { classify, todayFor } from '../domain.js';

const router = express.Router();

/**
 * Global search across every surface a user can hold. All predicates are
 * scoped by user_id and the term is bound as a parameter, so the LIKE pattern
 * cannot escape its placeholder.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const term = str(req.query.q, 'Search', { max: 120 }) ?? '';
    if (term.length < 1) {
      return res.json({ query: '', tasks: [], projects: [], objectives: [], milestones: [], notes: [], areas: [] });
    }
    const userId = req.user.id;
    const today = todayFor(req.user.timezone);
    const like = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const ESCAPE = ` ESCAPE '\\'`;

    const tasks = db
      .prepare(
        `SELECT t.*, p.name AS project_name, a.name AS area_name,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN areas a ON a.id = t.area_id
         WHERE t.user_id = ? AND (t.title LIKE ?${ESCAPE} OR t.description LIKE ?${ESCAPE} OR t.notes LIKE ?${ESCAPE} OR t.tags LIKE ?${ESCAPE})
         ORDER BY t.status = 'completed', t.due_date IS NULL, t.due_date ASC LIMIT 40`
      )
      .all(userId, like, like, like, like)
      .map((row) => ({ ...serializeTask(row), ...classify(row, today) }));

    const projects = db
      .prepare(
        `SELECT id, name, description, status, deadline, priority FROM projects
         WHERE user_id = ? AND (name LIKE ?${ESCAPE} OR description LIKE ?${ESCAPE}) LIMIT 20`
      )
      .all(userId, like, like);

    const objectives = db
      .prepare(
        `SELECT id, title, description, status, horizon, deadline FROM objectives
         WHERE user_id = ? AND (title LIKE ?${ESCAPE} OR description LIKE ?${ESCAPE}) LIMIT 20`
      )
      .all(userId, like, like);

    const milestones = db
      .prepare(
        `SELECT m.id, m.title, m.status, m.target_date, o.title AS objective_title
         FROM milestones m LEFT JOIN objectives o ON o.id = m.objective_id
         WHERE m.user_id = ? AND (m.title LIKE ?${ESCAPE} OR m.description LIKE ?${ESCAPE}) LIMIT 20`
      )
      .all(userId, like, like);

    const notes = db
      .prepare(
        `SELECT * FROM notes WHERE user_id = ? AND (title LIKE ?${ESCAPE} OR body LIKE ?${ESCAPE})
         ORDER BY updated_at DESC LIMIT 20`
      )
      .all(userId, like, like)
      .map(serializeNote);

    const areas = db
      .prepare(`SELECT id, name, icon, color FROM areas WHERE user_id = ? AND name LIKE ?${ESCAPE} LIMIT 10`)
      .all(userId, like);

    const events = db
      .prepare(
        `SELECT id, title, start_date, start_time FROM events
         WHERE user_id = ? AND (title LIKE ?${ESCAPE} OR description LIKE ?${ESCAPE} OR location LIKE ?${ESCAPE}) LIMIT 15`
      )
      .all(userId, like, like, like);

    res.json({
      query: term,
      tasks,
      projects,
      objectives,
      milestones,
      notes,
      areas,
      events,
      total:
        tasks.length + projects.length + objectives.length + milestones.length +
        notes.length + areas.length + events.length,
    });
  })
);

export default router;
