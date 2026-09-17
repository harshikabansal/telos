import { addDays, addMonths, today, toDate, toYmd, weekdayOf } from './dates.js';
import { state } from './store.js';

/**
 * Natural-language parsing for Quick Add.
 *
 * "Submit assignment tomorrow at 6 PM, high priority"
 *   → title: Submit assignment · due: tomorrow · time: 18:00 · priority: high
 *
 * "Review finances every Sunday at 10 AM"
 *   → title: Review finances · recurrence: weekly on Sunday · time: 10:00
 *
 * Everything it understands is shown back as a chip before the item is
 * created, so the interpretation is never a surprise. The structured editor
 * remains available for anything the parser does not catch.
 */

const WEEKDAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};
const UNIT_TO_FREQ = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };

const pad = (n) => String(n).padStart(2, '0');

function nextWeekday(from, weekday, { forceNext = false } = {}) {
  const current = weekdayOf(from);
  let delta = (weekday - current + 7) % 7;
  if (delta === 0 && !forceNext) return from;
  if (delta === 0) delta = 7;
  return addDays(from, delta);
}

function to24Hour(hour, minute, meridiem) {
  let h = hour;
  if (meridiem === 'pm' && h < 12) h += 12;
  if (meridiem === 'am' && h === 12) h = 0;
  if (!meridiem && h < 7) h += 12; // "at 6" on a planning tool means the evening
  return `${pad(h % 24)}:${pad(minute)}`;
}

