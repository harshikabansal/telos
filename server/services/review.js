import db from '../db.js';
import { addDays, daysBetween, startOfWeekFor, todayFor, weekdayOf } from '../domain.js';
import { objectiveProgress, projectProgress } from '../domain.js';

/**
 * The weekly review.
 *
 * This is the product's philosophy in one function: progress over perfection,
 * reflection over gamification. It reports what actually happened — from the
 * completion history, not from a model's impression — and it is written to be
 * read by someone who had a bad week as easily as by someone who had a good
 * one. There is no score, no streak, and no comparison to anyone else.
 *
 * The one comparison it does make is to the person's own previous week, and
 * only as a fact ("eleven, against nine the week before"), never as a verdict.
 */

export function weekBounds(user, anchor = null) {
  const today = todayFor(user.timezone);
  const weekStart = Number(user.week_start ?? 1);
  const start = startOfWeekFor(anchor || today, weekStart);
  return { start, end: addDays(start, 6), today };
}

/** The week that has just finished, relative to today. */
export function lastCompleteWeek(user) {
  const { start } = weekBounds(user);
  const previousStart = addDays(start, -7);
  return { start: previousStart, end: addDays(previousStart, 6) };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function buildWeekReview(user, anchor = null) {
  const userId = user.id;
  const { start, end, today } = weekBounds(user, anchor);
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;

  /* ---------------------------- What moved --------------------------- */

  const completions = db
    .prepare(
      `SELECT c.title, c.completed_at, c.priority, a.name AS area_name
       FROM task_completions c LEFT JOIN areas a ON a.id = c.area_id
       WHERE c.user_id = ? AND c.completed_at >= ? AND c.completed_at <= ?
       ORDER BY c.completed_at ASC`
    )
    .all(userId, from, to);

  const previous = db
    .prepare(
      `SELECT COUNT(*) AS n FROM task_completions
       WHERE user_id = ? AND completed_at >= ? AND completed_at <= ?`
    )
    .get(userId, `${addDays(start, -7)}T00:00:00.000Z`, `${addDays(start, -1)}T23:59:59.999Z`).n;

  const byDay = WEEKDAY_NAMES.map((name) => ({ day: name, count: 0 }));
  for (const row of completions) byDay[new Date(row.completed_at).getUTCDay()].count += 1;
  const busiest = [...byDay].sort((a, b) => b.count - a.count)[0];

  /* ------------------------- What did not move ----------------------- */

  // Things that were due during the week and are still open. Stated as a fact,
  // not as a failure — some of them will simply no longer matter.
  const slipped = db
    .prepare(
      `SELECT t.id, t.title, t.due_date, t.priority, t.important, a.name AS area_name, p.name AS project_name
       FROM tasks t
       LEFT JOIN areas a ON a.id = t.area_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = ? AND t.status IN ('not_started','in_progress')
         AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?
       ORDER BY t.due_date ASC LIMIT 20`
    )
    .all(userId, start, end)
    .map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.due_date,
      priority: row.priority,
      important: Boolean(row.important),
      areaName: row.area_name,
      projectName: row.project_name,
    }));

  // Open work that predates this week entirely — the quiet backlog.
  const lingering = db
    .prepare(
      `SELECT t.title, t.due_date, t.created_at, a.name AS area_name
       FROM tasks t LEFT JOIN areas a ON a.id = t.area_id
       WHERE t.user_id = ? AND t.status IN ('not_started','in_progress')
         AND t.created_at < ? AND (t.due_date IS NULL OR t.due_date < ?)
       ORDER BY t.created_at ASC LIMIT 5`
    )
    .all(userId, from, start)
    .map((row) => ({
      title: row.title,
      areaName: row.area_name,
      ageDays: daysBetween(row.created_at.slice(0, 10), today),
    }));

  /* --------------------------- Where attention went ------------------- */

  const areas = db
    .prepare(`SELECT id, name FROM areas WHERE user_id = ? AND archived = 0 ORDER BY position`)
    .all(userId);

  const counts = new Map();
  for (const row of completions) {
    const key = row.area_name || 'Unassigned';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const byArea = areas
    .map((area) => ({ name: area.name, count: counts.get(area.name) || 0 }))
    .sort((a, b) => b.count - a.count);
  const untouched = byArea.filter((row) => row.count === 0).map((row) => row.name);

  // Most areas are quiet in most weeks, so "nothing happened in Travel" is not
  // worth saying. An area that was active last week and silent this one is a
  // change, and a change is worth noticing.
  const previousByArea = new Map(
    db
      .prepare(
        `SELECT a.name AS name, COUNT(*) AS n
         FROM task_completions c LEFT JOIN areas a ON a.id = c.area_id
         WHERE c.user_id = ? AND c.completed_at >= ? AND c.completed_at <= ? AND a.name IS NOT NULL
         GROUP BY a.name`
      )
      .all(userId, `${addDays(start, -7)}T00:00:00.000Z`, `${addDays(start, -1)}T23:59:59.999Z`)
      .map((row) => [row.name, row.n])
  );
  const wentQuiet = [...previousByArea.keys()].filter((name) => !counts.get(name));

  /* ------------------------ What it added up to ----------------------- */

  const milestones = db
    .prepare(
      `SELECT m.title, o.title AS objective_title FROM milestones m
       LEFT JOIN objectives o ON o.id = m.objective_id
       WHERE m.user_id = ? AND m.completed_at >= ? AND m.completed_at <= ?`
    )
    .all(userId, from, to)
    .map((row) => ({ title: row.title, objectiveTitle: row.objective_title }));

  // Projects and objectives that saw work this week, with where they now stand.
  const movedProjects = db
    .prepare(
      `SELECT DISTINCT p.id, p.name FROM task_completions c
       JOIN tasks t ON t.id = c.task_id
       JOIN projects p ON p.id = t.project_id
       WHERE c.user_id = ? AND c.completed_at >= ? AND c.completed_at <= ?`
    )
    .all(userId, from, to)
    .map((row) => {
      const progress = projectProgress(userId, row.id);
      return { name: row.name, done: progress.done, total: progress.total, progress: progress.percent };
    });

  const movedObjectives = db
    .prepare(
      `SELECT DISTINCT o.id, o.title, o.horizon, o.deadline, o.status, o.progress_mode, o.progress_manual
       FROM task_completions c
       JOIN tasks t ON t.id = c.task_id
       JOIN objectives o ON o.id = t.objective_id
       WHERE c.user_id = ? AND c.completed_at >= ? AND c.completed_at <= ?`
    )
    .all(userId, from, to)
    .map((row) => ({ title: row.title, progress: objectiveProgress(userId, row) }));

  /* ----------------------------- What is next ------------------------- */

  const ahead = db
    .prepare(
      `SELECT t.title, t.due_date, t.priority, t.important FROM tasks t
       WHERE t.user_id = ? AND t.status IN ('not_started','in_progress')
         AND t.due_date BETWEEN ? AND ?
       ORDER BY t.due_date ASC, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
       LIMIT 8`
    )
    .all(userId, addDays(end, 1), addDays(end, 7))
    .map((row) => ({
      title: row.title,
      dueDate: row.due_date,
      priority: row.priority,
      important: Boolean(row.important),
    }));

  return {
    periodStart: start,
    periodEnd: end,
    generatedFor: today,
    isCurrentWeek: start === startOfWeekFor(today, Number(user.week_start ?? 1)),
    completed: {
      count: completions.length,
      previousCount: previous,
      items: completions.map((row) => ({
        title: row.title,
        on: row.completed_at.slice(0, 10),
        areaName: row.area_name,
      })),
      byDay,
      busiestDay: busiest?.count ? busiest.day : null,
    },
    slipped,
    lingering,
    byArea,
    untouched,
    wentQuiet,
    milestones,
    movedProjects,
    movedObjectives,
    ahead,
  };
}

