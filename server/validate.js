import { badRequest } from './middleware.js';

/* Input validation. Every value that reaches SQL is bound as a parameter, and
 * every value that reaches the client is escaped at render time — this layer
 * exists to keep the data model coherent and to reject hostile shapes early. */

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TASK_STATUSES = ['not_started', 'in_progress', 'completed', 'cancelled'];
export const PROJECT_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
export const OBJECTIVE_STATUSES = ['active', 'on_hold', 'completed', 'archived'];
export const MILESTONE_STATUSES = ['active', 'completed'];
export const HORIZONS = ['year', 'quarter', 'month', 'life'];
export const THEMES = ['light', 'dark', 'system'];
export const ACCENTS = ['clay', 'moss', 'indigo', 'amber', 'slate'];
export const DENSITIES = ['comfortable', 'compact'];
export const ASSISTANT_MODES = ['off', 'local', 'claude'];
export const REMINDER_OFFSETS = [
  'none', 'at_time', '5m', '15m', '30m', '1h', '2h', '1d', '2d', '1w',
];
export const RECURRENCE_FREQS = [
  'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'monthly_date', 'quarterly', 'yearly', 'custom',
];
export const AREA_COLORS = [
  'slate', 'clay', 'moss', 'indigo', 'amber', 'rose', 'teal', 'violet', 'sand', 'ocean',
];
export const AREA_ICONS = [
  'book', 'briefcase', 'coins', 'user', 'heart', 'activity', 'compass', 'lightbulb',
  'sparkle', 'home', 'palette', 'calendar', 'circle', 'target', 'leaf', 'globe',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export function str(value, field, { min = 0, max = 500, required = false, trim = true } = {}) {
  if (value == null) {
    if (required) throw badRequest(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  const out = trim ? value.trim() : value;
  if (out.length < min) {
    throw badRequest(min === 1 ? `${field} cannot be empty.` : `${field} must be at least ${min} characters.`);
  }
  if (out.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`);
  return out;
}

export function email(value, field = 'Email') {
  const out = str(value, field, { min: 3, max: 254, required: true }).toLowerCase();
  if (!EMAIL_RE.test(out)) throw badRequest('Enter a valid email address.');
  return out;
}

export function enumValue(value, allowed, field, fallback) {
  if (value == null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} is required.`);
  }
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

export function dateOnly(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw badRequest(`${field} must be a date in YYYY-MM-DD format.`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw badRequest(`${field} is not a real date.`);
  }
  if (y < 1970 || y > 2200) throw badRequest(`${field} is out of range.`);
  return value;
}

export function timeOnly(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !TIME_RE.test(value)) {
    throw badRequest(`${field} must be a time in HH:MM format.`);
  }
  return value;
}

export function isoDateTime(value, field) {
  if (value == null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`${field} must be a valid date and time.`);
  return parsed.toISOString();
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 0) return Boolean(value);
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
}

export function int(value, field, { min = -1e9, max = 1e9, nullable = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    throw badRequest(`${field} is required.`);
  }
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number.`);
  if (n < min || n > max) throw badRequest(`${field} must be between ${min} and ${max}.`);
  return Math.trunc(n);
}

export function stringArray(value, field, { maxItems = 24, maxLength = 40 } = {}) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${field} must be a list.`);
  if (value.length > maxItems) throw badRequest(`${field} may contain at most ${maxItems} entries.`);
  return value
    .map((item) => str(item, field, { max: maxLength }))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function linkArray(value, field = 'Links') {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${field} must be a list.`);
  if (value.length > 20) throw badRequest('A responsibility may hold at most 20 links.');
  return value.map((item) => {
    const label = str(item?.label ?? '', 'Link label', { max: 120 }) || '';
    const url = str(item?.url ?? '', 'Link address', { max: 2000, required: true });
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest('Links must be valid URLs beginning with http:// or https://');
    }
    // Only web schemes: blocks javascript:, data:, file: and similar vectors.
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw badRequest('Links must use http:// or https://');
    }
    return { label: label || parsed.hostname, url: parsed.toString() };
  });
}

/** Validates a recurrence rule object. Returns null when recurrence is off. */
export function recurrence(value, field = 'Recurrence') {
  if (value == null || value === '') return null;
  if (typeof value !== 'object') throw badRequest(`${field} must be an object.`);
  const freq = enumValue(value.freq, RECURRENCE_FREQS, 'Recurrence frequency');
  const rule = { freq };

  if (freq === 'weekly' || freq === 'biweekly') {
    const days = Array.isArray(value.weekdays) ? value.weekdays : [];
    rule.weekdays = [...new Set(days.map((d) => int(d, 'Weekday', { min: 0, max: 6, nullable: false })))]
      .sort((a, b) => a - b);
    if (!rule.weekdays.length) rule.weekdays = null; // fall back to the task's own weekday
  }
  if (freq === 'monthly_date') {
    rule.day = int(value.day, 'Day of month', { min: 1, max: 31, nullable: false });
  }
  if (freq === 'custom') {
    rule.every = int(value.every, 'Interval', { min: 1, max: 365, nullable: false });
    rule.unit = enumValue(value.unit, ['day', 'week', 'month', 'year'], 'Interval unit', 'day');
  }
  return rule;
}

/** A UUID-shaped identifier, or null. Rejects anything else outright. */
export function optionalId(value, field) {
  if (value == null || value === '') return null;
  const out = str(value, field, { max: 64, required: true });
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(out)) throw badRequest(`${field} is not a valid identifier.`);
  return out;
}

export function requireId(value, field = 'Identifier') {
  const out = optionalId(value, field);
  if (!out) throw badRequest(`${field} is required.`);
  return out;
}

export function timezone(value, field = 'Timezone') {
  const out = str(value, field, { max: 64 });
  if (!out) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: out });
    return out;
  } catch {
    throw badRequest('That timezone is not recognised.');
  }
}

export function ensureObject(body, name = 'Request body') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest(`${name} must be an object.`);
  }
  return body;
}
