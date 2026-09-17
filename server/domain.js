import db, { newId, nowIso } from './db.js';

/* ------------------------------------------------------------------ *
 * Calendar-date helpers. Dates are stored as plain YYYY-MM-DD strings
 * and manipulated in UTC so that arithmetic never drifts across a
 * daylight-saving boundary.
 * ------------------------------------------------------------------ */

export const toDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const toYmd = (date) => date.toISOString().slice(0, 10);
export const addDays = (ymd, n) => {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
};
export const addMonths = (ymd, n) => {
  const d = toDate(ymd);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toYmd(d);
};
/**
 * Adds whole years, clamping to the end of the month so that a date anchored
 * on 29 February lands on 28 February in a common year rather than sliding
 * into March.
 */
export const addYears = (ymd, n) => {
  const d = toDate(ymd);
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = d.getUTCFullYear() + n;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toYmd(new Date(Date.UTC(year, month, Math.min(day, lastDay))));
};
export const weekdayOf = (ymd) => toDate(ymd).getUTCDay(); // 0 = Sunday

/** The first day of the week containing `ymd`, honouring the account's setting. */
export const startOfWeekFor = (ymd, weekStart = 1) =>
  addDays(ymd, -((weekdayOf(ymd) - weekStart + 7) % 7));
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);

/** "Today" in the user's own timezone, as YYYY-MM-DD. */
export function todayFor(timezone = 'UTC', at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
    return parts;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Current wall-clock time (HH:MM) in the user's timezone. */
export function clockFor(timezone = 'UTC', at = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/**
 * The offset, in milliseconds, of `timeZone` at a given instant.
 * Derived from Intl rather than hard-coded, so DST is handled correctly.
 */
function zoneOffsetMs(instant, timeZone) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
        .formatToParts(instant)
        .map((p) => [p.type, p.value])
    );
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)
    );
    return asUtc - instant.getTime();
  } catch {
    return 0;
  }
}

/** Converts a local wall-clock date/time in `timeZone` to a UTC instant. */
export function zonedToUtc(ymd, hhmm = '00:00', timeZone = 'UTC') {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  // Two passes settle the ambiguity around a DST transition.
  let offset = zoneOffsetMs(new Date(naive), timeZone);
  offset = zoneOffsetMs(new Date(naive - offset), timeZone);
  return new Date(naive - offset);
}

/* ------------------------------------------------------------------ *
 * Recurrence
 * ------------------------------------------------------------------ */

const nextWeekdayOnOrAfter = (ymd, weekdays) => {
  for (let i = 0; i < 14; i += 1) {
    const candidate = addDays(ymd, i);
    if (weekdays.includes(weekdayOf(candidate))) return candidate;
  }
  return ymd;
};

/**
 * The next occurrence strictly after `from`, following `rule`.
 * `anchor` is the original due date, used to preserve day-of-month and
 * weekday intent when the rule does not state them explicitly.
 */
export function nextOccurrence(rule, from, anchor = from) {
  if (!rule || !from) return null;
  const base = from;
  switch (rule.freq) {
    case 'daily':
      return addDays(base, 1);

    case 'weekdays': {
      let next = addDays(base, 1);
      while ([0, 6].includes(weekdayOf(next))) next = addDays(next, 1);
      return next;
    }

    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [weekdayOf(anchor)];
      return nextWeekdayOnOrAfter(addDays(base, 1), days);
    }

    case 'biweekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [weekdayOf(anchor)];
      if (rule.weekdays?.length > 1) {
        // Multiple weekdays: advance within the cycle, skipping the off week.
        const next = nextWeekdayOnOrAfter(addDays(base, 1), days);
        const weeksFromAnchor = Math.floor(daysBetween(anchor, next) / 7);
        return weeksFromAnchor % 2 === 0 ? next : addDays(next, 7);
      }
      return addDays(nextWeekdayOnOrAfter(addDays(base, 1), days), 7);
    }

    case 'monthly':
      return addMonths(base, 1);

    case 'monthly_date': {
      const target = rule.day || toDate(anchor).getUTCDate();
      let cursor = addMonths(base, 1);
      const d = toDate(cursor);
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(target, lastDay));
      cursor = toYmd(d);
      return cursor > base ? cursor : addMonths(cursor, 1);
    }

    case 'quarterly':
      return addMonths(base, 3);

    case 'yearly':
      return addYears(base, 1);

    case 'custom': {
      const every = rule.every || 1;
      if (rule.unit === 'week') return addDays(base, every * 7);
      if (rule.unit === 'month') return addMonths(base, every);
      if (rule.unit === 'year') return addYears(base, every);
      return addDays(base, every);
    }

    default:
      return null;
  }
}

