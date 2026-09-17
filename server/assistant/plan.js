import db from '../db.js';
import {
  addDays, classify, daysBetween, clockFor, focusScore, objectiveProgress,
  projectProgress, todayFor,
} from '../domain.js';

/**
 * The plan digest.
 *
 * Every number here is computed in SQL against the signed-in account's own
 * rows. The assistant never counts, never estimates and never infers state —
 * it reads this. That is what makes "you have three overdue" trustworthy in
 * both modes, and it is the same principle as the settings knowledge base:
 * ground the facts, and let language happen on top of them.
 *
 * What is included: titles, dates, priorities, statuses and progress.
 * What is deliberately excluded: descriptions, notes, note bodies and links —
 * the shape of someone's plan, never the contents of what they wrote.
 */

const TASK_COLUMNS = `
  t.id, t.title, t.due_date, t.due_time, t.priority, t.important, t.meaningful,
  t.status, t.recurrence, t.objective_id, t.project_id, t.updated_at, t.created_at,
  p.name AS project_name, a.name AS area_name, o.title AS objective_title
`;
const TASK_JOINS = `
  LEFT JOIN projects   p ON p.id = t.project_id
  LEFT JOIN areas      a ON a.id = t.area_id
  LEFT JOIN objectives o ON o.id = t.objective_id
`;