export function parseQuickAdd(input) {
  const result = {
    title: '',
    dueDate: null,
    dueTime: null,
    priority: null,
    important: false,
    recurrence: null,
    areaId: null,
    projectId: null,
    objectiveId: null,
    tags: [],
    estimatedMinutes: null,
    reminder: null,
    tokens: [],
  };
  if (!input || !input.trim()) return result;

  let text = ` ${input.trim()} `;
  const base = today();
  const consume = (match, label, type) => {
    if (!match) return;
    text = text.replace(match, ' ');
    if (label) result.tokens.push({ label, type });
  };

  /* --- Recurrence (checked before plain dates so "every Sunday" wins) ---- */
  let m;
  if ((m = text.match(/\bevery\s+(\d+)\s+(day|week|month|year)s?\b/i))) {
    const every = Number(m[1]);
    result.recurrence = every === 1
      ? { freq: UNIT_TO_FREQ[m[2].toLowerCase()] }
      : { freq: 'custom', every, unit: m[2].toLowerCase() };
    consume(m[0], `Every ${every} ${m[2].toLowerCase()}${every > 1 ? 's' : ''}`, 'recurrence');
  } else if ((m = text.match(/\bevery\s+other\s+(day|week|month|year)\b/i))) {
    result.recurrence = { freq: 'custom', every: 2, unit: m[1].toLowerCase() };
    consume(m[0], `Every other ${m[1].toLowerCase()}`, 'recurrence');
  } else if ((m = text.match(/\bevery\s+(weekday|workday|working day)s?\b/i))) {
    result.recurrence = { freq: 'weekdays' };
    consume(m[0], 'Every weekday', 'recurrence');
  } else if ((m = text.match(/\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i))) {
    const day = WEEKDAYS[m[1].toLowerCase()];
    result.recurrence = { freq: 'weekly', weekdays: [day] };
    result.dueDate = nextWeekday(base, day);
    consume(m[0], `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]}`, 'recurrence');
  } else if ((m = text.match(/\b(daily|every day)\b/i))) {
    result.recurrence = { freq: 'daily' };
    consume(m[0], 'Every day', 'recurrence');
  } else if ((m = text.match(/\b(weekly|every week)\b/i))) {
    result.recurrence = { freq: 'weekly' };
    consume(m[0], 'Every week', 'recurrence');
  } else if ((m = text.match(/\b(fortnightly|biweekly|every two weeks|every 2 weeks)\b/i))) {
    result.recurrence = { freq: 'biweekly' };
    consume(m[0], 'Every two weeks', 'recurrence');
  } else if ((m = text.match(/\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b/i))) {
    result.recurrence = { freq: 'monthly_date', day: Math.min(31, Number(m[1])) };
    consume(m[0], `Day ${m[1]} monthly`, 'recurrence');
  } else if ((m = text.match(/\b(monthly|every month)\b/i))) {
    result.recurrence = { freq: 'monthly' };
    consume(m[0], 'Every month', 'recurrence');
  } else if ((m = text.match(/\b(quarterly|every quarter)\b/i))) {
    result.recurrence = { freq: 'quarterly' };
    consume(m[0], 'Every quarter', 'recurrence');
  } else if ((m = text.match(/\b(yearly|annually|every year)\b/i))) {
    result.recurrence = { freq: 'yearly' };
    consume(m[0], 'Every year', 'recurrence');
  }

  /* ------------------------------- Dates -------------------------------- */
  const setDate = (value, label) => {
    if (!result.dueDate || result.recurrence) result.dueDate = value;
    else result.dueDate = value;
    if (label) result.tokens.push({ label, type: 'date' });
  };

  if ((m = text.match(/\b(\d{4}-\d{2}-\d{2})\b/))) {
    setDate(m[1], m[1]);
    consume(m[0]);
  } else if ((m = text.match(/\bin\s+(\d+)\s+(day|week|month)s?\b/i))) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const value = unit === 'day' ? addDays(base, n) : unit === 'week' ? addDays(base, n * 7) : addMonths(base, n);
    setDate(value, `In ${n} ${unit}${n > 1 ? 's' : ''}`);
    consume(m[0]);
  } else if ((m = text.match(/\b(today|tonight)\b/i))) {
    setDate(base, 'Today');
    if (/tonight/i.test(m[1])) result.dueTime = result.dueTime || '20:00';
    consume(m[0]);
  } else if ((m = text.match(/\b(tomorrow|tmrw?|tmr)\b/i))) {
    setDate(addDays(base, 1), 'Tomorrow');
    consume(m[0]);
  } else if ((m = text.match(/\bday after tomorrow\b/i))) {
    setDate(addDays(base, 2), 'In 2 days');
    consume(m[0]);
  } else if ((m = text.match(/\bthis weekend\b/i))) {
    setDate(nextWeekday(base, 6), 'This weekend');
    consume(m[0]);
  } else if ((m = text.match(/\bnext week\b/i))) {
    setDate(addDays(base, 7), 'Next week');
    consume(m[0]);
  } else if ((m = text.match(/\bnext month\b/i))) {
    setDate(addMonths(base, 1), 'Next month');
    consume(m[0]);
  } else if ((m = text.match(/\bend of (?:the )?month\b/i))) {
    const d = toDate(base);
    setDate(toYmd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))), 'End of month');
    consume(m[0]);
  } else if ((m = text.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i))) {
    const day = WEEKDAYS[m[2].toLowerCase()];
    const value = nextWeekday(base, day, { forceNext: Boolean(m[1]) });
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    setDate(value, `${m[1] ? 'Next ' : ''}${names[day]}`);
    consume(m[0]);
  } else if (
    (m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i)) ||
    (m = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i))
  ) {
    const first = Number(m[1]);
    const monthName = Number.isNaN(first) ? m[1] : m[2];
    const day = Number.isNaN(first) ? Number(m[2]) : first;
    const month = MONTHS[String(monthName).toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      const year = toDate(base).getUTCFullYear();
      let value = `${year}-${pad(month + 1)}-${pad(day)}`;
      if (value < base) value = `${year + 1}-${pad(month + 1)}-${pad(day)}`;
      setDate(value, `${monthName[0].toUpperCase()}${monthName.slice(1, 3)} ${day}`);
      consume(m[0]);
    }
  }

  /* ------------------------------- Times -------------------------------- */
  if ((m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)) ||
      (m = text.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)) ||
      (m = text.match(/\b(\d{1,2})\s*(am|pm)\b/i))) {
    const hour = Number(m[1]);
    const hasMinutes = m[2] && /^\d{2}$/.test(m[2]);
    const minute = hasMinutes ? Number(m[2]) : 0;
    const meridiem = (hasMinutes ? m[3] : m[2] || m[3])?.toLowerCase();
    if (hour <= 24 && minute < 60) {
      result.dueTime = to24Hour(hour, minute, meridiem === 'am' || meridiem === 'pm' ? meridiem : null);
      consume(m[0], result.dueTime, 'time');
    }
  } else if ((m = text.match(/\b(noon|midday)\b/i))) {
    result.dueTime = '12:00';
    consume(m[0], 'Noon', 'time');
  } else if ((m = text.match(/\bmidnight\b/i))) {
    result.dueTime = '23:59';
    consume(m[0], 'Midnight', 'time');
  } else if ((m = text.match(/\bmorning\b/i))) {
    result.dueTime = '09:00';
    consume(m[0], 'Morning', 'time');
  } else if ((m = text.match(/\bevening\b/i))) {
    result.dueTime = '18:00';
    consume(m[0], 'Evening', 'time');
  }

  /* ----------------------------- Priority ------------------------------- */
  if ((m = text.match(/\b(urgent|asap)\b/i)) || (m = text.match(/(?:^|\s)!!!(?=\s|$)/))) {
    result.priority = 'urgent';
    consume(m[0], 'Urgent', 'priority');
  } else if ((m = text.match(/\bhigh[- ]?priority\b/i)) || (m = text.match(/\bpriority[:\s]+high\b/i)) ||
             (m = text.match(/(?:^|\s)!!(?=\s|$)/)) || (m = text.match(/(?:^|\s)!high\b/i)) ||
             (m = text.match(/(?:^|\s)p1\b/i))) {
    result.priority = 'high';
    consume(m[0], 'High priority', 'priority');
  } else if ((m = text.match(/\blow[- ]?priority\b/i)) || (m = text.match(/(?:^|\s)!low\b/i)) ||
             (m = text.match(/(?:^|\s)p4\b/i))) {
    result.priority = 'low';
    consume(m[0], 'Low priority', 'priority');
  } else if ((m = text.match(/\bmedium[- ]?priority\b/i)) || (m = text.match(/(?:^|\s)p[23]\b/i))) {
    result.priority = 'medium';
    consume(m[0], 'Medium priority', 'priority');
  }

  if ((m = text.match(/\bimportant\b/i)) || (m = text.match(/(?:^|\s)\*(?=\s|$)/))) {
    result.important = true;
    consume(m[0], 'Important', 'important');
  }

  /* ---------------------------- Duration -------------------------------- */
  if ((m = text.match(/\bfor\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i))) {
    const n = Number(m[1]);
    result.estimatedMinutes = /^h/i.test(m[2]) ? n * 60 : n;
    consume(m[0], `${result.estimatedMinutes} min`, 'duration');
  }

  /* ---------------------------- Reminder -------------------------------- */
  if ((m = text.match(/\bremind(?:er)?(?:\s+me)?\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|day|days)\s*(?:before|prior)\b/i))) {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const key = unit.startsWith('d') ? (n >= 2 ? '2d' : '1d')
      : unit.startsWith('h') ? (n >= 2 ? '2h' : '1h')
      : n >= 30 ? '30m' : n >= 15 ? '15m' : '5m';
    result.reminder = key;
    consume(m[0], `Reminder ${key} before`, 'reminder');
  } else if ((m = text.match(/\bremind(?:er)?(?:\s+me)?\b/i))) {
    result.reminder = 'at_time';
    consume(m[0], 'Reminder', 'reminder');
  }

  /* ------------------- Areas, projects and tags -------------------------- */
  const hashMatches = [...text.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}&_-]{0,39})/gu)];
  for (const match of hashMatches) {
    const raw = match[1];
    const area = state.areas.find(
      (a) => a.name.toLowerCase().replace(/[\s&]+/g, '') === raw.toLowerCase().replace(/[\s&_-]+/g, '')
    );
    if (area && !result.areaId) {
      result.areaId = area.id;
      consume(match[0], area.name, 'area');
    } else {
      result.tags.push(raw);
      consume(match[0], `#${raw}`, 'tag');
    }
  }

  const atMatches = [...text.matchAll(/[@+]([\p{L}\p{N}][\p{L}\p{N} _-]{0,49})/gu)];
  for (const match of atMatches) {
    const raw = match[1].trim().toLowerCase();
    const project = state.projects.find((p) => p.name.toLowerCase().startsWith(raw)) ||
      state.projects.find((p) => p.name.toLowerCase().includes(raw));
    if (project && !result.projectId) {
      result.projectId = project.id;
      consume(match[0], project.name, 'project');
      continue;
    }
    const objective = state.objectives.find((o) => o.title.toLowerCase().startsWith(raw));
    if (objective && !result.objectiveId) {
      result.objectiveId = objective.id;
      consume(match[0], objective.title, 'objective');
    }
  }

  result.title = text
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[,;·]\s*$/, '')
    .replace(/^[\s,;·-]+|[\s,;·-]+$/g, '')
    .trim();

  return result;
}

