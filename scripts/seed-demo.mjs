#!/usr/bin/env node
/**
 * Seeds a realistic demo account.
 *
 * The content is deliberately ordinary and believable — the kind of things a
 * real person carries across education, career, finance, health, home and
 * travel — so the interface can be judged on real shapes of data. Everything
 * created here is editable and removable like any other record.
 *
 *   npm run seed              create or refresh the demo account
 *   npm run seed -- --keep    leave an existing demo account untouched
 */

import db, { newId, nowIso } from '../server/db.js';
import { hashPassword } from '../server/security.js';
import { seedDefaultAreas } from '../server/serialize.js';
import { addDays, addMonths, todayFor } from '../server/domain.js';

const EMAIL = process.env.TELOS_DEMO_EMAIL || 'demo@telos.app';
const PASSWORD = process.env.TELOS_DEMO_PASSWORD || 'Intention-2026!';
const NAME = 'Ada Whitfield';
const TZ = 'Europe/London';

const today = todayFor(TZ);
const iso = (ymd, time = '09:00') => `${ymd}T${time}:00.000Z`;

const args = new Set(process.argv.slice(2));

/* ------------------------------------------------------------------ */

const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(EMAIL);
if (existing && args.has('--keep')) {
  console.log(`Demo account ${EMAIL} already exists. Nothing changed.`);
  process.exit(0);
}
if (existing) {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(existing.id);
  console.log('Removed the previous demo account.');
}

const userId = newId();
const now = nowIso();

db.prepare(
  `INSERT INTO users (id, email, name, password_hash, email_verified, timezone, week_start,
                      work_start, work_end, theme, accent, default_priority, default_duration,
                      default_reminder, onboarded, created_at, updated_at)
   VALUES (?, ?, ?, ?, 1, ?, 1, '09:00', '18:00', 'system', 'clay', 'medium', 30, '1h', 1, ?, ?)`
).run(userId, EMAIL, NAME, hashPassword(PASSWORD), TZ, addDays(today, -186) + 'T09:12:00.000Z', now);

seedDefaultAreas(userId);

const areas = Object.fromEntries(
  db.prepare(`SELECT id, name FROM areas WHERE user_id = ?`).all(userId).map((a) => [a.name, a.id])
);

/* ------------------------------- helpers -------------------------------- */

