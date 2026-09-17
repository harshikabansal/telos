import db from '../db.js';
import { HttpError } from '../middleware.js';
import { PRIORITIES, dateOnly, enumValue, requireId, str, timeOnly } from '../validate.js';
import { addDays, daysBetween, todayFor } from '../domain.js';
import { completeTask, createTask, getTask, rescheduleTask, setTaskFields } from '../services/tasks.js';
import { whenLabel } from './plan.js';

/**
 * Actions the assistant may propose.
 *
 * Nothing here executes when it is proposed. The assistant returns a list of
 * intentions; the person reads them, chooses which to keep, and presses Apply.
 * Only then does `applyActions` run — and it re-validates and re-checks
 * ownership from scratch, treating its input as though it came from a hostile
 * client, because in effect it does.
 *
 * Deletion is deliberately absent. The assistant can complete, move, reprioritise
 * and create; anything irreversible stays a decision the person makes directly.
 */

export const ACTION_TYPES = [
  'complete',
  'uncomplete',
  'reschedule',
  'set_priority',
  'mark_important',
  'unmark_important',
  'create_task',
];

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const RELATIVE = {
  today: 0, tomorrow: 1, 'next week': 7, 'in a week': 7, 'next month': 30,
};

/** Accepts an explicit date or a small set of relative words. */
function resolveDate(value, today) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim().toLowerCase();
  if (text in RELATIVE) return addDays(today, RELATIVE[text]);
  if (/^\+?\d+$/.test(text)) return addDays(today, Number(text.replace('+', '')));
  return dateOnly(String(value).trim(), 'Date');
}

/**
 * Turns one raw proposal — from the model or from the local rules — into a
 * validated action, or throws. `resolveRef` maps a reference the model used
 * back to a real responsibility belonging to this account.
 */
function validateAction(raw, { user, today, resolveRef }) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'An action must be an object.');
  const type = enumValue(raw.type, ACTION_TYPES, 'Action');

  if (type === 'create_task') {
    const title = str(raw.title, 'Title', { min: 1, max: 200, required: true });
    return {
      type,
      title,
      dueDate: resolveDate(raw.date ?? raw.dueDate, today),
      dueTime: raw.time ? timeOnly(String(raw.time), 'Time') : null,
      priority: raw.priority ? enumValue(raw.priority, PRIORITIES, 'Priority') : null,
      important: Boolean(raw.important),
      reason: str(raw.reason, 'Reason', { max: 200 }) || '',
    };
  }

  // Every other action targets an existing responsibility.
  const taskId = resolveRef(raw.ref ?? raw.id ?? raw.taskId);
  if (!taskId) return null; // an unknown reference is dropped, not guessed at

  const action = { type, taskId, reason: str(raw.reason, 'Reason', { max: 200 }) || '' };
  if (type === 'reschedule') {
    action.dueDate = resolveDate(raw.date ?? raw.dueDate, today);
    action.dueTime = raw.time ? timeOnly(String(raw.time), 'Time') : undefined;
  }
  if (type === 'set_priority') {
    action.priority = enumValue(raw.priority, PRIORITIES, 'Priority');
  }
  return action;
}

/* ------------------------------------------------------------------ *
 * Proposing
 * ------------------------------------------------------------------ */

const describe = (action, task, today) => {
  switch (action.type) {
    case 'complete': return `Complete "${task.title}"`;
    case 'uncomplete': return `Reopen "${task.title}"`;
    case 'reschedule':
      return action.dueDate
        ? `Move "${task.title}" to ${whenLabel({ dueDate: action.dueDate, dueTime: action.dueTime }, today)}`
        : `Remove the date from "${task.title}"`;
    case 'set_priority': return `Set "${task.title}" to ${action.priority} priority`;
    case 'mark_important': return `Mark "${task.title}" important`;
    case 'unmark_important': return `Remove the important mark from "${task.title}"`;
    default: return 'Change a responsibility';
  }
};

/**
 * Validates a batch of raw proposals and returns them ready to show. Anything
 * that does not resolve to this account's data is dropped silently rather than
 * surfaced — a reference the assistant invented is not an error the person
 * needs to see, it is simply not an action.
 */
export function buildProposals(rawActions, { user, digest }) {
  const today = todayFor(user.timezone);
  const refs = new Map();
  for (const task of digest.refIndex ?? []) refs.set(task.ref.toUpperCase(), task.id);

  const resolveRef = (value) => {
    if (!value) return null;
    const key = String(value).trim().toUpperCase();
    if (refs.has(key)) return refs.get(key);
    // Also accept a real id, as long as it belongs to this account.
    try {
      const id = requireId(String(value).trim(), 'Responsibility');
      return getTask(user, id) ? id : null;
    } catch {
      return null;
    }
  };

  const proposals = [];
  for (const raw of Array.isArray(rawActions) ? rawActions.slice(0, 25) : []) {
    let action;
    try {
      action = validateAction(raw, { user, today, resolveRef });
    } catch {
      continue; // a malformed proposal is dropped, never applied
    }
    if (!action) continue;

    if (action.type === 'create_task') {
      proposals.push({
        ...action,
        description: `Add "${action.title}"${action.dueDate ? ` for ${whenLabel({ dueDate: action.dueDate }, today)}` : ''}`,
      });
      continue;
    }

    const task = getTask(user, action.taskId);
    if (!task) continue;
    // Proposing something already true is noise.
    if (action.type === 'complete' && task.status === 'completed') continue;
    if (action.type === 'mark_important' && task.important) continue;
    if (action.type === 'unmark_important' && !task.important) continue;
    if (action.type === 'set_priority' && task.priority === action.priority) continue;
    if (action.type === 'reschedule' && task.due_date === action.dueDate && action.dueTime === undefined) continue;

    proposals.push({ ...action, title: task.title, description: describe(action, task, today) });
  }
  return proposals;
}

