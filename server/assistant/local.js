import { CONCEPTS, rankConcepts, rankSettings } from './knowledge.js';
import { answerFromPlan } from './plan.js';

/**
 * The on-server assistant.
 *
 * It answers from the knowledge base and from simple language rules — no
 * network call, no API key, nothing leaves the machine. This is the default
 * mode, and it is deliberately capable enough to be useful on its own:
 * settings questions and "what is the difference between X and Y" are
 * answered here more reliably than a language model would answer them,
 * because the answers come from the product's own definitions.
 */

/* ------------------------------------------------------------------ *
 * Title suggestions
 * ------------------------------------------------------------------ */

const FILLER = new Set([
  'a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'my', 'some', 'that',
  'this', 'i', 'need', 'want', 'have', 'got', 'must', 'should', 'gotta',
  'please', 'just', 'really', 'maybe', 'stuff', 'things', 'thing',
]);

/** Weak openers people type, and the stronger verb to lead with instead. */
const VERB_HINTS = [
  { match: /\b(email|mail|write to|message)\b/i, verb: 'Email' },
  { match: /\b(call|ring|phone)\b/i, verb: 'Call' },
  { match: /\b(book|reserve|schedule)\b/i, verb: 'Book' },
  { match: /\b(buy|order|purchase|get)\b/i, verb: 'Order' },
  { match: /\b(pay|invoice|bill)\b/i, verb: 'Pay' },
  { match: /\b(read|study|revise)\b/i, verb: 'Read' },
  { match: /\b(write|draft|compose)\b/i, verb: 'Draft' },
  { match: /\b(fix|repair|debug)\b/i, verb: 'Fix' },
  { match: /\b(plan|organise|organize)\b/i, verb: 'Plan' },
  { match: /\b(review|check|look at|go over)\b/i, verb: 'Review' },
  { match: /\b(finish|complete|wrap up)\b/i, verb: 'Finish' },
  { match: /\b(send|submit|hand in)\b/i, verb: 'Submit' },
  { match: /\b(clean|tidy|sort)\b/i, verb: 'Tidy' },
  { match: /\b(research|find out|look up)\b/i, verb: 'Research' },
  { match: /\b(renew|extend)\b/i, verb: 'Renew' },
  { match: /\b(cancel|unsubscribe)\b/i, verb: 'Cancel' },
];

const titleCase = (text) =>
  text.charAt(0).toUpperCase() + text.slice(1);

const tidy = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, '')
    .trim();

/** Strips the "I need to…" scaffolding people type before the real verb. */
function stripPreamble(text) {
  return text
    .replace(/^\s*(i\s+)?(need|want|have|has|got|ought)\s+to\s+/i, '')
    .replace(/^\s*(i\s+)?(should|must|will|am going to|gonna)\s+/i, '')
    .replace(/^\s*(remember|remind me)\s+to\s+/i, '')
    .replace(/^\s*(todo|to-do|task)\s*[:-]\s*/i, '');
}

export function suggestTitles(input, { context = {} } = {}) {
  const raw = tidy(String(input || ''));
  if (!raw) return [];

  const core = tidy(stripPreamble(raw));
  if (!core) return [];

  const suggestions = new Set();

  // 1. The cleaned-up version of what they wrote.
  suggestions.add(titleCase(core));

  // 2. Verb-first, which reads as an action rather than a topic.
  //
  // The verb has to be the *leading* action. "Draft the case study
  // introduction" contains "study", but rewriting around it would produce
  // "Read Draft the case introduction" — so a verb buried mid-phrase is
  // ignored rather than promoted.
  for (const hint of VERB_HINTS) {
    const found = hint.match.exec(core);
    if (!found) continue;
    const leadingWords = core.slice(0, found.index).trim().split(/\s+/).filter(Boolean).length;
    if (leadingWords > 1) continue;
    const withoutVerb = tidy(core.replace(hint.match, ''));
    const rest = tidy(withoutVerb.replace(/^(the|a|an|to|for|about|on)\s+/i, ''));
    if (rest) suggestions.add(`${hint.verb} ${rest}`);
    break;
  }

  // 3. A tightened version with filler removed, when that shortens it usefully.
  const words = core.split(/\s+/);
  if (words.length > 4) {
    const tightened = words
      .filter((word, index) => index === 0 || !FILLER.has(word.toLowerCase()))
      .join(' ');
    if (tightened.split(/\s+/).length < words.length) {
      suggestions.add(titleCase(tidy(tightened)));
    }
  }

  // 4. Scoped by area, which helps when several areas hold similar work.
  if (context.areaName && !core.toLowerCase().includes(context.areaName.toLowerCase())) {
    suggestions.add(`${titleCase(core)} (${context.areaName})`);
  }

  // Offering back exactly what they already wrote is not a suggestion.
  const original = raw.toLowerCase();
  return [...suggestions]
    .filter(Boolean)
    .filter((suggestion) => suggestion.toLowerCase() !== original)
    .slice(0, 4);
}

