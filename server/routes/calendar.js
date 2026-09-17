import express from 'express';
import db from '../db.js';
import { wrap } from '../middleware.js';
import { serializeEvent, serializeTask } from '../serialize.js';
import { addDays, classify, expandOccurrences, todayFor } from '../domain.js';
import { dateOnly } from '../validate.js';

const router = express.Router();

/**
 * Everything that belongs on a calendar between two dates: dated
 * responsibilities, projected future occurrences of recurring ones, project
 * and objective deadlines, milestone targets, and events.
 *
 * Projected occurrences carry `projected: true` and a synthetic id, so the
 * client can render them without ever mistaking one for a stored record.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const userId = req.user.id;
    const today = todayFor(req.user.timezone);
    const from = dateOnly(req.query.from, 'From date') || addDays(today, -14);
    const to = dateOnly(req.query.to, 'To date') || addDays(today, 60);

    const rows = db
      .prepare(
        `SELECT t.*, p.name AS project_name, a.name AS area_name, o.title AS objective_title,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
                (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN areas a ON a.id = t.area_id
         LEFT JOIN objectives o ON o.id = t.objective_id
         WHERE t.user_id = ? AND t.status != 'cancelled'
           AND (t.due_date BETWEEN ? AND ? OR t.recurrence IS NOT NULL)
         LIMIT 2000`
      )
      .all(userId, from, to);

    const tasks = [];
    for (const row of rows) {
      const inWindow = row.due_date && row.due_date >= from && row.due_date <= to;
      if (inWindow) tasks.push({ ...serializeTask(row), ...classify(row, today) });

      if (row.recurrence && row.due_date && row.status !== 'completed') {
        const rule = JSON.parse(row.recurrence);
        const start = row.due_date > from ? row.due_date : from;
        const dates = expandOccurrences(rule, row.due_date, start, to, row.recurrence_end, 120);
        for (const date of dates) {
          if (date === row.due_date) continue; // already emitted as the real row
          tasks.push({
            ...serializeTask({ ...row, due_date: date }),
            ...classify({ ...row, due_date: date }, today),
            id: `${row.id}@${date}`,
            sourceId: row.id,
            projected: true,
          });
        }
      }
    }

    const events = db
      .prepare(`SELECT * FROM events WHERE user_id = ? AND start_date BETWEEN ? AND ?`)
      .all(userId, from, to)
      .map(serializeEvent);

    const deadlines = [
      ...db
        .prepare(
          `SELECT id, name AS title, deadline AS date, 'project' AS kind, status FROM projects
           WHERE user_id = ? AND deadline BETWEEN ? AND ?`
        )
        .all(userId, from, to),
      ...db
        .prepare(
          `SELECT id, title, deadline AS date, 'objective' AS kind, status FROM objectives
           WHERE user_id = ? AND deadline BETWEEN ? AND ?`
        )
        .all(userId, from, to),
      ...db
        .prepare(
          `SELECT id, title, target_date AS date, 'milestone' AS kind, status FROM milestones
           WHERE user_id = ? AND target_date BETWEEN ? AND ?`
        )
        .all(userId, from, to),
    ];

    res.json({ from, to, today, tasks, events, deadlines });
  })
);

export default router;
