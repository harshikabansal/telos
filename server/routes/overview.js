import express from 'express';
import db from '../db.js';
import { wrap } from '../middleware.js';
import { serializeEvent, serializeObjective, serializeProject, serializeTask } from '../serialize.js';
import {
  addDays, classify, clockFor, daysBetween, expandOccurrences, focusScore, todayFor,
} from '../domain.js';
import { lastCompleteWeek } from '../services/review.js';

const router = express.Router();

const TASK_JOINS = `
  LEFT JOIN projects   p ON p.id = t.project_id
  LEFT JOIN areas      a ON a.id = t.area_id
  LEFT JOIN objectives o ON o.id = t.objective_id
  LEFT JOIN milestones m ON m.id = t.milestone_id
`;
const TASK_COLUMNS = `
  t.*, p.name AS project_name, a.name AS area_name, o.title AS objective_title, m.title AS milestone_title,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
`;

/**
 * One request assembles the whole dashboard. The ordering here is the
 * product's point of view: what deserves attention now, then what is
 * approaching, then how it all ladders up to the objectives underneath.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const userId = req.user.id;
    const today = todayFor(req.user.timezone);
    const now = clockFor(req.user.timezone);
    const decorate = (row) => ({
      ...serializeTask(row),
      ...classify(row, today),
      focus: focusScore(row, today, now),
    });

    const openTasks = db
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks t ${TASK_JOINS}
         WHERE t.user_id = ? AND t.status IN ('not_started','in_progress')`
      )
      .all(userId)
      .map(decorate);

    const dueOrOverdue = openTasks.filter((t) => t.dueDate && t.dueDate <= today);
    const startedUndated = openTasks.filter((t) => !t.dueDate && t.status === 'in_progress');
    const importantUndated = openTasks.filter((t) => !t.dueDate && t.important && t.status !== 'in_progress');

    // Today's Focus: everything actually due, plus work already in motion and
    // important undated items — capped so the list stays honest about capacity.
    const focus = [...dueOrOverdue, ...startedUndated, ...importantUndated]
      .sort((a, b) => b.focus - a.focus)
      .slice(0, 12);

    const overdue = openTasks
      .filter((t) => t.overdue)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    const approaching = openTasks
      .filter((t) => t.dueDate && t.dueDate > today && daysBetween(today, t.dueDate) <= 3)
      .sort((a, b) => b.focus - a.focus);
    const urgent = openTasks.filter((t) => t.priority === 'urgent' && !t.overdue);
    const importantOpen = openTasks
      .filter((t) => t.important && !t.overdue)
      .sort((a, b) => b.focus - a.focus);

    const inRange = (from, to) =>
      openTasks
        .filter((t) => t.dueDate && t.dueDate >= from && t.dueDate <= to)
        .sort((a, b) =>
          a.dueDate === b.dueDate ? b.focus - a.focus : a.dueDate < b.dueDate ? -1 : 1
        );

    const tomorrow = addDays(today, 1);
    const upcoming = {
      tomorrow: inRange(tomorrow, tomorrow),
      next7: inRange(tomorrow, addDays(today, 7)),
      next30: inRange(addDays(today, 8), addDays(today, 30)),
    };

    const objectives = db
      .prepare(
        `SELECT o.*, a.name AS area_name FROM objectives o LEFT JOIN areas a ON a.id = o.area_id
         WHERE o.user_id = ? AND o.status = 'active'
         ORDER BY o.deadline IS NULL, o.deadline ASC, o.position ASC LIMIT 8`
      )
      .all(userId)
      .map((row) => serializeObjective(row, userId));

    const projects = db
      .prepare(
        `SELECT p.*, o.title AS objective_title, a.name AS area_name FROM projects p
         LEFT JOIN objectives o ON o.id = p.objective_id
         LEFT JOIN areas a ON a.id = p.area_id
         WHERE p.user_id = ? AND p.status IN ('active','planning')
         ORDER BY p.deadline IS NULL, p.deadline ASC, p.position ASC LIMIT 8`
      )
      .all(userId)
      .map((row) => serializeProject(row, userId));

    // Recurring responsibilities landing today, including projected occurrences
    // for rules whose stored due date has already moved past today.
    const recurring = db
      .prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks t ${TASK_JOINS}
         WHERE t.user_id = ? AND t.recurrence IS NOT NULL AND t.status != 'cancelled' LIMIT 200`
      )
      .all(userId);
    const recurringToday = recurring
      .filter((row) => {
        const rule = row.recurrence ? JSON.parse(row.recurrence) : null;
        if (!rule || !row.due_date) return false;
        if (row.due_date === today) return true;
        return expandOccurrences(rule, row.due_date, today, today, row.recurrence_end, 3).length > 0;
      })
      .map(decorate);

    const events = db
      .prepare(`SELECT * FROM events WHERE user_id = ? AND start_date BETWEEN ? AND ? ORDER BY start_time`)
      .all(userId, today, addDays(today, 7))
      .map(serializeEvent);

    const completedToday = db
      .prepare(`SELECT COUNT(*) AS n FROM task_completions WHERE user_id = ? AND completed_at >= ?`)
      .get(userId, `${today}T00:00:00.000Z`).n;

    // A quiet offer to look back at the week that just ended — shown only if
    // something actually happened in it and nothing has been written yet.
    const lastWeek = lastCompleteWeek(req.user);
    const writtenAlready = db
      .prepare(`SELECT 1 FROM reflections WHERE user_id = ? AND period_start = ?`)
      .get(userId, lastWeek.start);
    const lastWeekActivity = db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_completions
         WHERE user_id = ? AND completed_at >= ? AND completed_at <= ?`
      )
      .get(userId, `${lastWeek.start}T00:00:00.000Z`, `${lastWeek.end}T23:59:59.999Z`).n;

    const completedThisWeek = db
      .prepare(`SELECT COUNT(*) AS n FROM task_completions WHERE user_id = ? AND completed_at >= ?`)
      .get(userId, `${addDays(today, -6)}T00:00:00.000Z`).n;

    res.json({
      today,
      now,
      timezone: req.user.timezone,
      summary: {
        dueToday: dueOrOverdue.filter((t) => t.dueDate === today).length,
        overdue: overdue.length,
        highPriority: dueOrOverdue.filter((t) => ['high', 'urgent'].includes(t.priority)).length,
        important: importantOpen.length,
        openTotal: openTasks.length,
        completedToday,
        completedThisWeek,
        activeProjects: projects.length,
        activeObjectives: objectives.length,
      },
      focus,
      attention: {
        overdue: overdue.slice(0, 10),
        approaching: approaching.slice(0, 8),
        urgent: urgent.slice(0, 8),
        important: importantOpen.slice(0, 8),
      },
      upcoming,
      objectives,
      projects,
      recurringToday,
      events,
      review: {
        available: !writtenAlready && lastWeekActivity > 0,
        periodStart: lastWeek.start,
        periodEnd: lastWeek.end,
        completed: lastWeekActivity,
      },
    });
  })
);

export default router;