/* ------------------------------------------------------------------ *
 * Descriptions
 * ------------------------------------------------------------------ */

export function suggestDescriptions(title, { context = {} } = {}) {
  const subject = tidy(stripPreamble(String(title || '')));
  if (!subject) return [];

  const out = [
    `What "done" looks like: ${subject.toLowerCase()} is finished and needs no follow-up.`,
    `First step: the smallest thing that would move ${subject.toLowerCase()} forward in ten minutes.`,
  ];

  if (context.projectName) {
    out.push(`Part of ${context.projectName}. Note anything the rest of the project depends on.`);
  }
  if (context.objectiveTitle) {
    out.push(`Serves "${context.objectiveTitle}" — worth noting why this step matters to it.`);
  }
  return out.slice(0, 3);
}

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

/** Dates make poor tags — they describe when, not what. */
const TEMPORAL = new Set([
  'today', 'tomorrow', 'tonight', 'yesterday', 'morning', 'afternoon', 'evening',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
  'weekly', 'monthly', 'yearly', 'daily', 'before', 'after', 'later', 'soon',
  'week', 'month', 'tomorrows', 'weekend',
]);

const TAG_RULES = [
  { match: /\b(email|call|reply|message|respond|follow up)\b/i, tag: 'communication' },
  { match: /\b(read|study|revise|learn|course|lecture)\b/i, tag: 'learning' },
  { match: /\b(write|draft|edit|essay|report|document)\b/i, tag: 'writing' },
  { match: /\b(pay|invoice|budget|bill|tax|bank|save)\b/i, tag: 'finance' },
  { match: /\b(book|flight|hotel|travel|trip|visa)\b/i, tag: 'travel' },
  { match: /\b(run|gym|train|workout|exercise|stretch)\b/i, tag: 'fitness' },
  { match: /\b(buy|order|shop|groceries)\b/i, tag: 'errand' },
  { match: /\b(fix|repair|clean|tidy|install|replace)\b/i, tag: 'maintenance' },
  { match: /\b(plan|review|reflect|retro|weekly)\b/i, tag: 'planning' },
  { match: /\b(meet|meeting|standup|catch up|coffee)\b/i, tag: 'meeting' },
  { match: /\b(research|compare|investigate|explore)\b/i, tag: 'research' },
  { match: /\b(deploy|build|code|debug|test|refactor)\b/i, tag: 'build' },
  { match: /\b(apply|application|cv|resume|interview)\b/i, tag: 'applications' },
  { match: /\b(deadline|due|submit|hand in)\b/i, tag: 'deadline' },
];

export function suggestTags(text, { context = {} } = {}) {
  const source = `${text || ''} ${context.projectName || ''}`.toLowerCase();
  const tags = new Set();

  for (const rule of TAG_RULES) {
    if (rule.match.test(source)) tags.add(rule.tag);
  }
  if (context.areaName) {
    tags.add(context.areaName.toLowerCase().replace(/\s*&\s*/g, '-').replace(/\s+/g, '-'));
  }
  // A distinctive noun from the title is often the most useful tag of all —
  // but a weekday or a month is not, so those are excluded before choosing.
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .split(/\s+/)
    .filter((word) => word.length > 4 && !FILLER.has(word) && !TEMPORAL.has(word));
  if (words.length) {
    const longest = words.reduce((best, word) => (word.length > best.length ? word : best));
    tags.add(longest);
  }

  return [...tags].filter(Boolean).slice(0, 5);
}

/* ------------------------------------------------------------------ *
 * Breakdowns
 * ------------------------------------------------------------------ */

