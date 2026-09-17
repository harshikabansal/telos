import express from 'express';
import db from '../db.js';
import { wrap } from '../middleware.js';
import { addDays, daysBetween, todayFor } from '../domain.js';
import { objectiveProgress, projectProgress } from '../domain.js';

const router = express.Router();

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

/**
 * Insights are framed for reflection: completion, distribution and rhythm.
 * There is deliberately no score, no streak and no comparison to anyone else.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const userId = req.user.id;
    const today = todayFor(req.user.timezone);
    const rangeKey = RANGES[req.query.range] ? req.query.range : '30d';
    const days = RANGES[rangeKey];
    const start = addDays(today, -(days - 1));
    const startIso = `${start}T00:00:00.000Z`;

    const completions = db
      .prepare(
        `SELECT c.*, a.name AS area_name, a.color AS area_color
         FROM task_completions c LEFT JOIN areas a ON a.id = c.area_id
         WHERE c.user_id = ? AND c.completed_at >= ?`
      )
      .all(userId, startIso);

    // Completion by day, with a zero-filled series so the shape is honest.
    const byDay = new Map();
    for (let i = 0; i < days; i += 1) byDay.set(addDays(start, i), 0);
    for (const row of completions) {
      const day = row.completed_at.slice(0, 10);
      if (byDay.has(day)) byDay.set(day, byDay.get(day) + 1);
    }
    const daily = [...byDay.entries()].map(([date, count]) => ({ date, count }));

    // Rhythm: which weekdays and which parts of the day carry the work.
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byWeekday = weekdayNames.map((name) => ({ weekday: name, count: 0 }));
    const blocks = [
      { label: 'Early morning', from: 5, to: 9, count: 0 },
      { label: 'Morning', from: 9, to: 12, count: 0 },
      { label: 'Afternoon', from: 12, to: 17, count: 0 },
      { label: 'Evening', from: 17, to: 21, count: 0 },
      { label: 'Night', from: 21, to: 29, count: 0 },
    ];
    for (const row of completions) {
      const when = new Date(row.completed_at);
      byWeekday[when.getUTCDay()].count += 1;
      let hour = when.getUTCHours();
      const block = blocks.find((b) => (hour >= b.from && hour < b.to) || (b.to > 24 && (hour >= b.from || hour < b.to - 24)));
      if (block) block.count += 1;
    }

    const openTasks = db
      .prepare(
        `SELECT t.*, a.name AS area_name, a.color AS area_color FROM tasks t
         LEFT JOIN areas a ON a.id = t.area_id
         WHERE t.user_id = ? AND t.status IN ('not_started','in_progress')`
      )
      .all(userId);

    const createdInRange = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND created_at >= ?`)
      .get(userId, startIso).n;

    const completedInRange = completions.length;
    const overdueNow = openTasks.filter((t) => t.due_date && t.due_date < today).length;

    /**
     * Completion rate answers "of the work that was due in this period, how
     * much is finished" — a proportion that stays between 0 and 100. Comparing
     * completions against items merely created in the same window would exceed
     * 100% whenever older work is cleared, which reads as a fault rather than
     * a fact.
     */
    const dueInRange = db
      .prepare(
        `SELECT status FROM tasks
         WHERE user_id = ? AND status != 'cancelled' AND due_date IS NOT NULL
           AND due_date >= ? AND due_date <= ?`
      )
      .all(userId, start, today);
    const settled = dueInRange.filter((t) => t.status === 'completed').length;
    const completionRate = dueInRange.length
      ? Math.round((settled / dueInRange.length) * 100)
      : null;

    const tally = (rows, keyFn) => {
      const map = new Map();
      for (const row of rows) {
        const key = keyFn(row) || 'Unassigned';
        map.set(key, (map.get(key) || 0) + 1);
      }
      return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };

    const areas = db.prepare(`SELECT * FROM areas WHERE user_id = ? ORDER BY position`).all(userId);
    const byArea = areas
      .map((area) => ({
        id: area.id,
        label: area.name,
        color: area.color,
        open: openTasks.filter((t) => t.area_id === area.id).length,
        completed: completions.filter((c) => c.area_id === area.id).length,
      }))
      .filter((row) => row.open || row.completed)
      .sort((a, b) => b.open + b.completed - (a.open + a.completed));

    const byPriority = ['urgent', 'high', 'medium', 'low'].map((priority) => ({
      label: priority,
      open: openTasks.filter((t) => t.priority === priority).length,
      completed: completions.filter((c) => c.priority === priority).length,
    }));

    const projects = db
      .prepare(`SELECT * FROM projects WHERE user_id = ? AND status IN ('active','planning') ORDER BY position`)
      .all(userId)
      .map((p) => {
        const progress = projectProgress(userId, p.id);
        return {
          id: p.id, name: p.name, status: p.status, deadline: p.deadline,
          progress: progress.percent, done: progress.done, total: progress.total,
          daysLeft: p.deadline ? daysBetween(today, p.deadline) : null,
        };
      })
      .sort((a, b) => b.progress - a.progress);

    const objectives = db
      .prepare(`SELECT * FROM objectives WHERE user_id = ? AND status = 'active' ORDER BY position`)
      .all(userId)
      .map((o) => ({
        id: o.id, title: o.title, horizon: o.horizon, deadline: o.deadline,
        progress: objectiveProgress(userId, o),
        daysLeft: o.deadline ? daysBetween(today, o.deadline) : null,
      }));

    // Month-over-month and year-to-date trends.
    const monthly = db
      .prepare(
        `SELECT substr(completed_at, 1, 7) AS month, COUNT(*) AS count
         FROM task_completions WHERE user_id = ? AND completed_at >= ?
         GROUP BY month ORDER BY month ASC`
      )
      .all(userId, `${addDays(today, -365)}T00:00:00.000Z`);

    const totalTracked = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?`).get(userId).n;
    const totalCompleted = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'completed'`)
      .get(userId).n;

    const busiest = [...byWeekday].sort((a, b) => b.count - a.count)[0];
    const peakBlock = [...blocks].sort((a, b) => b.count - a.count)[0];

    res.json({
      range: rangeKey,
      today,
      headline: {
        completed: completedInRange,
        created: createdInRange,
        completionRate,
        dueInRange: dueInRange.length,
        settledInRange: settled,
        overallCompletionRate: totalTracked ? Math.round((totalCompleted / totalTracked) * 100) : 0,
        openNow: openTasks.length,
        overdueNow: overdueNow,
        averagePerDay: Math.round((completedInRange / days) * 10) / 10,
      },
      daily,
      byWeekday,
      byBlock: blocks.map(({ label, count }) => ({ label, count })),
      byArea,
      byPriority,
      byProject: projects,
      objectives,
      monthly,
      reflection: {
        busiestDay: busiest?.count ? busiest.weekday : null,
        peakPeriod: peakBlock?.count ? peakBlock.label : null,
        unassigned: tally(openTasks, (t) => t.area_name).find((r) => r.label === 'Unassigned')?.count ?? 0,
      },
    });
  })
);

export default router;
