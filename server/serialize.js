import db, { newId, nowIso } from './db.js';
import { describeRecurrence, milestoneProgress, objectiveProgress, projectProgress } from './domain.js';

/* Row → API shape. Password hashes, tokens, lockout counters and every other
 * internal field are dropped here; the client is only ever handed what it is
 * meant to see. */

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: Boolean(row.email_verified),
    timezone: row.timezone,
    weekStart: row.week_start,
    workStart: row.work_start,
    workEnd: row.work_end,
    theme: row.theme,
    accent: row.accent,
    density: row.density,
    defaultPriority: row.default_priority,
    defaultDuration: row.default_duration,
    defaultReminder: row.default_reminder,
    defaultView: row.default_view,
    notifyPush: Boolean(row.notify_push),
    notifyEmail: Boolean(row.notify_email),
    notifyDigest: Boolean(row.notify_digest),
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    recurrenceCatchup: row.recurrence_catchup,
    assistantMode: row.assistant_mode || 'local',
    assistantSharePlan: Boolean(row.assistant_share_plan),
    assistantMayAct: Boolean(row.assistant_may_act),
    onboarded: Boolean(row.onboarded),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

const parseJson = (value, fallback) => {
  try {
    const out = JSON.parse(value);
    return out ?? fallback;
  } catch {
    return fallback;
  }
};

export function serializeArea(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    position: row.position,
    archived: Boolean(row.archived),
    createdAt: row.created_at,
  };
}

export function serializeSubtask(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: Boolean(row.done),
    position: row.position,
    completedAt: row.completed_at,
  };
}

export function serializeTask(row, { subtasks = null } = {}) {
  const recurrence = row.recurrence ? parseJson(row.recurrence, null) : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    notes: row.notes,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    objectiveId: row.objective_id,
    areaId: row.area_id,
    startDate: row.start_date,
    dueDate: row.due_date,
    dueTime: row.due_time,
    priority: row.priority,
    important: Boolean(row.important),
    meaningful: Boolean(row.meaningful),
    status: row.status,
    tags: parseJson(row.tags, []),
    links: parseJson(row.links, []),
    recurrence,
    recurrenceLabel: recurrence ? describeRecurrence(recurrence) : '',
    recurrenceEnd: row.recurrence_end,
    reminder: row.reminder,
    estimatedMinutes: row.estimated_minutes,
    actualMinutes: row.actual_minutes,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    subtaskTotal: row.subtask_total ?? (subtasks ? subtasks.length : 0),
    subtaskDone: row.subtask_done ?? (subtasks ? subtasks.filter((s) => s.done).length : 0),
    ...(subtasks ? { subtasks: subtasks.map(serializeSubtask) } : {}),
    ...(row.project_name ? { projectName: row.project_name } : {}),
    ...(row.area_name ? { areaName: row.area_name } : {}),
    ...(row.objective_title ? { objectiveTitle: row.objective_title } : {}),
    ...(row.milestone_title ? { milestoneTitle: row.milestone_title } : {}),
  };
}

export function serializeProject(row, userId) {
  const progress = projectProgress(userId, row.id);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    objectiveId: row.objective_id,
    milestoneId: row.milestone_id,
    areaId: row.area_id,
    deadline: row.deadline,
    priority: row.priority,
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    tasksTotal: progress.total,
    tasksDone: progress.done,
    progress: progress.percent,
    ...(row.objective_title ? { objectiveTitle: row.objective_title } : {}),
    ...(row.milestone_title ? { milestoneTitle: row.milestone_title } : {}),
    ...(row.area_name ? { areaName: row.area_name } : {}),
  };
}

export function serializeMilestone(row, userId) {
  const progress = milestoneProgress(userId, row.id, row.status);
  return {
    id: row.id,
    objectiveId: row.objective_id,
    title: row.title,
    description: row.description,
    targetDate: row.target_date,
    status: row.status,
    position: row.position,
    progress: progress.percent,
    tasksTotal: progress.total,
    tasksDone: progress.done,
    projectCount: progress.projectCount,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ...(row.objective_title ? { objectiveTitle: row.objective_title } : {}),
  };
}

export function serializeObjective(row, userId, { milestones } = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    areaId: row.area_id,
    horizon: row.horizon,
    startDate: row.start_date,
    deadline: row.deadline,
    status: row.status,
    priority: row.priority,
    progressMode: row.progress_mode,
    progressManual: row.progress_manual,
    progress: objectiveProgress(userId, row),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    ...(row.area_name ? { areaName: row.area_name } : {}),
    ...(milestones ? { milestones: milestones.map((m) => serializeMilestone(m, userId)) } : {}),
  };
}

export function serializeNote(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    areaId: row.area_id,
    projectId: row.project_id,
    objectiveId: row.objective_id,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    areaId: row.area_id,
    startDate: row.start_date,
    startTime: row.start_time,
    endDate: row.end_date,
    endTime: row.end_time,
    allDay: Boolean(row.all_day),
    createdAt: row.created_at,
  };
}

export function serializeReminder(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    remindAt: row.remind_at,
    offsetKey: row.offset_key,
    delivered: Boolean(row.delivered),
    createdAt: row.created_at,
  };
}

export function serializeSession(row, currentSessionId) {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
    remember: Boolean(row.remember),
    current: row.id === currentSessionId,
  };
}

/* ------------------------------------------------------------------ *
 * Default Areas of Life, created with each account.
 * ------------------------------------------------------------------ */

export const DEFAULT_AREAS = [
  { name: 'Education', icon: 'book', color: 'indigo' },
  { name: 'Career', icon: 'briefcase', color: 'slate' },
  { name: 'Finance', icon: 'coins', color: 'moss' },
  { name: 'Personal', icon: 'user', color: 'clay' },
  { name: 'Relationships', icon: 'heart', color: 'rose' },
  { name: 'Health & Fitness', icon: 'activity', color: 'teal' },
  { name: 'Travel', icon: 'compass', color: 'ocean' },
  { name: 'Learning', icon: 'lightbulb', color: 'amber' },
  { name: 'Self Development', icon: 'sparkle', color: 'violet' },
  { name: 'Home', icon: 'home', color: 'sand' },
  { name: 'Creativity', icon: 'palette', color: 'rose' },
  { name: 'Events', icon: 'calendar', color: 'slate' },
];

export function seedDefaultAreas(userId) {
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO areas (id, user_id, name, icon, color, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    DEFAULT_AREAS.forEach((area, index) => {
      insert.run(newId(), userId, area.name, area.icon, area.color, index, now, now);
    });
  })();
}