export function suggestSteps(title, { kind = 'subtasks' } = {}) {
  const subject = tidy(stripPreamble(String(title || '')));
  if (!subject) return [];
  const lower = subject.toLowerCase();

  if (kind === 'milestones') {
    return [
      `Decide what "${lower}" actually means in practice`,
      'Reach the first visible result',
      'Reach the halfway point',
      `Finish and review ${lower}`,
    ];
  }
  if (kind === 'project-tasks') {
    return [
      `Define the scope of ${lower}`,
      'Gather what you need to start',
      'Do the first substantial piece',
      'Review it against the goal',
      'Finish and close it out',
    ];
  }
  return [
    `Work out the first step of ${lower}`,
    'Do the part you have been avoiding',
    'Check it and tidy up',
  ];
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

const GREETING = /^\s*(hi|hey|hello|yo|good (morning|afternoon|evening))\b/i;
const THANKS = /\b(thanks|thank you|cheers|ta)\b/i;

/** Anything phrased as a question is a question about TELOS, not a task. */
const INTERROGATIVE =
  /^\s*(how|what|what's|whats|where|why|when|which|who|can|could|should|does|do|did|is|are|was|will|would|am\s+i|tell\s+me|explain|show\s+me|help\s+me)\b/i;

const isQuestion = (text) => text.includes('?') || INTERROGATIVE.test(text);

/**
 * Does this read like something the person wants to *do*, rather than
 * something they want to know? "I need to email Sarah" is a task; "how do I
 * turn off email reminders" is a question — and the two share vocabulary, so
 * the distinction has to be made before the knowledge base is consulted.
 */
function looksLikeTask(text) {
  if (isQuestion(text)) return false;
  if (/^\s*(i\s+)?(need|want|have|got|must|should|ought)\s+to\s+/i.test(text)) return true;
  if (/^\s*(remember|remind me)\s+to\s+/i.test(text)) return true;
  if (/^\s*(todo|to-do|task)\s*[:-]/i.test(text)) return true;
  // A short imperative opening with a known action verb.
  return VERB_HINTS.some((hint) => hint.match.test(text)) && text.split(/\s+/).length <= 20;
}

/**
 * Answers a question in local mode. Returns the reply text plus the knowledge
 * entries it drew on, so the interface can show where an answer came from.
 */
export function localReply(message, { context = {}, plan = null } = {}) {
  const text = String(message || '').trim();
  if (!text) {
    return { reply: 'Ask me anything about TELOS, or paste a rough task and I will tidy the wording.', sources: [] };
  }

  if (GREETING.test(text) && text.length < 30) {
    return {
      reply:
        'Hello. I can help you word a task, suggest tags, break something into steps, or explain any setting in TELOS. What are you working on?',
      sources: [],
    };
  }
  if (THANKS.test(text) && text.length < 30) {
    return { reply: 'Any time.', sources: [] };
  }

  // Questions about the plan itself are answered from the database, so the
  // numbers and titles are the real ones rather than a model's recollection.
  if (plan) {
    const grounded = answerFromPlan(text, plan, { isQuestion: isQuestion(text) });
    if (grounded) return grounded;
  }

  const tidyWording = () => {
    const titles = suggestTitles(text, { context });
    if (!titles.length) return null;
    const tags = suggestTags(text, { context });
    return {
      reply: [
        'Here is how I would word that:',
        '',
        ...titles.map((title) => `- ${title}`),
        tags.length ? `\nTags worth using: ${tags.join(', ')}.` : '',
      ].join('\n').trim(),
      sources: [],
      suggestions: titles,
    };
  };

  // Something they want to do, rather than something they want to know.
  if (looksLikeTask(text)) {
    const worded = tidyWording();
    if (worded) return worded;
  }

  // Otherwise search the knowledge base, letting the strongest match win
  // whether it is a setting or a concept.
  const settings = rankSettings(text);
  const concepts = rankConcepts(text);
  const bestSetting = settings[0]?.points ?? 0;
  const bestConcept = concepts[0]?.points ?? 0;

  if (bestConcept > 0 && bestConcept >= bestSetting) {
    const lines = concepts.map((row) => `**${row.entry.term}**\n\n${row.entry.body}`);
    // A concept explains the idea; a setting says where to change it. When
    // both are relevant — "how do recurring items handle missed days?" — the
    // useful answer is both, not whichever scored higher.
    if (settings.length) {
      const s = settings[0].entry;
      lines.push(`**${s.name}** — ${s.path}\n\n${s.what} ${s.detail}`);
    }
    return {
      reply: lines.join('\n\n'),
      sources: [
        ...concepts.map((row) => row.entry.term),
        ...settings.slice(0, 1).map((row) => row.entry.name),
      ],
    };
  }

  if (bestSetting > 0) {
    const primary = settings[0].entry;
    const lines = [`**${primary.name}** — ${primary.path}`, '', primary.what, primary.detail];
    const others = settings.slice(1).map((row) => row.entry);
    if (others.length) {
      lines.push('', 'Related: ' + others.map((s) => `${s.name} (${s.path})`).join(', ') + '.');
    }
    return { reply: lines.join('\n'), sources: settings.map((row) => row.entry.name) };
  }

  // No knowledge match — if it could plausibly be a task, offer wording.
  if (!isQuestion(text)) {
    const worded = tidyWording();
    if (worded) return worded;
  }

  return {
    reply: [
      'I can help with wording, tags, breaking work into steps, and anything in Settings. On this server I answer from what TELOS itself defines, so I will not guess.',
      '',
      'Try asking:',
      '- "What is overdue?" or "What should I start with today?"',
      '- "How is the portfolio objective going?"',
      '- "How do I change my timezone?"',
      '- Or paste a rough task and I will tidy it up.',
      '',
      'For open-ended help — rewriting a description, naming an objective — turn on Claude in Settings → Assistant.',
    ].join('\n'),
    sources: [],
  };
}

export const conceptList = () => CONCEPTS.map((c) => c.term);