/* ------------------------------------------------------------------ *
 * Questions worth answering
 * ------------------------------------------------------------------ */

/**
 * Prompts are drawn from what the week actually looked like. They are
 * questions, not observations dressed as questions — the point is to hand the
 * thinking back to the person rather than to conclude on their behalf.
 */
export function reflectionPrompts(review) {
  const prompts = [];
  const { completed, slipped, movedObjectives, lingering, milestones } = review;

  if (milestones.length) {
    prompts.push(`You reached ${milestones.length === 1 ? 'a milestone' : `${milestones.length} milestones`} this week. What made that possible?`);
  } else if (movedObjectives.length) {
    prompts.push(`${movedObjectives[0].title} moved forward this week. What helped?`);
  }

  if (slipped.length >= 3) {
    prompts.push(`${slipped.length} things were due this week and are still open. Which of them still matter, and which can go?`);
  } else if (slipped.length) {
    prompts.push(`"${slipped[0].title}" was due this week and is still open. Is it still worth doing?`);
  }

  if (review.wentQuiet.length) {
    const named = review.wentQuiet.slice(0, 2).join(' and ');
    prompts.push(`${named} had your attention last week and none this week. Was that a choice, or did it slip out of view?`);
  }

  if (lingering.length && lingering[0].ageDays > 21) {
    prompts.push(`"${lingering[0].title}" has been open for ${lingering[0].ageDays} days. What would it take to finish it — or to let it go?`);
  }

  if (!completed.count) {
    prompts.push('Nothing was completed this week. What was taking your attention instead?');
  } else if (completed.busiestDay) {
    prompts.push(`Most of what you finished landed on ${completed.busiestDay}. Does that match how you want your week to work?`);
  }

  prompts.push('What deserves your attention next week?');
  return prompts.slice(0, 4);
}

/**
 * The one-line reading of the week. Deliberately factual: it never praises a
 * high number or softens a low one.
 */
export function reviewHeadline(review) {
  const { completed, slipped } = review;
  if (!completed.count && !slipped.length) return 'A quiet week — nothing completed and nothing left hanging.';

  const parts = [];
  parts.push(
    completed.count === 1 ? '1 responsibility completed' : `${completed.count} responsibilities completed`
  );
  if (completed.previousCount) {
    parts.push(`against ${completed.previousCount} the week before`);
  }
  if (slipped.length) {
    parts.push(`${slipped.length} still open from the week`);
  }
  return `${parts.join(', ')}.`;
}