/**
 * Every occurrence of a recurring task within [from, to].
 * Bounded so a pathological rule cannot spin.
 */
export function expandOccurrences(rule, startYmd, from, to, endYmd = null, limit = 400) {
  if (!rule || !startYmd) return [];
  const out = [];
  let cursor = startYmd;
  let guard = 0;

  // Wind forward to the window without emitting.
  while (cursor < from && guard < 3000) {
    const next = nextOccurrence(rule, cursor, startYmd);
    if (!next || next <= cursor) break;
    cursor = next;
    guard += 1;
  }
  while (cursor <= to && out.length < limit && guard < 3000) {
    if (endYmd && cursor > endYmd) break;
    if (cursor >= from) out.push(cursor);
    const next = nextOccurrence(rule, cursor, startYmd);
    if (!next || next <= cursor) break;
    cursor = next;
    guard += 1;
  }
  return out;
}

export function describeRecurrence(rule) {
  if (!rule) return '';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (rule.freq) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Every weekday';
    case 'weekly':
      return rule.weekdays?.length
        ? `Every ${rule.weekdays.map((d) => names[d]).join(', ')}`
        : 'Every week';
    case 'biweekly': return 'Every two weeks';
    case 'monthly': return 'Every month';
    case 'monthly_date': return `Day ${rule.day} of each month`;
    case 'quarterly': return 'Every quarter';
    case 'yearly': return 'Every year';
    case 'custom': return `Every ${rule.every} ${rule.unit}${rule.every > 1 ? 's' : ''}`;
    default: return 'Recurring';
  }
}

/* ------------------------------------------------------------------ *
 * Progress rollups
 *
 * Progress flows upward: subtasks inform a task's partial completion,
 * tasks inform projects and milestones, milestones inform objectives.
 * ------------------------------------------------------------------ */

const q = {
  projectTasks: db.prepare(
    `SELECT status FROM tasks WHERE user_id = ? AND project_id = ? AND status != 'cancelled'`
  ),
  milestoneProjects: db.prepare(
    `SELECT id FROM projects WHERE user_id = ? AND milestone_id = ? AND status != 'cancelled'`
  ),
  milestoneTasks: db.prepare(
    `SELECT status FROM tasks WHERE user_id = ? AND milestone_id = ? AND project_id IS NULL AND status != 'cancelled'`
  ),
  objectiveMilestones: db.prepare(
    `SELECT id, status FROM milestones WHERE user_id = ? AND objective_id = ?`
  ),
  objectiveProjects: db.prepare(
    `SELECT id FROM projects WHERE user_id = ? AND objective_id = ? AND milestone_id IS NULL AND status != 'cancelled'`
  ),
  objectiveTasks: db.prepare(
    `SELECT status FROM tasks WHERE user_id = ? AND objective_id = ? AND project_id IS NULL AND milestone_id IS NULL AND status != 'cancelled'`
  ),
};

const ratio = (done, total) => (total > 0 ? done / total : 0);

export function projectProgress(userId, projectId) {
  const rows = q.projectTasks.all(userId, projectId);
  const done = rows.filter((r) => r.status === 'completed').length;
  return { done, total: rows.length, percent: Math.round(ratio(done, rows.length) * 100) };
}