/* ------------------------------------------------------------------ *
 * Knowing when the patterns fell short
 * ------------------------------------------------------------------ */

const RECURRENCE_HINT =
  /\b(every|each|weekly|daily|monthly|yearly|annually|fortnight(ly)?|recurring|twice a|times a (day|week|month|year))\b/i;

const DATE_HINT =
  /\b(today|tonight|tomorrow|tmrw?|next|last|this (week|month|weekend)|weekend|deadline|due|by|before|after|until|starting|deadline|sometime|soon|later|end of|start of|beginning of|couple of|few|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|weeks?|months?|days?)\b/i;

/**
 * Does this sentence look like it said something about *when*, that the
 * patterns did not pick up?
 *
 * The pattern matcher is right most of the time and costs nothing, so this
 * only reports the case worth paying for: the person clearly wrote scheduling
 * language and it produced nothing, which would otherwise create a task that
 * silently lost its date.
 */
export function looksUnread(text, parsed) {
  const value = String(text || '').trim();
  if (value.length < 12) return false;
  if (RECURRENCE_HINT.test(value) && !parsed.recurrence) return true;
  if (DATE_HINT.test(value) && !parsed.dueDate) return true;
  return false;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A recurrence rule in words, for the chips. */
export function recurrenceLabel(rule) {
  if (!rule?.freq) return '';
  switch (rule.freq) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Every weekday';
    case 'weekly':
      return rule.weekdays?.length
        ? `Every ${rule.weekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')}`
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

export default parseQuickAdd;
