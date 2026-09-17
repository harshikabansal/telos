import { state } from './store.js';

/**
 * Calendar dates are plain YYYY-MM-DD strings throughout TELOS, manipulated in
 * UTC so arithmetic never drifts, and only rendered through Intl in the user's
 * own timezone.
 */

export const toDate = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const toYmd = (date) => date.toISOString().slice(0, 10);

export function today() {
  const tz = state.user?.timezone;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || undefined,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

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
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toYmd(d);
};
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
export const weekdayOf = (ymd) => toDate(ymd).getUTCDay();
export const monthKey = (ymd) => String(ymd).slice(0, 7);

/** Start of the week containing `ymd`, honouring the user's week-start day. */
export function startOfWeek(ymd, weekStart = state.user?.weekStart ?? 1) {
  const day = weekdayOf(ymd);
  const diff = (day - weekStart + 7) % 7;
  return addDays(ymd, -diff);
}
export const startOfMonth = (ymd) => `${String(ymd).slice(0, 7)}-01`;
export function endOfMonth(ymd) {
  const d = toDate(ymd);
  return toYmd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

const fmt = (options) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options });

export const formatDate = (ymd, options = { month: 'short', day: 'numeric' }) =>
  ymd ? fmt(options).format(toDate(ymd)) : '';

export const formatFull = (ymd) =>
  formatDate(ymd, { weekday: 'long', month: 'long', day: 'numeric' });

export const formatLong = (ymd) =>
  formatDate(ymd, { year: 'numeric', month: 'long', day: 'numeric' });

export const formatMonth = (ymd) => formatDate(ymd, { month: 'long', year: 'numeric' });

export const weekdayNames = (weekStart = state.user?.weekStart ?? 1, style = 'short') => {
  const base = new Date(Date.UTC(2024, 0, 7)); // a Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + ((i + weekStart) % 7));
    return fmt({ weekday: style }).format(d);
  });
};

/** Human phrasing for a due date, relative where that reads more naturally. */
export function relativeDate(ymd, base = today()) {
  if (!ymd) return '';
  const delta = daysBetween(base, ymd);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta < 7) return formatDate(ymd, { weekday: 'long' });
  if (delta < -1 && delta > -7) return `${Math.abs(delta)} days ago`;
  const sameYear = String(ymd).slice(0, 4) === String(base).slice(0, 4);
  return formatDate(ymd, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function overdueLabel(ymd, base = today()) {
  const delta = daysBetween(base, ymd);
  if (delta >= 0) return '';
  const days = Math.abs(delta);
  if (days === 1) return '1 day overdue';
  if (days < 30) return `${days} days overdue`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} overdue`;
}

/** 24-hour "17:30" rendered in the locale's own convention. */
export function formatTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(d);
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state.user?.timezone || undefined,
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units = [
    ['minute', 60], ['hour', 3600], ['day', 86400],
    ['week', 604800], ['month', 2629800], ['year', 31557600],
  ];
  let chosen = units[0];
  for (const unit of units) if (seconds >= unit[1]) chosen = unit;
  return rtf.format(-Math.round(seconds / chosen[1]), chosen[0]);
}

export function greeting(clock = new Date()) {
  let hour = clock.getHours();
  try {
    if (state.user?.timezone) {
      hour = Number(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: state.user.timezone, hour: '2-digit', hour12: false,
        }).format(clock)
      );
    }
  } catch { /* fall back to the device clock */ }
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

export function durationLabel(minutes) {
  if (!minutes && minutes !== 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
