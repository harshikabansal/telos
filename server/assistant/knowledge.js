/**
 * The assistant's knowledge of TELOS itself.
 *
 * Every answer about a setting, a term, or where something lives is grounded
 * in this file rather than invented. It is the source of truth in both modes:
 * the local responder searches it directly, and the Claude adapter injects the
 * relevant entries into the system prompt so the model describes the product
 * as it actually is.
 *
 * When a setting changes, change it here too.
 */

export const SETTINGS = [
  {
    id: 'theme',
    name: 'Theme',
    section: 'Appearance',
    path: 'Settings → Appearance → Theme',
    keywords: ['theme', 'dark', 'light', 'mode', 'appearance', 'night', 'colour scheme', 'color scheme'],
    what: 'Light, Dark, or System.',
    detail: 'System follows your device. The choice is stored on your account, so it follows you to any device you sign in from.',
  },
  {
    id: 'accent',
    name: 'Accent',
    section: 'Appearance',
    path: 'Settings → Appearance → Accent',
    keywords: ['accent', 'colour', 'color', 'clay', 'moss', 'indigo', 'amber', 'slate'],
    what: 'One of five restrained accent colours: clay, moss, indigo, amber or slate.',
    detail: 'TELOS uses a single accent throughout rather than colour-coding everything.',
  },
  {
    id: 'density',
    name: 'Density',
    section: 'Appearance',
    path: 'Settings → Appearance → Density',
    keywords: ['density', 'compact', 'comfortable', 'spacing', 'tighter', 'smaller'],
    what: 'Comfortable or Compact.',
    detail: 'Compact tightens spacing across every view — useful on a smaller screen or when you hold a lot of work.',
  },
  {
    id: 'defaultPriority',
    name: 'Default priority',
    section: 'Planning',
    path: 'Settings → Planning → Default priority',
    keywords: ['default priority', 'priority default', 'new task priority'],
    what: 'The priority applied to anything you create without stating one.',
    detail: 'Low, Medium, High or Urgent. Medium unless you change it.',
  },
  {
    id: 'defaultDuration',
    name: 'Default duration',
    section: 'Planning',
    path: 'Settings → Planning → Default duration',
    keywords: ['default duration', 'estimate', 'minutes', 'how long'],
    what: 'The estimate applied to a new responsibility, in minutes.',
    detail: 'It is only an estimate — nothing enforces it.',
  },
  {
    id: 'defaultReminder',
    name: 'Default reminder',
    section: 'Planning',
    path: 'Settings → Planning → Default reminder',
    keywords: ['default reminder', 'remind', 'reminder default'],
    what: 'The reminder applied to new responsibilities.',
    detail: 'No reminder, at the due time, or 15 minutes / 30 minutes / 1 hour / 1 day before. Individual responsibilities can override it.',
  },
  {
    id: 'defaultView',
    name: 'Default view',
    section: 'Planning',
    path: 'Settings → Planning → Default view',
    keywords: ['default view', 'list', 'board', 'timeline', 'opens in'],
    what: 'Which layout My Tasks opens in: List, Board or Timeline.',
    detail: 'You can still switch layout at any time from the view control in the top right of My Tasks.',
  },
  {
    id: 'weekStart',
    name: 'Week starts on',
    section: 'Planning',
    path: 'Settings → Planning → Week starts on',
    keywords: ['week start', 'monday', 'sunday', 'saturday', 'first day of week', 'calendar starts'],
    what: 'Monday, Sunday or Saturday.',
    detail: 'Used by the calendar and by weekly planning views.',
  },
  {
    id: 'timezone',
    name: 'Timezone',
    section: 'Planning',
    path: 'Settings → Planning → Timezone',
    keywords: ['timezone', 'time zone', 'utc', 'clock', 'wrong time', 'travelling', 'traveling'],
    what: 'The timezone all your dates and reminders are calculated in.',
    detail: 'If tasks look like they are due on the wrong day, this is almost always the setting to check.',
  },
  {
    id: 'workingHours',
    name: 'Working hours',
    section: 'Planning',
    path: 'Settings → Planning → Working hours',
    keywords: ['working hours', 'work hours', 'study hours', 'available'],
    what: 'The hours your day is realistically available.',
    detail: 'Helps TELOS understand when you actually have room, rather than assuming a whole day is free.',
  },
  {
    id: 'recurrenceCatchup',
    name: 'Missed recurring items',
    section: 'Planning',
    path: 'Settings → Planning → Missed recurring items',
    keywords: ['missed', 'recurring', 'catch up', 'catchup', 'skipped', 'behind', 'overdue habit'],
    what: 'What happens when you complete a recurring responsibility late.',
    detail: '"Move to the next future date" skips the occurrences you missed. "Advance one occurrence at a time" steps forward a single occurrence, so nothing is silently dropped.',
  },
  {
    id: 'notifyPush',
    name: 'In-app reminders',
    section: 'Notifications',
    path: 'Settings → Notifications → In-app reminders',
    keywords: ['notification', 'reminder', 'in-app', 'alerts', 'bell', 'notify'],
    what: 'Whether reminders appear inside TELOS when they come due.',
    detail: 'Turning this off stops reminders surfacing; the reminders themselves are still stored on the responsibilities.',
  },
  {
    id: 'notifyEmail',
    name: 'Email reminders',
    section: 'Notifications',
    path: 'Settings → Notifications → Email reminders',
    keywords: ['email', 'email reminder', 'mail'],
    what: 'Whether reminders are also sent by email.',
    detail: 'This needs a mail transport configured on the server. Without one, nothing is sent — reset and confirmation messages are written to the server log instead.',
  },
  {
    id: 'notifyDigest',
    name: 'Daily summary',
    section: 'Notifications',
    path: 'Settings → Notifications → Daily summary',
    keywords: ['digest', 'daily summary', 'morning', 'summary email'],
    what: 'One message each morning with what deserves your attention.',
    detail: 'Also requires a configured mail transport.',
  },
  {
    id: 'quietHours',
    name: 'Quiet hours',
    section: 'Notifications',
    path: 'Settings → Notifications → Quiet hours',
    keywords: ['quiet hours', 'do not disturb', 'silence', 'night', 'stop notifications'],
    what: 'A window during which nothing will reach you.',
    detail: 'Set a start and end time. Leave both empty for no quiet window.',
  },
  {
    id: 'areas',
    name: 'Areas of Life',
    section: 'Areas of Life',
    path: 'Settings → Areas of Life',
    keywords: ['area', 'areas', 'category', 'categories', 'life area', 'reorder', 'icon', 'hide area'],
    what: 'Add, rename, reorder, hide or delete the parts of your life TELOS tracks.',
    detail: 'Deleting an area keeps its responsibilities — they simply become unassigned. Hiding an area removes it from pickers without deleting anything.',
  },
  {
    id: 'password',
    name: 'Change password',
    section: 'Privacy & Security',
    path: 'Settings → Privacy & Security → Password',
    keywords: ['password', 'change password', 'new password'],
    what: 'Change your password. You need your current one.',
    detail: 'Changing it signs out every other device and rotates the token on this one.',
  },
  {
    id: 'sessions',
    name: 'Active sessions',
    section: 'Privacy & Security',
    path: 'Settings → Privacy & Security → Active sessions',
    keywords: ['session', 'sessions', 'devices', 'logged in', 'signed in', 'sign out other', 'log out everywhere'],
    what: 'Every device currently signed in, with its last activity.',
    detail: 'You can revoke any one of them, or sign out of all other devices at once.',
  },
  {
    id: 'export',
    name: 'Export',
    section: 'Data',
    path: 'Settings → Data → Export',
    keywords: ['export', 'download', 'backup', 'json', 'copy of my data'],
    what: 'A complete copy of everything in your account, as a single JSON file.',
    detail: 'Includes responsibilities, projects, objectives, milestones, notes, events, areas and completion history.',
  },
  {
    id: 'import',
    name: 'Import',
    section: 'Data',
    path: 'Settings → Data → Import',
    keywords: ['import', 'restore', 'upload backup'],
    what: 'Restore a previous TELOS export into this account.',
    detail: 'Imported records are given new identifiers, so an import can never reference or overwrite another account.',
  },
  {
    id: 'deleteData',
    name: 'Delete data',
    section: 'Data',
    path: 'Settings → Data → Delete data',
    keywords: ['delete data', 'wipe', 'clear', 'start over', 'remove everything', 'reset'],
    what: 'Delete selected kinds of data, or empty the account entirely while keeping your sign-in.',
    detail: 'Both are irreversible and require typing a confirmation phrase. Export first if you may want the data later.',
  },
  {
    id: 'deleteAccount',
    name: 'Delete account',
    section: 'Privacy & Security',
    path: 'Settings → Privacy & Security → Delete account',
    keywords: ['delete account', 'close account', 'remove account', 'cancel'],
    what: 'Permanently removes your account and everything in it.',
    detail: 'Requires your password and a typed confirmation. Nothing is retained and nothing can be recovered.',
  },
  {
    id: 'weeklyReview',
    name: 'Weekly review',
    section: 'Insights',
    path: 'Insights → Weekly review',
    keywords: ['weekly review', 'week review', 'reflection', 'reflect', 'look back'],
    what: 'A week seen as it actually went, with a space to write about it.',
    detail: 'Move between weeks with the arrows. What you write saves as you type and is private to your account.',
  },
  {
    id: 'assistant',
    name: 'Assistant',
    section: 'Assistant',
    path: 'Settings → Assistant',
    keywords: ['assistant', 'ai', 'chatbot', 'suggestions', 'help', 'claude'],
    what: 'Choose whether the assistant answers on this server only, or uses Claude for richer suggestions.',
    detail: 'On this server only, nothing you write ever leaves the machine TELOS runs on. Using Claude sends only the specific text you are asking about, and only when you ask.',
  },
];