/* ------------------------------------------------------------------ *
 * Applying
 * ------------------------------------------------------------------ */

/**
 * Executes confirmed actions. Ownership is re-checked per action through the
 * shared task service, so an action list that has been tampered with in the
 * browser cannot reach another account's data.
 *
 * Returns what changed and the previous values, so the interface can offer an
 * undo built from the same action vocabulary.
 */
export function applyActions(rawActions, { user }) {
  const today = todayFor(user.timezone);
  const resolveRef = (value) => {
    if (!value) return null;
    try {
      const id = requireId(String(value).trim(), 'Responsibility');
      return getTask(user, id) ? id : null;
    } catch {
      return null;
    }
  };

  const list = Array.isArray(rawActions) ? rawActions : [];
  if (!list.length) throw new HttpError(400, 'No actions to apply.');
  if (list.length > 25) throw new HttpError(400, 'That is too many actions at once.');

  const applied = [];
  const skipped = [];

  for (const raw of list) {
    let action;
    try {
      action = validateAction(raw, { user, today, resolveRef });
    } catch (error) {
      skipped.push({ reason: error.message });
      continue;
    }
    if (!action) {
      skipped.push({ reason: 'That responsibility is no longer available.' });
      continue;
    }

    try {
      switch (action.type) {
        case 'complete':
        case 'uncomplete': {
          const done = action.type === 'complete';
          const { before, recurredTo } = completeTask(user, action.taskId, done);
          applied.push({
            type: action.type, taskId: action.taskId, before, recurredTo,
            undo: { type: done ? 'uncomplete' : 'complete', ref: action.taskId },
          });
          break;
        }
        case 'reschedule': {
          const { before } = rescheduleTask(user, action.taskId, {
            dueDate: action.dueDate,
            dueTime: action.dueTime,
          });
          applied.push({
            type: action.type, taskId: action.taskId, before,
            undo: { type: 'reschedule', ref: action.taskId, date: before.dueDate, time: before.dueTime },
          });
          break;
        }
        case 'set_priority': {
          const { before } = setTaskFields(user, action.taskId, { priority: action.priority });
          applied.push({
            type: action.type, taskId: action.taskId, before,
            undo: { type: 'set_priority', ref: action.taskId, priority: before.priority },
          });
          break;
        }
        case 'mark_important':
        case 'unmark_important': {
          const important = action.type === 'mark_important';
          const { before } = setTaskFields(user, action.taskId, { important });
          applied.push({
            type: action.type, taskId: action.taskId, before,
            undo: { type: important ? 'unmark_important' : 'mark_important', ref: action.taskId },
          });
          break;
        }
        case 'create_task': {
          const id = createTask(user, {
            title: action.title,
            dueDate: action.dueDate,
            dueTime: action.dueTime,
            priority: action.priority ?? undefined,
            important: action.important,
          });
          applied.push({ type: action.type, taskId: id, created: true, title: action.title });
          break;
        }
        default:
          skipped.push({ reason: 'Unsupported action.' });
      }
    } catch (error) {
      // A record that vanished between proposing and applying is skipped, not
      // fatal — the rest of the batch still runs.
      skipped.push({ reason: error.status === 404 ? 'That responsibility no longer exists.' : 'Could not apply that one.' });
    }
  }

  return { applied, skipped };
}

/* ------------------------------------------------------------------ *
 * Proposing without a model
 * ------------------------------------------------------------------ */

const WHEN_WORDS = [
  { re: /\b(today|now)\b/i, days: 0, label: 'today' },
  { re: /\btomorrow\b/i, days: 1, label: 'tomorrow' },
  { re: /\b(next week|a week)\b/i, days: 7, label: 'next week' },
  { re: /\b(next month)\b/i, days: 30, label: 'next month' },
  { re: /\b(this weekend|the weekend)\b/i, days: null, label: 'the weekend' },
];

const ACT_VERB =
  /\b(reschedule|resched|move|push|postpone|defer|shift|bump|complete|finish|tick off|check off|mark(?:\s+as)?\s+done|done with|prioritise|prioritize|make .{0,12}(urgent|high|low)|flag|mark .{0,12}important|add(?: a)? (?:task|reminder|responsibility)|remind me to)\b/i;

/**
 * Finds the responsibility a phrase is talking about.
 *
 * Returns `{ task }` on a confident match, `{ ambiguous: true }` when two
 * candidates are equally plausible, and null when nothing fits. An action is
 * never taken on a guess — where this is unsure, the assistant asks.
 */