export function milestoneProgress(userId, milestoneId, status) {
  if (status === 'completed') return { percent: 100, done: 0, total: 0 };
  const projects = q.milestoneProjects.all(userId, milestoneId);
  const directTasks = q.milestoneTasks.all(userId, milestoneId);
  const parts = [];
  for (const p of projects) parts.push(projectProgress(userId, p.id).percent);
  const doneDirect = directTasks.filter((t) => t.status === 'completed').length;
  if (directTasks.length) parts.push(Math.round(ratio(doneDirect, directTasks.length) * 100));
  const percent = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;
  return {
    percent,
    done: doneDirect,
    total: directTasks.length,
    projectCount: projects.length,
  };
}

export function objectiveProgress(userId, objective) {
  if (objective.status === 'completed') return 100;
  if (objective.progress_mode === 'manual') {
    return Math.max(0, Math.min(100, objective.progress_manual || 0));
  }
  const milestones = q.objectiveMilestones.all(userId, objective.id);
  const parts = [];
  for (const m of milestones) {
    parts.push(m.status === 'completed' ? 100 : milestoneProgress(userId, m.id, m.status).percent);
  }
  for (const p of q.objectiveProjects.all(userId, objective.id)) {
    parts.push(projectProgress(userId, p.id).percent);
  }
  const loose = q.objectiveTasks.all(userId, objective.id);
  if (loose.length) {
    const done = loose.filter((t) => t.status === 'completed').length;
    parts.push(Math.round(ratio(done, loose.length) * 100));
  }
  if (!parts.length) return 0;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

/* ------------------------------------------------------------------ *
 * Prioritisation
 *
 * TELOS deliberately separates urgency from importance. Focus ordering
 * blends: how soon something is due, whether the user marked it
 * important, its stated priority, whether it belongs to an active
 * objective, and whether it has already been started.
 * ------------------------------------------------------------------ */

const PRIORITY_WEIGHT = { urgent: 34, high: 24, medium: 12, low: 4 };

export function focusScore(task, today, nowClock = '00:00') {
  let score = 0;

  if (task.due_date) {
    const delta = daysBetween(today, task.due_date);
    if (delta < 0) score += 46 + Math.min(18, Math.abs(delta) * 2); // overdue
    else if (delta === 0) score += 40;
    else if (delta === 1) score += 26;
    else if (delta <= 3) score += 18;
    else if (delta <= 7) score += 11;
    else if (delta <= 30) score += 5;
    else score += 2;

    // Time-of-day pressure for items due today.
    if (delta === 0 && task.due_time) {
      score += task.due_time <= nowClock ? 12 : 6;
    }
  } else {
    score += 3; // undated work still deserves consideration, but quietly
  }

  score += PRIORITY_WEIGHT[task.priority] ?? 12;
  if (task.important) score += 22;
  if (task.meaningful) score += 8;
  if (task.status === 'in_progress') score += 10;
  if (task.objective_id) score += 6;
  if (task.project_id) score += 3;
  if (task.recurrence) score += 2;

  return score;
}

/** Classification used by the dashboard's language, not just its ordering. */
export function classify(task, today) {
  const delta = task.due_date ? daysBetween(today, task.due_date) : null;
  const overdue = delta !== null && delta < 0 && task.status !== 'completed';
  const urgent =
    !overdue &&
    delta !== null &&
    delta <= 1 &&
    (task.priority === 'urgent' || task.priority === 'high' || delta <= 0);
  const important = Boolean(task.important) || task.priority === 'urgent';
  const meaningful = Boolean(task.meaningful) || (Boolean(task.objective_id) && !urgent && !overdue);
  return { overdue, urgent, important, meaningful, daysUntilDue: delta };
}

/* ------------------------------------------------------------------ *
 * Completion history
 * ------------------------------------------------------------------ */

export function recordCompletion(userId, task, occurrenceDate = null) {
  db.prepare(
    `INSERT INTO task_completions (id, user_id, task_id, title, area_id, project_id, priority, occurrence_date, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    userId,
    task.id,
    task.title,
    task.area_id,
    task.project_id,
    task.priority,
    occurrenceDate || task.due_date,
    nowIso()
  );
}