/**
 * Product vocabulary. The distinctions here are the ones people actually ask
 * about, and the ones an assistant most easily gets wrong.
 */
export const CONCEPTS = [
  {
    id: 'ladder',
    term: 'How the pieces fit together',
    keywords: ['hierarchy', 'ladder', 'structure', 'how does it work', 'difference between', 'organise', 'organize'],
    body: 'TELOS goes Purpose → Objective → Milestone → Project → Responsibility → Today. An objective is an outcome you are moving toward. A milestone is a marker on the way there. A project groups several responsibilities heading for one result. A responsibility is a single thing you do. Progress flows back up automatically.',
  },
  {
    id: 'objective',
    term: 'Objective',
    keywords: ['objective', 'goal', 'outcome', 'aim'],
    body: 'An objective is an outcome you want to reach — "Become conversational in German" — not another item to tick off. Give it a horizon and, if it helps, a target date. Its progress is calculated from the milestones and projects beneath it, or you can set it by hand.',
  },
  {
    id: 'milestone',
    term: 'Milestone',
    keywords: ['milestone', 'marker', 'stage', 'phase'],
    body: 'A milestone bridges an objective and the work beneath it — "Complete A2", "Publish the portfolio". Each one can hold projects and responsibilities, and completing them moves the objective forward.',
  },
  {
    id: 'project',
    term: 'Project',
    keywords: ['project', 'group', 'bundle'],
    body: 'Create a project when several responsibilities begin moving toward a shared outcome. Its progress is simply how many of its responsibilities are complete.',
  },
  {
    id: 'responsibility',
    term: 'Responsibility',
    keywords: ['responsibility', 'task', 'todo', 'to-do', 'item'],
    body: 'A responsibility is a single thing you do. TELOS calls tasks responsibilities in most places because they are things you have taken on, not just entries in a list.',
  },
  {
    id: 'importance',
    term: 'Important vs urgent',
    keywords: ['important', 'urgent', 'priority', 'meaningful', 'difference'],
    body: 'Urgent is about time — a deadline in two hours. Important is about consequence — an application due this month matters whether or not it is pressing today. Meaningful is work that moves a long-term objective even with no deadline at all. Priority sets urgency; the Important switch sets consequence. TELOS keeps them separate on purpose, so a loud deadline cannot crowd out something that actually matters.',
  },
  {
    id: 'focus',
    term: "Today's Focus",
    keywords: ['focus', 'today', 'dashboard', 'overview', 'ordering', 'sorted'],
    body: "Today's Focus is not just what is due today in date order. It blends how soon something is due, its priority, whether you marked it important, whether you have already started it, and whether it serves an objective.",
  },
  {
    id: 'recurrence',
    term: 'Recurring responsibilities',
    keywords: ['recurring', 'repeat', 'habit', 'every week', 'routine'],
    body: 'A responsibility can repeat daily, on weekdays, weekly on any set of days, fortnightly, monthly, on a set day each month, quarterly, yearly, or on a custom interval. Completing one occurrence advances the next. Future occurrences appear on the calendar as dashed items.',
  },
  {
    id: 'quickadd',
    term: 'Quick Add',
    keywords: ['quick add', 'natural language', 'shortcut', 'fast', 'type'],
    body: 'Quick Add reads a plain sentence. "Submit assignment tomorrow at 6 PM, high priority" becomes a dated, timed, high-priority responsibility. Use #Area to set an area and @Project to attach it to a project. Whatever it understood is shown as chips before anything is created.',
  },
  {
    id: 'shortcuts',
    term: 'Keyboard shortcuts',
    keywords: ['shortcut', 'keyboard', 'hotkey', 'keys'],
    body: 'N opens Quick Add, / focuses search, and G followed by O, T, C, P, I, N or S jumps to Overview, My Tasks, Calendar, Projects, Insights, Notes or Settings. Esc closes any dialog.',
  },
  {
    id: 'reflection',
    term: 'Weekly reflection',
    keywords: ['reflection', 'reflect', 'weekly review', 'week review', 'look back', 'retrospective', 'review my week'],
    body: 'Insights → Weekly review shows a week as it actually went: what was completed and on which days, what was due and is still open, where your attention went by area, which milestones and objectives moved, and what is dated for the week ahead. Beneath it is a space to write, with a few questions drawn from that particular week. The writing is yours and saves as you type; the figures are stored with it, so a reflection read months later still shows the week it was about. There is no score and no streak — a week where little moved is reported as plainly as a busy one.',
  },
  {
    id: 'insights',
    term: 'Insights',
    keywords: ['insights', 'stats', 'analytics', 'charts', 'completion rate'],
    body: 'Insights shows completion rate, where your attention goes by area and priority, which days and times you tend to finish things, and how projects and objectives are progressing. Completion rate is the share of work that was due in the period and is now done. There are no streaks or scores.',
  },
  {
    id: 'privacy',
    term: 'Privacy',
    keywords: ['privacy', 'private', 'secure', 'who can see', 'data', 'safe'],
    body: 'Everything you write is private to your account and stored on the server you run TELOS on. Your data is scoped to you at the database level, there is no third-party analytics, and you can export or delete everything at any time from Settings → Data.',
  },
];