function matchTask(text, digest) {
  const haystack = text.toLowerCase();
  const pool = [...digest.overdue, ...digest.dueToday, ...digest.next7, ...digest.unscheduled, ...digest.inProgress];
  const seen = new Set();
  const scored = [];

  for (const task of pool) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const title = task.title.toLowerCase();
    let score = 0;

    if (haystack.includes(title)) {
      score = 100 + title.length;
    } else {
      const words = title.split(/\s+/).filter((w) => w.length > 3);
      const hits = words.filter((word) => haystack.includes(word));
      // Two words is a confident match; one word only when it is distinctive
      // enough that it is unlikely to be a coincidence.
      if (hits.length >= 2) score = hits.length * 10 + hits.join('').length;
      else if (hits.length === 1 && hits[0].length >= 5) score = 10 + hits[0].length;
    }
    if (score) scored.push({ task, score });
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0].score === scored[1].score) return { ambiguous: true };
  return { task: scored[0].task };
}

/**
 * Rule-based proposals, so acting works with no API key. Deliberately narrow:
 * it recognises the handful of phrasings people actually use, and says nothing
 * when it is unsure rather than guessing at someone's data.
 */
export function proposeLocally(text, digest, user) {
  if (!ACT_VERB.test(text)) return null;
  // "How do I complete a task?" shares its verb with "complete the invoice",
  // but it is asking how the app works — that belongs to the knowledge base.
  if (/\bhow (do|can|would|should) (i|you)\b/i.test(text)) return null;
  if (/^\s*(what|why|when|where|which|who)\b/i.test(text)) return null;

  const today = todayFor(user.timezone);

  const when = WHEN_WORDS.find((entry) => entry.re.test(text));
  const targetDate = when
    ? when.days === null
      ? addDays(today, (6 - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7 || 6)
      : addDays(today, when.days)
    : null;

  const wantsReschedule = /\b(reschedule|resched|move|push|postpone|defer|shift|bump)\b/i.test(text);
  const wantsComplete = /\b(complete|finish|tick off|check off|mark(?:\s+as)?\s+done|done with)\b/i.test(text);
  const wantsCreate = /\b(add(?: a)? (?:task|reminder|responsibility)|remind me to)\b/i.test(text);
  const priorityWord = /\b(urgent|high|medium|low)\b/i.exec(text);
  const wantsImportant = /\bimportant\b/i.test(text) && /\b(mark|flag|make)\b/i.test(text);

  // "Move everything overdue to tomorrow" — the bulk case, and the one that
  // saves the most tapping.
  const bulk = /\b(all|everything|every|them|those|the overdue|each)\b/i.test(text);
  if (wantsReschedule && bulk && /\boverdue\b/i.test(text) && digest.overdue.length) {
    const date = targetDate ?? today;
    return {
      reply: `I can move ${digest.overdue.length === 1 ? 'the overdue responsibility' : `all ${digest.overdue.length} overdue responsibilities`} to ${when?.label ?? 'today'}. Review and apply if that is right.`,
      actions: digest.overdue.map((task) => ({ type: 'reschedule', ref: task.id, date })),
    };
  }

  if (wantsCreate) {
    const title = text
      .replace(/^.*?\b(add(?: a)? (?:task|reminder|responsibility)(?: (?:called|to|for|named))?|remind me to)\b\s*/i, '')
      .replace(/\b(today|tomorrow|next week|next month|this weekend|the weekend)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .trim();
    if (!title) return null;
    return {
      reply: `I can add that${targetDate ? ` for ${when.label}` : ''}.`,
      actions: [{ type: 'create_task', title, date: targetDate }],
    };
  }

  const found = matchTask(text, digest);
  const wantsSomething = wantsComplete || wantsReschedule || wantsImportant || Boolean(priorityWord);

  // Asked to change something, but which thing is unclear. Say so rather than
  // acting on the closest guess.
  if (wantsSomething && (!found || found.ambiguous)) {
    return {
      reply: found?.ambiguous
        ? 'More than one responsibility matches that. Which did you mean? A few words from its title is enough.'
        : 'I could not find that one in your open responsibilities. Which did you mean?',
      actions: [],
    };
  }
  if (!found?.task) return null;
  const task = found.task;

  if (wantsComplete) {
    return {
      reply: 'I can mark that complete.',
      actions: [{ type: 'complete', ref: task.id }],
    };
  }
  if (wantsReschedule && targetDate) {
    return {
      reply: `I can move it to ${when.label}.`,
      actions: [{ type: 'reschedule', ref: task.id, date: targetDate }],
    };
  }
  if (priorityWord && /\b(prioritise|prioritize|make|set)\b/i.test(text)) {
    return {
      reply: `I can change its priority.`,
      actions: [{ type: 'set_priority', ref: task.id, priority: priorityWord[1].toLowerCase() }],
    };
  }
  if (wantsImportant) {
    return {
      reply: 'I can mark it important.',
      actions: [{ type: 'mark_important', ref: task.id }],
    };
  }
  return null;
}