export function buildPlanDigest(user) {
  const userId = user.id;
  const today = todayFor(user.timezone);
  const now = clockFor(user.timezone);

  const open = db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks t ${TASK_JOINS}
       WHERE t.user_id = ? AND t.status IN ('not_started','in_progress')`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      dueDate: row.due_date,
      dueTime: row.due_time,
      priority: row.priority,
      important: Boolean(row.important),
      status: row.status,
      recurring: Boolean(row.recurrence),
      projectName: row.project_name,
      areaName: row.area_name,
      objectiveTitle: row.objective_title,
      ...classify(row, today),
      focus: focusScore(row, today, now),
    }));

  // Short references. The assistant cites these when proposing an action, so
  // it never has to transcribe an identifier — and a reference it invents
  // simply fails to resolve rather than pointing at the wrong thing.
  open.forEach((task, index) => {
    task.ref = `T${index + 1}`;
  });

  const byFocus = (a, b) => b.focus - a.focus;
  const overdue = open.filter((t) => t.overdue).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const dueToday = open.filter((t) => t.dueDate === today).sort(byFocus);
  const inProgress = open.filter((t) => t.status === 'in_progress').sort(byFocus);
  const importantOpen = open.filter((t) => t.important && !t.overdue).sort(byFocus);
  const unscheduled = open.filter((t) => !t.dueDate).sort(byFocus);

  const between = (from, to) =>
    open
      .filter((t) => t.dueDate && t.dueDate >= from && t.dueDate <= to)
      .sort((a, b) => (a.dueDate === b.dueDate ? b.focus - a.focus : a.dueDate < b.dueDate ? -1 : 1));

  const focus = [...overdue, ...dueToday, ...inProgress.filter((t) => !t.dueDate)]
    .filter((task, index, list) => list.findIndex((t) => t.id === task.id) === index)
    .sort(byFocus)
    .slice(0, 10);

  const objectives = db
    .prepare(
      `SELECT o.*, a.name AS area_name FROM objectives o LEFT JOIN areas a ON a.id = o.area_id
       WHERE o.user_id = ? AND o.status = 'active' ORDER BY o.deadline IS NULL, o.deadline ASC LIMIT 12`
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      horizon: row.horizon,
      deadline: row.deadline,
      areaName: row.area_name,
      progress: objectiveProgress(userId, row),
      daysLeft: row.deadline ? daysBetween(today, row.deadline) : null,
      milestones: db
        .prepare(`SELECT title, status FROM milestones WHERE user_id = ? AND objective_id = ? ORDER BY position`)
        .all(userId, row.id)
        .map((m) => ({ title: m.title, done: m.status === 'completed' })),
    }));

  const projects = db
    .prepare(
      `SELECT p.*, o.title AS objective_title FROM projects p
       LEFT JOIN objectives o ON o.id = p.objective_id
       WHERE p.user_id = ? AND p.status IN ('active','planning')
       ORDER BY p.deadline IS NULL, p.deadline ASC LIMIT 12`
    )
    .all(userId)
    .map((row) => {
      const progress = projectProgress(userId, row.id);
      return {
        id: row.id,
        name: row.name,
        status: row.status,
        deadline: row.deadline,
        objectiveTitle: row.objective_title,
        done: progress.done,
        total: progress.total,
        progress: progress.percent,
        daysLeft: row.deadline ? daysBetween(today, row.deadline) : null,
      };
    });

  const completedRecently = db
    .prepare(
      `SELECT title, completed_at FROM task_completions
       WHERE user_id = ? AND completed_at >= ? ORDER BY completed_at DESC LIMIT 12`
    )
    .all(userId, `${addDays(today, -7)}T00:00:00.000Z`)
    .map((row) => ({ title: row.title, on: row.completed_at.slice(0, 10) }));

  const completedToday = db
    .prepare(`SELECT COUNT(*) AS n FROM task_completions WHERE user_id = ? AND completed_at >= ?`)
    .get(userId, `${today}T00:00:00.000Z`).n;
  const completedThisWeek = db
    .prepare(`SELECT COUNT(*) AS n FROM task_completions WHERE user_id = ? AND completed_at >= ?`)
    .get(userId, `${addDays(today, -6)}T00:00:00.000Z`).n;

  const events = db
    .prepare(
      `SELECT title, start_date, start_time FROM events
       WHERE user_id = ? AND start_date BETWEEN ? AND ? ORDER BY start_date, start_time LIMIT 10`
    )
    .all(userId, today, addDays(today, 7))
    .map((row) => ({ title: row.title, date: row.start_date, time: row.start_time }));

  return {
    today,
    timezone: user.timezone,
    // Every open responsibility, keyed by its short reference, so a proposed
    // action can be resolved back to a real row belonging to this account.
    refIndex: open.map((task) => ({ ref: task.ref, id: task.id, title: task.title })),
    counts: {
      open: open.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      inProgress: inProgress.length,
      important: importantOpen.length,
      unscheduled: unscheduled.length,
      completedToday,
      completedThisWeek,
      activeObjectives: objectives.length,
      activeProjects: projects.length,
    },
    focus,
    overdue,
    dueToday,
    inProgress,
    important: importantOpen,
    unscheduled,
    tomorrow: between(addDays(today, 1), addDays(today, 1)),
    next7: between(addDays(today, 1), addDays(today, 7)),
    next30: between(addDays(today, 8), addDays(today, 30)),
    objectives,
    projects,
    completedRecently,
    events,
  };
}

/* ------------------------------------------------------------------ *
 * Phrasing
 * ------------------------------------------------------------------ */

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function whenLabel(task, today) {
  if (!task.dueDate) return 'no date';
  const delta = daysBetween(today, task.dueDate);
  if (delta < 0) return `${plural(Math.abs(delta), 'day', 'days')} overdue`;
  if (delta === 0) return task.dueTime ? `today at ${task.dueTime}` : 'today';
  if (delta === 1) return 'tomorrow';
  if (delta <= 7) return `in ${delta} days`;
  return task.dueDate;
}

/**
 * One line per responsibility. The prompt form carries the short reference so
 * the assistant can point at something precisely; the form shown to a person
 * leaves it out, because it is machinery they did not ask to see.
 */
function taskLine(task, today, { withRef = false } = {}) {
  const bits = [whenLabel(task, today)];
  if (task.priority !== 'medium') bits.push(task.priority);
  if (task.important) bits.push('important');
  if (task.projectName) bits.push(task.projectName);
  else if (task.areaName) bits.push(task.areaName);
  return `- ${withRef && task.ref ? `[${task.ref}] ` : ''}${task.title} (${bits.join(', ')})`;
}

/**
 * A compact rendering of the digest for the system prompt. Sits after the
 * cached knowledge base, since it changes with every request.
 */
export function renderPlanForPrompt(digest) {
  const { today, counts } = digest;
  const lines = [
    `Today is ${today} (${digest.timezone}).`,
    `Open: ${counts.open}. Overdue: ${counts.overdue}. Due today: ${counts.dueToday}. In progress: ${counts.inProgress}. Undated: ${counts.unscheduled}.`,
    `Completed today: ${counts.completedToday}. Completed in the last 7 days: ${counts.completedThisWeek}.`,
  ];

  const section = (heading, tasks, limit = 10) => {
    if (!tasks.length) return;
    lines.push('', heading);
    tasks.slice(0, limit).forEach((task) => lines.push(taskLine(task, today, { withRef: true })));
  };

  section('OVERDUE', digest.overdue);
  section('DUE TODAY', digest.dueToday);
  section('IN PROGRESS', digest.inProgress.filter((t) => !t.dueDate || t.dueDate > today));
  section('NEXT 7 DAYS', digest.next7);
  section('IMPORTANT, NOT YET DUE', digest.important, 6);
  section('NO DATE', digest.unscheduled, 6);

  if (digest.objectives.length) {
    lines.push('', 'ACTIVE OBJECTIVES');
    for (const objective of digest.objectives) {
      const done = objective.milestones.filter((m) => m.done).length;
      const when = objective.daysLeft === null
        ? 'no deadline'
        : objective.daysLeft < 0
          ? `${Math.abs(objective.daysLeft)} days past deadline`
          : `${objective.daysLeft} days left`;
      lines.push(
        `- ${objective.title} — ${objective.progress}% complete, ${done}/${objective.milestones.length} milestones, ${when}`
      );
    }
  }

  if (digest.projects.length) {
    lines.push('', 'ACTIVE PROJECTS');
    for (const project of digest.projects) {
      const when = project.daysLeft === null
        ? 'no deadline'
        : project.daysLeft < 0
          ? `${Math.abs(project.daysLeft)} days past deadline`
          : `${project.daysLeft} days left`;
      lines.push(`- ${project.name} — ${project.done}/${project.total} done (${project.progress}%), ${when}`);
    }
  }

  if (digest.completedRecently.length) {
    lines.push('', 'COMPLETED IN THE LAST 7 DAYS');
    digest.completedRecently.forEach((row) => lines.push(`- ${row.title} (${row.on})`));
  }

  if (digest.events.length) {
    lines.push('', 'EVENTS THIS WEEK');
    digest.events.forEach((row) => lines.push(`- ${row.title} (${row.date}${row.time ? ` ${row.time}` : ''})`));
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Answering plan questions without a model
 * ------------------------------------------------------------------ */

/**
 * Plan intents. Each requires the message to read as a question, so that a
 * responsibility someone is dictating ("finish the overdue invoices") is not
 * mistaken for a request to list what is overdue.
 */
const INTENTS = [
  { id: 'overdue', re: /\b(overdue|past due|behind|slipping|late|falling behind|fallen behind)\b/i },
  { id: 'today', re: /\b(today|right now|start with|focus on|attention (now|today)|first thing)\b/i },
  { id: 'upcoming', re: /\b(upcoming|coming up|this week|next week|week ahead|ahead of me|next (7|seven) days|rest of (the|this) week|tomorrow)\b/i },
  { id: 'objectives', re: /\b(objectives?|goals?)\b/i },
  { id: 'projects', re: /\b(projects?)\b/i },
  { id: 'completed', re: /\b(completed|finished|got done|achieved|accomplished)\b/i },
  { id: 'workload', re: /\b(how many|how much|on my plate|workload|capacity|busy|too much|open (tasks|items|responsibilities))\b/i },
  { id: 'important', re: /\b(important|matters most|meaningful)\b/i },
  { id: 'unscheduled', re: /\b(undated|no date|unscheduled|without a date)\b/i },
];

/**
 * Questions about how TELOS works, rather than about what is in the plan.
 * "What is the difference between important and urgent?" mentions a word the
 * plan intents watch for, but it is asking for a definition — so plan
 * matching stands aside and lets the knowledge base answer.
 */
const DEFINITIONAL =
  /\b(difference between|what does .{0,50}\bmean\b|what is meant by|how (do|does) .{0,60}\b(work|works|handle|handles|behave|behaves)\b|what counts as|explain|should i use)\b/i;

/**
 * Fuzzy match against the names of objectives and projects.
 *
 * An exact name beats a partial one, and the kind the question actually names
 * wins a tie — "how is the portfolio website project going" must not resolve
 * to an objective that happens to share the word "portfolio".
 */
function namedThing(text, digest) {
  const haystack = text.toLowerCase();
  const wantsProject = /\bprojects?\b/i.test(text);
  const wantsObjective = /\b(objectives?|goals?)\b/i.test(text);

  const candidates = [
    ...digest.objectives.map((o) => ({ kind: 'objective', name: o.title, item: o })),
    ...digest.projects.map((p) => ({ kind: 'project', name: p.name, item: p })),
  ];

  let best = null;
  for (const candidate of candidates) {
    const name = candidate.name.toLowerCase();
    let score;

    if (haystack.includes(name)) {
      score = 100 + name.length;
    } else {
      const words = name.split(/\s+/).filter((word) => word.length > 4);
      const hits = words.filter((word) => haystack.includes(word)).length;
      if (!hits) continue;
      score = hits * 10;
    }

    if (wantsProject && candidate.kind === 'project') score += 25;
    if (wantsObjective && candidate.kind === 'objective') score += 25;
    if (!best || score > best.score) best = { ...candidate, score };
  }
  return best;
}

const list = (tasks, today, limit = 8) =>
  tasks.slice(0, limit).map((task) => taskLine(task, today));

/**
 * Answers a question about the plan from the digest alone. Returns null when
 * the message is not a plan question, so the caller can fall through to the
 * knowledge base or the wording rules.
 */
export function answerFromPlan(text, digest, { isQuestion }) {
  if (!isQuestion) return null;
  if (DEFINITIONAL.test(text)) return null;
  const { today, counts } = digest;

  // "How is the portfolio objective going?" — a specific thing, by name.
  const named = namedThing(text, digest);
  if (named && /\b(going|progress|status|how|doing|far along|left|remaining)\b/i.test(text)) {
    if (named.kind === 'objective') {
      const o = named.item;
      const done = o.milestones.filter((m) => m.done);
      const next = o.milestones.find((m) => !m.done);
      const related = digest.focus.filter((t) => t.objectiveTitle === o.title);
      return {
        reply: [
          `**${o.title}** — ${o.progress}% complete.`,
          '',
          `${done.length} of ${o.milestones.length} milestones done${
            o.daysLeft === null ? '' : o.daysLeft < 0
              ? `, ${Math.abs(o.daysLeft)} days past its deadline`
              : `, ${o.daysLeft} days until the deadline`
          }.`,
          next ? `Next milestone: ${next.title}.` : 'Every milestone is complete.',
          related.length ? '' : null,
          related.length ? 'Needing attention now:' : null,
          ...(related.length ? list(related, today, 5) : []),
        ].filter((line) => line !== null).join('\n'),
        sources: ['Your objectives'],
      };
    }
    const p = named.item;
    return {
      reply: [
        `**${p.name}** — ${p.done} of ${p.total} responsibilities complete (${p.progress}%).`,
        p.daysLeft === null
          ? 'No deadline set.'
          : p.daysLeft < 0
            ? `Its deadline passed ${Math.abs(p.daysLeft)} days ago.`
            : `${p.daysLeft} days until its deadline.`,
        p.objectiveTitle ? `It serves "${p.objectiveTitle}".` : null,
      ].filter(Boolean).join('\n'),
      sources: ['Your projects'],
    };
  }

  const intent = INTENTS.find((entry) => entry.re.test(text));
  if (!intent) return null;

  switch (intent.id) {
    case 'overdue':
      return {
        reply: counts.overdue
          ? [
              `${plural(counts.overdue, 'responsibility is', 'responsibilities are')} past their date.`,
              '',
              ...list(digest.overdue, today),
              counts.overdue > 8 ? `\n…and ${counts.overdue - 8} more.` : '',
              '\nWorth deciding whether each still matters, rather than moving them all forward.',
            ].filter(Boolean).join('\n')
          : 'Nothing is overdue. Everything with a date is still ahead of you.',
        sources: ['Your plan'],
      };

    case 'today': {
      if (!digest.focus.length) {
        return {
          reply: counts.completedToday
            ? `Your day is clear. ${plural(counts.completedToday, 'responsibility has', 'responsibilities have')} been completed today.`
            : 'Your day is clear — nothing is due or overdue.',
          sources: ['Your plan'],
        };
      }
      return {
        reply: [
          counts.overdue
            ? `${plural(counts.dueToday, 'thing is', 'things are')} due today, and ${plural(counts.overdue, 'is', 'are')} already overdue.`
            : `${plural(counts.dueToday, 'thing is', 'things are')} due today.`,
          '',
          'In the order I would take them:',
          ...list(digest.focus, today),
          counts.completedToday ? `\nYou have already completed ${counts.completedToday} today.` : '',
        ].filter(Boolean).join('\n'),
        sources: ['Your plan'],
      };
    }

    case 'upcoming': {
      const tomorrow = digest.tomorrow;
      const week = digest.next7;
      if (!week.length) {
        return { reply: 'Nothing scheduled in the next seven days. You have some room to breathe.', sources: ['Your plan'] };
      }
      return {
        reply: [
          `${plural(week.length, 'thing is', 'things are')} due in the next seven days${
            tomorrow.length ? `, ${tomorrow.length} of them tomorrow` : ''
          }.`,
          '',
          ...list(week, today, 10),
          digest.next30.length ? `\nAnd ${plural(digest.next30.length, 'more', 'more')} later in the month.` : '',
        ].filter(Boolean).join('\n'),
        sources: ['Your plan'],
      };
    }

    case 'objectives': {
      if (!digest.objectives.length) {
        return { reply: 'You have no active objectives yet. An objective is an outcome you are moving toward — it gives the daily work a direction to point at.', sources: ['Your plan'] };
      }
      return {
        reply: [
          `${plural(digest.objectives.length, 'active objective', 'active objectives')}:`,
          '',
          ...digest.objectives.map((o) => {
            const done = o.milestones.filter((m) => m.done).length;
            const when = o.daysLeft === null ? '' : o.daysLeft < 0
              ? `, ${Math.abs(o.daysLeft)} days past deadline`
              : `, ${o.daysLeft} days left`;
            return `- ${o.title} — ${o.progress}%, ${done}/${o.milestones.length} milestones${when}`;
          }),
        ].join('\n'),
        sources: ['Your objectives'],
      };
    }

    case 'projects': {
      if (!digest.projects.length) {
        return { reply: 'You have no active projects. Create one when several responsibilities begin moving toward a shared outcome.', sources: ['Your plan'] };
      }
      return {
        reply: [
          `${plural(digest.projects.length, 'active project', 'active projects')}:`,
          '',
          ...digest.projects.map((p) => {
            const when = p.daysLeft === null ? '' : p.daysLeft < 0
              ? `, ${Math.abs(p.daysLeft)} days past deadline`
              : `, ${p.daysLeft} days left`;
            return `- ${p.name} — ${p.done}/${p.total} done (${p.progress}%)${when}`;
          }),
        ].join('\n'),
        sources: ['Your projects'],
      };
    }

    case 'completed':
      return {
        reply: counts.completedThisWeek
          ? [
              `${plural(counts.completedThisWeek, 'responsibility', 'responsibilities')} completed in the last seven days${
                counts.completedToday ? `, ${counts.completedToday} of them today` : ''
              }.`,
              '',
              ...digest.completedRecently.slice(0, 8).map((row) => `- ${row.title} (${row.on})`),
            ].join('\n')
          : 'Nothing completed in the last seven days.',
        sources: ['Your completion history'],
      };

    case 'important':
      return {
        reply: digest.important.length
          ? [
              `${plural(digest.important.length, 'thing is', 'things are')} marked important and not yet due.`,
              '',
              ...list(digest.important, today),
              '\nImportant is not the same as urgent — these are the ones worth protecting time for.',
            ].join('\n')
          : 'Nothing is currently marked important. Marking what matters keeps it from being crowded out by whatever is loudest.',
        sources: ['Your plan'],
      };

    case 'unscheduled':
      return {
        reply: digest.unscheduled.length
          ? [
              `${plural(digest.unscheduled.length, 'open responsibility has', 'open responsibilities have')} no date.`,
              '',
              ...list(digest.unscheduled, today),
            ].join('\n')
          : 'Everything open has a date.',
        sources: ['Your plan'],
      };

    case 'workload':
    default:
      return {
        reply: [
          `You are holding ${plural(counts.open, 'open responsibility', 'open responsibilities')}.`,
          '',
          `- ${counts.overdue} overdue`,
          `- ${counts.dueToday} due today`,
          `- ${digest.next7.length} in the next seven days`,
          `- ${counts.unscheduled} with no date`,
          `- ${counts.important} marked important`,
          '',
          `Across ${plural(counts.activeProjects, 'active project', 'active projects')} and ${plural(counts.activeObjectives, 'objective', 'objectives')}. ${plural(counts.completedThisWeek, 'completed', 'completed')} in the last seven days.`,
        ].join('\n'),
        sources: ['Your plan'],
      };
  }
}