/**
 * Relevance scoring.
 *
 * Matching is on whole words, not substrings: "important" must not match the
 * Import setting, and "meeting" must not match "meet". Multi-word keywords
 * score higher because they are far less likely to match by accident.
 */
const patterns = new Map();
function wordPattern(keyword) {
  if (!patterns.has(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.set(keyword, new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu'));
  }
  return patterns.get(keyword);
}

function score(text, entry) {
  let points = 0;
  for (const keyword of entry.keywords) {
    if (wordPattern(keyword).test(text)) points += keyword.includes(' ') ? 3 : 2;
  }
  const name = entry.name || entry.term || '';
  if (name && wordPattern(name).test(text)) points += 3;
  return points;
}

const rank = (list, text, limit, threshold) =>
  list
    .map((entry) => ({ entry, points: score(text, entry) }))
    .filter((row) => row.points >= threshold)
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);

/** Ranked settings, with their scores — the caller decides what wins. */
export const rankSettings = (text, limit = 3, threshold = 3) => rank(SETTINGS, text, limit, threshold);

/** Ranked concepts. The bar is lower: a single concept word is a real signal. */
export const rankConcepts = (text, limit = 2, threshold = 2) => rank(CONCEPTS, text, limit, threshold);

export const findSettings = (text, limit = 3) => rankSettings(text, limit).map((row) => row.entry);
export const findConcepts = (text, limit = 2) => rankConcepts(text, limit).map((row) => row.entry);

/** A compact rendering of the whole knowledge base, for the system prompt. */
export function knowledgeDigest() {
  const settings = SETTINGS.map(
    (s) => `- ${s.name} (${s.path}): ${s.what} ${s.detail}`
  ).join('\n');
  const concepts = CONCEPTS.map((c) => `- ${c.term}: ${c.body}`).join('\n');
  return `SETTINGS IN TELOS\n${settings}\n\nHOW TELOS WORKS\n${concepts}`;
}