const insertObjective = db.prepare(
  `INSERT INTO objectives (id, user_id, area_id, title, description, horizon, start_date, deadline,
                           status, priority, progress_mode, progress_manual, position, created_at, updated_at)
   VALUES (@id, @user_id, @area_id, @title, @description, @horizon, @start_date, @deadline,
           @status, @priority, 'auto', 0, @position, @created_at, @created_at)`
);
const insertMilestone = db.prepare(
  `INSERT INTO milestones (id, user_id, objective_id, title, description, target_date, status, position, created_at, updated_at, completed_at)
   VALUES (@id, @user_id, @objective_id, @title, '', @target_date, @status, @position, @created_at, @created_at, @completed_at)`
);
const insertProject = db.prepare(
  `INSERT INTO projects (id, user_id, objective_id, milestone_id, area_id, name, description, deadline,
                         priority, status, position, created_at, updated_at)
   VALUES (@id, @user_id, @objective_id, @milestone_id, @area_id, @name, @description, @deadline,
           @priority, @status, @position, @created_at, @created_at)`
);
const insertTask = db.prepare(
  `INSERT INTO tasks (id, user_id, project_id, milestone_id, objective_id, area_id, title, description,
                      notes, start_date, due_date, due_time, priority, important, meaningful, status, tags,
                      links, recurrence, recurrence_end, reminder, estimated_minutes, actual_minutes,
                      position, created_at, updated_at, completed_at)
   VALUES (@id, @user_id, @project_id, @milestone_id, @objective_id, @area_id, @title, @description,
           @notes, @start_date, @due_date, @due_time, @priority, @important, @meaningful, @status, @tags,
           '[]', @recurrence, NULL, @reminder, @estimated_minutes, NULL,
           @position, @created_at, @created_at, @completed_at)`
);
const insertSubtask = db.prepare(
  `INSERT INTO subtasks (id, user_id, task_id, title, done, position, created_at, completed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertCompletion = db.prepare(
  `INSERT INTO task_completions (id, user_id, task_id, title, area_id, project_id, priority, occurrence_date, completed_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertNote = db.prepare(
  `INSERT INTO notes (id, user_id, area_id, project_id, objective_id, title, body, pinned, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const insertEvent = db.prepare(
  `INSERT INTO events (id, user_id, area_id, title, description, location, start_date, start_time,
                       end_date, end_time, all_day, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
);

const objective = (title, opts) => {
  const id = newId();
  insertObjective.run({
    id, user_id: userId, title,
    description: opts.description ?? '',
    area_id: opts.area ?? null,
    horizon: opts.horizon ?? 'year',
    start_date: opts.start ?? null,
    deadline: opts.deadline ?? null,
    status: opts.status ?? 'active',
    priority: opts.priority ?? 'medium',
    position: opts.position ?? 0,
    created_at: opts.created ?? iso(addDays(today, -150)),
  });
  return id;
};

const milestone = (objectiveId, title, opts = {}) => {
  const id = newId();
  insertMilestone.run({
    id, user_id: userId, objective_id: objectiveId, title,
    target_date: opts.target ?? null,
    status: opts.done ? 'completed' : 'active',
    position: opts.position ?? 0,
    created_at: opts.created ?? iso(addDays(today, -140)),
    completed_at: opts.done ? iso(addDays(today, -30)) : null,
  });
  return id;
};

const project = (name, opts) => {
  const id = newId();
  insertProject.run({
    id, user_id: userId, name,
    description: opts.description ?? '',
    objective_id: opts.objective ?? null,
    milestone_id: opts.milestone ?? null,
    area_id: opts.area ?? null,
    deadline: opts.deadline ?? null,
    priority: opts.priority ?? 'medium',
    status: opts.status ?? 'active',
    position: opts.position ?? 0,
    created_at: opts.created ?? iso(addDays(today, -120)),
  });
  return id;
};

let taskPosition = 0;
const task = (title, opts = {}) => {
  const id = newId();
  const createdAt = opts.created ?? iso(addDays(today, -Math.floor(Math.random() * 40) - 1));
  insertTask.run({
    id, user_id: userId, title,
    description: opts.description ?? '',
    notes: opts.notes ?? '',
    project_id: opts.project ?? null,
    milestone_id: opts.milestone ?? null,
    objective_id: opts.objective ?? null,
    area_id: opts.area ?? null,
    start_date: opts.start ?? null,
    due_date: opts.due ?? null,
    due_time: opts.time ?? null,
    priority: opts.priority ?? 'medium',
    important: opts.important ? 1 : 0,
    meaningful: opts.meaningful ? 1 : 0,
    status: opts.status ?? 'not_started',
    tags: JSON.stringify(opts.tags ?? []),
    recurrence: opts.recurrence ? JSON.stringify(opts.recurrence) : null,
    reminder: opts.reminder ?? 'none',
    estimated_minutes: opts.minutes ?? null,
    position: taskPosition++,
    created_at: createdAt,
    completed_at: opts.status === 'completed' ? (opts.completedAt ?? iso(addDays(today, -2), '17:20')) : null,
  });
  if (opts.subtasks) {
    opts.subtasks.forEach((sub, index) => {
      const [subTitle, done] = Array.isArray(sub) ? sub : [sub, false];
      insertSubtask.run(newId(), userId, id, subTitle, done ? 1 : 0, index, createdAt, done ? createdAt : null);
    });
  }
  if (opts.status === 'completed') {
    insertCompletion.run(
      newId(), userId, id, title, opts.area ?? null, opts.project ?? null,
      opts.priority ?? 'medium', opts.due ?? null,
      opts.completedAt ?? iso(addDays(today, -2), '17:20')
    );
  }
  return id;
};

/* ------------------------------ Objectives ------------------------------- */

const seed = db.transaction(() => {
  const oPortfolio = objective('Build a strong professional portfolio', {
    description: 'Have work I am proud to show, and a place to show it from.',
    area: areas.Career, horizon: 'year', deadline: `${today.slice(0, 4)}-12-31`, priority: 'high', position: 0,
  });
  const mStructure = milestone(oPortfolio, 'Finalise the portfolio structure', { done: true, target: addDays(today, -48), position: 0 });
  const mThree = milestone(oPortfolio, 'Complete three substantial projects', { target: addMonths(today, 3), position: 1 });
  const mPublish = milestone(oPortfolio, 'Publish the portfolio', { target: addMonths(today, 4), position: 2 });
  const mApply = milestone(oPortfolio, 'Apply to ten relevant openings', { target: addMonths(today, 5), position: 3 });

  const oGerman = objective('Become conversational in German', {
    description: 'Hold a comfortable half-hour conversation without switching to English.',
    area: areas.Learning, horizon: 'year', deadline: `${today.slice(0, 4)}-12-31`, position: 1,
  });
  const mA1 = milestone(oGerman, 'Complete A1', { done: true, target: addDays(today, -70), position: 0 });
  const m500 = milestone(oGerman, 'Learn 500 core words', { target: addMonths(today, 1), position: 1 });
  const mA2 = milestone(oGerman, 'Complete A2', { target: addMonths(today, 4), position: 2 });
  milestone(oGerman, 'Practise conversation weekly', { target: addMonths(today, 6), position: 3 });

  const oFinance = objective('Build a six-month financial buffer', {
    description: 'Enough runway that a bad month is an inconvenience, not a crisis.',
    area: areas.Finance, horizon: 'year', deadline: `${today.slice(0, 4)}-12-31`, priority: 'high', position: 2,
  });
  const mTrack = milestone(oFinance, 'Track spending for three months', { done: true, target: addDays(today, -30), position: 0 });
  const mReduce = milestone(oFinance, 'Reduce fixed monthly costs by 15%', { target: addMonths(today, 2), position: 1 });
  milestone(oFinance, 'Reach three months of expenses saved', { target: addMonths(today, 5), position: 2 });
  milestone(oFinance, 'Reach six months of expenses saved', { target: addMonths(today, 11), position: 3 });

  const oDegree = objective('Finish the final year well', {
    description: 'Submit work I would still stand behind in five years.',
    area: areas.Education, horizon: 'year', deadline: addMonths(today, 8), priority: 'high', position: 3,
  });
  const mProposal = milestone(oDegree, 'Dissertation proposal accepted', { done: true, target: addDays(today, -25), position: 0 });
  const mDraft = milestone(oDegree, 'Complete the first full draft', { target: addMonths(today, 3), position: 1 });
  milestone(oDegree, 'Submit the dissertation', { target: addMonths(today, 7), position: 2 });

  const oRun = objective('Run a half marathon', {
    description: 'Finish it comfortably rather than quickly.',
    area: areas['Health & Fitness'], horizon: 'quarter', deadline: addMonths(today, 3), position: 4,
  });
  const m10k = milestone(oRun, 'Comfortable at 10 km', { done: true, target: addDays(today, -20), position: 0 });
  const m15k = milestone(oRun, 'Comfortable at 15 km', { target: addMonths(today, 1), position: 1 });
  milestone(oRun, 'Race day', { target: addMonths(today, 3), position: 2 });

  const oJapan = objective('Travel to Japan in the spring', {
    description: 'Two weeks, planned properly rather than rushed.',
    area: areas.Travel, horizon: 'year', deadline: addMonths(today, 6), position: 5,
  });
  const mBooked = milestone(oJapan, 'Flights and accommodation booked', { target: addMonths(today, 1), position: 0 });
  milestone(oJapan, 'Itinerary agreed', { target: addMonths(today, 3), position: 1 });

  /* -------------------------------- Projects ----------------------------- */

  const pPortfolio = project('Portfolio website', {
    description: 'A calm, fast site that puts the work first.',
    objective: oPortfolio, milestone: mPublish, area: areas.Career,
    deadline: addMonths(today, 2), priority: 'high',
  });
  const pCaseStudy = project('Case study: inventory redesign', {
    description: 'Write up the redesign properly, with the reasoning intact.',
    objective: oPortfolio, milestone: mThree, area: areas.Career, deadline: addDays(today, 24),
  });
  const pDissertation = project('Dissertation', {
    description: 'Chapter by chapter, with the literature review first.',
    objective: oDegree, milestone: mDraft, area: areas.Education, deadline: addMonths(today, 3), priority: 'high',
  });
  const pFinance = project('Personal finance system', {
    description: 'One place where the numbers are true.',
    objective: oFinance, milestone: mReduce, area: areas.Finance, deadline: addMonths(today, 1),
  });
  const pJapan = project('Japan trip planning', {
    objective: oJapan, milestone: mBooked, area: areas.Travel, deadline: addMonths(today, 1),
  });
  const pOffice = project('Home office refresh', {
    description: 'A room that is pleasant to work in for eight hours.',
    area: areas.Home, deadline: addMonths(today, 2), status: 'planning', priority: 'low',
  });
  const pGerman = project('German A2 course', {
    objective: oGerman, milestone: mA2, area: areas.Learning, deadline: addMonths(today, 4),
  });
  project('Move flat', {
    description: 'Completed in the spring.',
    area: areas.Home, status: 'completed', deadline: addDays(today, -60), created: iso(addDays(today, -160)),
  });

  /* ------------------------------ Today & soon --------------------------- */

  task('Draft the case study introduction', {
    project: pCaseStudy, objective: oPortfolio, milestone: mThree, area: areas.Career,
    due: today, time: '10:00', priority: 'high', important: true, reminder: '1h', minutes: 90,
    description: 'Set out the problem before the solution. Two pages at most.',
    subtasks: [['Outline the argument', true], ['Write the opening', false], ['Read it back aloud', false]],
  });
  task('Review the literature notes for chapter two', {
    project: pDissertation, objective: oDegree, milestone: mDraft, area: areas.Education,
    due: today, time: '14:00', priority: 'high', minutes: 120, meaningful: true,
  });
  task('Reply to the supervisor about the submission date', {
    project: pDissertation, area: areas.Education, due: today, time: '17:00', priority: 'urgent', important: true, minutes: 10,
  });
  task('Strength session', {
    area: areas['Health & Fitness'], objective: oRun, due: today, time: '07:00',
    recurrence: { freq: 'weekdays' }, minutes: 45, reminder: '30m',
  });
  task('Read twenty pages of the German reader', {
    area: areas.Learning, objective: oGerman, milestone: m500, due: today, time: '21:00',
    recurrence: { freq: 'daily' }, minutes: 20, meaningful: true,
  });

  task('Renew the travel insurance', {
    area: areas.Finance, due: addDays(today, -3), priority: 'high', important: true, minutes: 20,
    description: 'The old policy lapsed at the end of last month.',
  });
  task('Send the invoice for last month', {
    area: areas.Finance, due: addDays(today, -1), priority: 'urgent', important: true, minutes: 15,
  });
  task('Book the dentist', {
    area: areas['Health & Fitness'], due: addDays(today, -6), priority: 'low', minutes: 10,
  });

  task('Build the homepage layout', {
    project: pPortfolio, objective: oPortfolio, milestone: mPublish, area: areas.Career,
    due: addDays(today, 1), priority: 'high', status: 'in_progress', minutes: 180,
    subtasks: [['Sketch the grid', true], ['Set the type scale', true], ['Build the hero', false], ['Responsive pass', false]],
  });
  task('Compare flight options for April', {
    project: pJapan, objective: oJapan, milestone: mBooked, area: areas.Travel,
    due: addDays(today, 2), minutes: 60, important: true,
  });
  task('Draft the reduced-spending plan', {
    project: pFinance, objective: oFinance, milestone: mReduce, area: areas.Finance,
    due: addDays(today, 3), priority: 'high', minutes: 45,
  });
  task('Order the desk lamp', { project: pOffice, area: areas.Home, due: addDays(today, 4), priority: 'low', minutes: 15 });
  task('Long run — 12 km', {
    area: areas['Health & Fitness'], objective: oRun, milestone: m15k, due: addDays(today, 5), time: '08:00', minutes: 80,
  });
  task('Submit the A2 course enrolment', {
    project: pGerman, objective: oGerman, milestone: mA2, area: areas.Learning,
    due: addDays(today, 6), priority: 'high', important: true, minutes: 20,
  });
  task('Write the second case study section', {
    project: pCaseStudy, objective: oPortfolio, milestone: mThree, area: areas.Career, due: addDays(today, 8), minutes: 120,
  });
  task('Coffee with Maya', { area: areas.Relationships, due: addDays(today, 9), time: '11:00', minutes: 60, meaningful: true });
  task('Chapter two first pass', {
    project: pDissertation, objective: oDegree, milestone: mDraft, area: areas.Education,
    due: addDays(today, 12), priority: 'high', minutes: 240, meaningful: true,
  });
  task('Photograph the finished projects', { project: pPortfolio, area: areas.Career, due: addDays(today, 16), minutes: 90 });
  task('Compare ISA providers', { area: areas.Finance, objective: oFinance, due: addDays(today, 18), minutes: 45, important: true });
  task('Draft the Japan itinerary', { project: pJapan, objective: oJapan, area: areas.Travel, due: addDays(today, 21), minutes: 90 });
  task('Deploy the portfolio to staging', {
    project: pPortfolio, objective: oPortfolio, milestone: mPublish, area: areas.Career, due: addDays(today, 27), minutes: 60,
  });
  task('Mid-year assessment', { area: areas.Education, objective: oDegree, due: addDays(today, 34), priority: 'high', important: true });
  task('Write the portfolio about page', { project: pPortfolio, area: areas.Career, due: addDays(today, 40), minutes: 60 });

  /* ------------------------------- Recurring ----------------------------- */

  task('Review finances', {
    area: areas.Finance, objective: oFinance, due: addDays(today, (7 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7 || 7),
    time: '10:00', recurrence: { freq: 'weekly', weekdays: [0] }, reminder: '1h', minutes: 30, important: true,
    description: 'Reconcile the accounts and look at the month ahead.',
  });
  task('Weekly planning', {
    area: areas.Personal, due: addDays(today, (8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7 || 7),
    time: '08:30', recurrence: { freq: 'weekly', weekdays: [1] }, reminder: '15m', minutes: 30, meaningful: true,
  });
  task('Pay rent', {
    area: areas.Home, due: `${addMonths(today, 1).slice(0, 7)}-01`,
    recurrence: { freq: 'monthly_date', day: 1 }, reminder: '1d', priority: 'high', important: true,
  });
  task('Renew the domain name', {
    area: areas.Career, due: addMonths(today, 4), recurrence: { freq: 'yearly' }, reminder: '1w', minutes: 10,
  });
  task('Quarterly review of objectives', {
    area: areas['Self Development'], due: addMonths(today, 1), recurrence: { freq: 'quarterly' },
    reminder: '1d', minutes: 60, meaningful: true,
    description: 'Are these still the things I want to be moving toward?',
  });
  task('Call home', {
    area: areas.Relationships, due: addDays(today, 2), time: '19:00',
    recurrence: { freq: 'weekly', weekdays: [3] }, minutes: 30, meaningful: true,
  });

  /* --------------------------- Unscheduled work -------------------------- */

  task('Rewrite the CV summary', { area: areas.Career, objective: oPortfolio, milestone: mApply, important: true, minutes: 45 });
  task('Find a German conversation partner', { area: areas.Learning, objective: oGerman, meaningful: true, minutes: 30 });
  task('Sort the bookshelf', { area: areas.Home, priority: 'low', minutes: 60 });
  task('Look into the cycling club', { area: areas['Health & Fitness'], priority: 'low' });

  /* ------------------------------ History -------------------------------- */

  const completed = [
    ['Finish the portfolio structure', pPortfolio, areas.Career, 48, 'high'],
    ['Choose the three projects to include', pCaseStudy, areas.Career, 44, 'medium'],
    ['Pass the A1 examination', pGerman, areas.Learning, 70, 'high'],
    ['Set up the spending tracker', pFinance, areas.Finance, 38, 'medium'],
    ['Three months of spending recorded', pFinance, areas.Finance, 30, 'medium'],
    ['Dissertation proposal submitted', pDissertation, areas.Education, 26, 'high'],
    ['First 10 km run', null, areas['Health & Fitness'], 20, 'medium'],
    ['Cancel the unused subscriptions', pFinance, areas.Finance, 17, 'low'],
    ['Book the eye test', null, areas['Health & Fitness'], 14, 'low'],
    ['Draft the case study outline', pCaseStudy, areas.Career, 11, 'high'],
    ['Register for the half marathon', null, areas['Health & Fitness'], 9, 'medium'],
    ['Read the supervisor feedback', pDissertation, areas.Education, 7, 'high'],
    ['Update the emergency fund spreadsheet', pFinance, areas.Finance, 5, 'medium'],
    ['Order the standing desk mat', pOffice, areas.Home, 4, 'low'],
    ['Reply to the recruiter', null, areas.Career, 3, 'high'],
    ['Plan the week', null, areas.Personal, 2, 'medium'],
    ['Grocery order', null, areas.Home, 1, 'low'],
  ];

  for (const [title, projectId, areaId, daysAgo, priority] of completed) {
    const day = addDays(today, -daysAgo);
    const hour = [9, 11, 13, 16, 18, 20][daysAgo % 6];
    task(title, {
      project: projectId, area: areaId, priority,
      due: day, status: 'completed',
      created: iso(addDays(day, -6)),
      completedAt: `${day}T${String(hour).padStart(2, '0')}:${daysAgo % 2 ? '35' : '05'}:00.000Z`,
    });
  }

  // A denser trail of recurring completions, so the rhythm charts read honestly.
  for (let daysAgo = 1; daysAgo <= 56; daysAgo += 1) {
    const day = addDays(today, -daysAgo);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      insertCompletion.run(newId(), userId, null, 'Strength session', areas['Health & Fitness'], null, 'medium', day, `${day}T07:${daysAgo % 2 ? '40' : '15'}:00.000Z`);
    }
    if (daysAgo % 2 === 0) {
      insertCompletion.run(newId(), userId, null, 'Read twenty pages of the German reader', areas.Learning, null, 'medium', day, `${day}T21:10:00.000Z`);
    }
    if (weekday === 0) {
      insertCompletion.run(newId(), userId, null, 'Review finances', areas.Finance, null, 'high', day, `${day}T10:25:00.000Z`);
    }
    if (weekday === 1) {
      insertCompletion.run(newId(), userId, null, 'Weekly planning', areas.Personal, null, 'medium', day, `${day}T08:45:00.000Z`);
    }
  }

  /* -------------------------------- Events ------------------------------- */

  const events = [
    ['Supervisor meeting', 'Chapter two direction', 'Room 4.12', addDays(today, 1), '15:00', areas.Education],
    ['Design critique', 'Portfolio work in progress', 'Online', addDays(today, 3), '13:00', areas.Career],
    ["Priya's birthday", '', '', addDays(today, 6), null, areas.Relationships],
    ['Half marathon', 'Race day', 'Regent’s Park', addMonths(today, 3), '09:00', areas['Health & Fitness']],
    ['Flight to Osaka', '', 'Heathrow T2', addMonths(today, 6), '11:40', areas.Travel],
  ];
  for (const [title, description, location, date, time, areaId] of events) {
    insertEvent.run(newId(), userId, areaId, title, description, location, date, time, time ? 0 : 1, now, now);
  }

  /* -------------------------------- Notes -------------------------------- */

  const notes = [
    [
      'What the portfolio is actually for',
      'Not a gallery. The point is to show how I think — the constraint, the options I discarded, and why. Three projects, each with the reasoning intact, beats twelve screenshots.\n\nDecide by the end of the month whether the inventory redesign or the scheduling tool leads.',
      areas.Career, pPortfolio, oPortfolio, 1,
    ],
    [
      'Dissertation — chapter plan',
      '1. Literature review — where the field currently sits\n2. Method — why this approach and not the obvious one\n3. Findings\n4. Discussion\n5. Limitations, honestly stated\n\nSupervisor wants chapter two before the mid-year assessment.',
      areas.Education, pDissertation, oDegree, 0,
    ],
    [
      'Monthly fixed costs',
      'Rent, utilities, transport, phone, two subscriptions worth keeping.\n\nThe 15% reduction has to come from transport and the subscriptions. Rent is not moving this year.',
      areas.Finance, pFinance, oFinance, 0,
    ],
    [
      'German — words that keep escaping',
      'obwohl · trotzdem · beziehungsweise · umso · jedenfalls\n\nWrite each into a sentence about my own day rather than drilling the list.',
      areas.Learning, null, oGerman, 0,
    ],
    [
      'Japan — rough shape',
      'Two weeks. Osaka in, Tokyo out. Three nights minimum per city so it does not become a series of train stations.\n\nBook flights before the end of next month; prices climb sharply after that.',
      areas.Travel, pJapan, oJapan, 0,
    ],
  ];
  for (const [title, body, areaId, projectId, objectiveId, pinned] of notes) {
    insertNote.run(newId(), userId, areaId, projectId, objectiveId, title, body, pinned, now, now);
  }
});

seed();

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId).n;

console.log(`
  Demo account ready.

    Email     ${EMAIL}
    Password  ${PASSWORD}

    ${count('objectives')} objectives · ${count('milestones')} milestones · ${count('projects')} projects
    ${count('tasks')} responsibilities · ${count('subtasks')} subtasks · ${count('task_completions')} completions
    ${count('notes')} notes · ${count('events')} events · ${count('areas')} areas

  Start the server with: npm start
`);
