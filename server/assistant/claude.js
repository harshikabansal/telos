import Anthropic from '@anthropic-ai/sdk';
import config from '../config.js';
import { knowledgeDigest } from './knowledge.js';

/**
 * Claude adapter.
 *
 * The API key lives only in the server's environment — the browser never sees
 * it and never talks to Anthropic directly. Requests carry the specific text
 * the user asked about plus a short, factual description of their workspace
 * (area names, counts); never their whole account.
 */

const MODEL = process.env.TELOS_ASSISTANT_MODEL || 'claude-opus-5';

/** Server-side refusal fallback. Dropped automatically if the beta is unavailable. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbackSupported = true;

let client = null;

export function apiKey() {
  return process.env.TELOS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '';
}

export function isConfigured() {
  return Boolean(apiKey());
}

function getClient() {
  if (!client) {
    if (!isConfigured()) throw new Error('No Anthropic API key is configured on this server.');
    client = new Anthropic({ apiKey: apiKey(), maxRetries: 2 });
  }
  return client;
}

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

const VOICE = `You are the assistant inside TELOS, a private life-management app.

TELOS connects Purpose to Objectives to Milestones to Projects to Responsibilities to today's action. It calls tasks "responsibilities". It separates urgency (a deadline) from importance (consequence) from meaning (serves a long-term objective).

Your job is small and practical: help word things well, suggest tags, break work into steps, and answer questions about the app's settings and vocabulary.

How to answer:
- Be brief. Two or three sentences for most questions. No preamble, no restating the question, no closing offers of further help.
- When asked for options, give a short list and nothing else.
- Answer questions about settings only from the reference below. If it is not there, say you are not sure rather than guessing — you are describing a real app the person is using, and an invented setting wastes their time.
- Match the product's calm, plain register. No exclamation marks, no emoji, no motivational encouragement, no productivity-guru framing.
- Deliver what was asked, at the scope asked. Do not add advice about how they should organise their life.
- The person's notes are private and often personal. Treat what they share as working material, not something to comment on.`;

const PLAN_RULES = `
The section below is the person's real plan, read from the database moments ago. Use it directly.
- Every count and date there is already correct. Do not recount, re-derive or estimate.
- Never invent a responsibility, project, objective or date that is not listed.
- If they ask about something that is not there, say it is not in their plan rather than guessing.
- When they ask what to do, work from the order given rather than proposing a system for prioritising.`;

/**
 * The system prompt is split in two so the expensive half can be cached: the
 * voice and the knowledge base are byte-identical on every request and carry
 * the cache breakpoint, while the workspace and plan — which change with every
 * message — sit after it.
 */
function systemBlocks(workspace, plan) {
  const stable = [
    VOICE,
    '',
    'REFERENCE — the real settings and vocabulary of TELOS:',
    knowledgeDigest(),
  ].join('\n');

  const blocks = [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }];

  const volatile = [];
  if (workspace) volatile.push("THE PERSON'S WORKSPACE:", workspace);
  if (plan) volatile.push('', PLAN_RULES, '', "THE PERSON'S PLAN RIGHT NOW:", plan);
  if (volatile.length) blocks.push({ type: 'text', text: volatile.join('\n') });

  return blocks;
}

/**
 * A short, factual summary of the account — names of areas and objectives, and
 * counts. Enough for the model to suggest a fitting area or tag without
 * shipping the contents of anyone's notes.
 */
export function describeWorkspace({ areas = [], objectives = [], projects = [], openCount = 0 } = {}) {
  const lines = [];
  if (areas.length) lines.push(`Areas of life: ${areas.slice(0, 20).join(', ')}.`);
  if (objectives.length) lines.push(`Active objectives: ${objectives.slice(0, 10).join('; ')}.`);
  if (projects.length) lines.push(`Active projects: ${projects.slice(0, 12).join('; ')}.`);
  lines.push(`They currently hold ${openCount} open responsibilities.`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Request
 * ------------------------------------------------------------------ */

const textOf = (message) =>
  (message.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

export class AssistantError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * One request to Claude.
 *
 * Effort is deliberately low: these are short, scoped tasks where latency
 * matters more than depth. Thinking is left at its default rather than
 * disabled — on this model, disabling it costs more than the lower effort
 * setting saves.
 */
async function request({ system, messages, schema = null, maxTokens = 4096, effort = 'low' }) {
  const api = getClient();

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: schema
      ? { effort, format: { type: 'json_schema', schema } }
      : { effort },
  };

  let message;
  try {
    message = fallbackSupported
      ? await api.beta.messages.create({ ...body, betas: [FALLBACK_BETA], fallbacks: 'default' })
      : await api.messages.create(body);
  } catch (error) {
    // If this deployment cannot use the refusal-fallback beta, stop asking for
    // it and carry on — the feature is a safety net, not a requirement.
    if (fallbackSupported && error instanceof Anthropic.BadRequestError && /fallback|beta/i.test(error.message)) {
      fallbackSupported = false;
      message = await api.messages.create(body).catch((retryError) => {
        throw translate(retryError);
      });
    } else {
      throw translate(error);
    }
  }

  // Check why generation stopped before reading any content.
  if (message.stop_reason === 'refusal') {
    throw new AssistantError(
      'Claude declined to answer that one. Rephrasing usually helps, or switch the assistant to this server only.',
      { status: 422 }
    );
  }
  if (message.stop_reason === 'max_tokens') {
    const partial = textOf(message);
    if (partial) return partial;
    throw new AssistantError('That answer was too long to finish. Try asking for something narrower.', { status: 502 });
  }

  const text = textOf(message);
  if (!text) throw new AssistantError('Claude returned an empty response. Try again.', { status: 502 });
  return text;
}

function translate(error) {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AssistantError('The Anthropic API key on this server is not valid.', { status: 502 });
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AssistantError('This server\'s API key does not have access to the assistant model.', { status: 502 });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AssistantError('The assistant is rate limited just now. Try again shortly.', { status: 429, retryable: true });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AssistantError('Could not reach Claude. Check the server\'s connection.', { status: 503, retryable: true });
  }
  if (error instanceof Anthropic.APIError) {
    return new AssistantError('The assistant is unavailable right now.', { status: 502, retryable: true });
  }
  return new AssistantError('The assistant could not answer that.', { status: 502 });
}

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

export async function chat({ messages, workspace, plan = null }) {
  return request({
    system: systemBlocks(workspace, plan),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    // A grounded answer has more to weigh, so it gets a little more room.
    maxTokens: plan ? 6144 : 4096,
    effort: 'medium',
  });
}

/* ------------------------------------------------------------------ *
 * Chat that may propose actions
 * ------------------------------------------------------------------ */

/**
 * Actions are returned as data, not executed as tool calls. The model has no
 * ability to change anything: it describes what it would do, the server
 * validates every reference against this account, and the person applies it.
 */
const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'What to say to the person. If you are proposing actions, keep this to one short sentence — the actions are listed separately and they can read them.',
    },
    actions: {
      type: 'array',
      description: 'Actions to propose, or an empty array. Never propose something the person did not ask for.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'complete', 'uncomplete', 'reschedule', 'set_priority',
              'mark_important', 'unmark_important', 'create_task',
            ],
          },
          ref: {
            type: 'string',
            description: 'The reference in square brackets from the plan, such as T3. Empty string for create_task.',
          },
          title: { type: 'string', description: 'Title for create_task. Empty string otherwise.' },
          date: { type: 'string', description: 'YYYY-MM-DD, or empty string when the date is not changing.' },
          time: { type: 'string', description: 'HH:MM, or empty string.' },
          priority: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'urgent', ''],
            description: 'Only for set_priority or create_task; empty string otherwise.',
          },
          important: { type: 'boolean', description: 'Only meaningful for create_task.' },
          reason: { type: 'string', description: 'A few words on why, or an empty string.' },
        },
        required: ['type', 'ref', 'title', 'date', 'time', 'priority', 'important', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['reply', 'actions'],
  additionalProperties: false,
};

const ACTION_RULES = `
You may propose changes to the plan. You cannot make them: whatever you propose is shown to the person, and nothing happens until they press Apply.

- Propose only what was actually asked for. A question is not a request to change anything — answer it and propose nothing.
- Reference an existing responsibility by the bracketed reference from the plan, such as T3. Never invent one.
- Prefer the smallest set of actions that does the job. Do not tidy, reprioritise or reschedule things nobody mentioned.
- When something is ambiguous, ask in the reply and propose nothing.
- Keep the reply to one short sentence when you are proposing actions; the person reads the actions themselves.
- You cannot delete anything. If someone asks, say deletion is theirs to do directly.`;

export async function chatWithActions({ messages, workspace, plan }) {
  const blocks = systemBlocks(workspace, plan);
  blocks[blocks.length - 1].text += `\n${ACTION_RULES}`;

  const raw = await request({
    system: blocks,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    schema: ACTION_SCHEMA,
    maxTokens: 6144,
    effort: 'medium',
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AssistantError('The assistant returned something unreadable. Try again.', { status: 502 });
  }
  return {
    reply: String(parsed?.reply ?? '').trim(),
    actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
  };
}

/* ------------------------------------------------------------------ *
 * Structured suggestions
 * ------------------------------------------------------------------ */

const LIST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      description: 'The suggested strings, best first.',
      items: { type: 'string' },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};

const PROMPTS = {
  title: (input, ctx) =>
    `Suggest 4 alternative titles for this responsibility. Lead with a verb, keep each under about 8 words, and keep the person's own vocabulary where it is already good. Do not invent detail that is not there.\n\nWhat they wrote: "${input}"${ctx}`,

  'project-name': (input, ctx) =>
    `Suggest 4 names for this project. A project name should say what is being built or accomplished, not describe a single action.\n\nWhat they wrote: "${input}"${ctx}`,

  'objective-title': (input, ctx) =>
    `Suggest 4 titles for this objective. An objective is an outcome someone is moving toward, phrased as a result rather than an activity — "Become conversational in German", not "Practise German".\n\nWhat they wrote: "${input}"${ctx}`,

  description: (input, ctx) =>
    `Write 3 alternative short descriptions for this item, one or two sentences each. A good description says what "done" looks like or what the first step is. Do not repeat the title back.\n\nTitle: "${input}"${ctx}`,

  tags: (input, ctx) =>
    `Suggest up to 6 tags for this responsibility. Single lower-case words or hyphenated pairs, no punctuation, no "#". Prefer tags that would still group things usefully across hundreds of items.\n\nTitle: "${input}"${ctx}`,

  subtasks: (input, ctx) =>
    `Break this responsibility into 3 to 5 concrete steps, in order. Each step should be something a person could start straight away.\n\nTitle: "${input}"${ctx}`,

  milestones: (input, ctx) =>
    `Suggest 3 to 5 milestones for this objective, in order. A milestone is a meaningful marker on the way to an outcome, not a single task.\n\nObjective: "${input}"${ctx}`,

  'project-tasks': (input, ctx) =>
    `Suggest 5 to 7 responsibilities that would move this project forward, in a sensible order. Each should be a single concrete action.\n\nProject: "${input}"${ctx}`,
};

export const SUGGESTION_KINDS = Object.keys(PROMPTS);

export async function suggest({ kind, input, context = {}, workspace }) {
  const build = PROMPTS[kind];
  if (!build) throw new AssistantError(`Unknown suggestion kind: ${kind}`, { status: 400 });

  const bits = [];
  if (context.areaName) bits.push(`Area of life: ${context.areaName}.`);
  if (context.projectName) bits.push(`Part of the project "${context.projectName}".`);
  if (context.objectiveTitle) bits.push(`Serves the objective "${context.objectiveTitle}".`);
  if (context.dueDate) bits.push(`Due ${context.dueDate}.`);
  const ctx = bits.length ? `\n\nContext: ${bits.join(' ')}` : '';

  const raw = await request({
    system: systemBlocks(workspace, null),
    messages: [{ role: 'user', content: build(input, ctx) }],
    schema: LIST_SCHEMA,
    maxTokens: 2048,
    effort: 'low',
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AssistantError('The assistant returned something unreadable. Try again.', { status: 502 });
  }
  const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  return list
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * Quick Add — reading a sentence the pattern matcher could not
 * ------------------------------------------------------------------ */

/**
 * TELOS parses Quick Add with patterns, which is fast, free and right most of
 * the time. This is the fallback for the sentences it cannot read — "chase the
 * invoice again in a couple of weeks", "gym three times a week from Monday".
 *
 * The model only *reads*; it returns fields, and the server validates every
 * one of them and resolves names against the account's own rows before any of
 * it reaches a form.
 */
const QUICK_ADD_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'The responsibility itself, with the scheduling words removed. Keep the person\'s own wording.',
    },
    date: { type: 'string', description: 'YYYY-MM-DD, or an empty string if no date was given.' },
    time: { type: 'string', description: 'HH:MM in 24-hour form, or an empty string.' },
    priority: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'urgent', ''],
      description: 'Only when stated or clearly implied. Empty string otherwise.',
    },
    important: { type: 'boolean', description: 'True only if they said it matters, not merely that it is urgent.' },
    recurrence: {
      type: 'object',
      description: 'How it repeats. freq is an empty string when it does not.',
      properties: {
        freq: {
          type: 'string',
          enum: ['', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly', 'monthly_date', 'quarterly', 'yearly', 'custom'],
        },
        weekdays: {
          type: 'array',
          description: 'For weekly or biweekly: 0 is Sunday through 6 is Saturday. Empty otherwise.',
          items: { type: 'integer' },
        },
        day: { type: 'integer', description: 'For monthly_date: the day of the month. 0 otherwise.' },
        every: { type: 'integer', description: 'For custom: the interval. 0 otherwise.' },
        unit: { type: 'string', enum: ['', 'day', 'week', 'month', 'year'] },
      },
      required: ['freq', 'weekdays', 'day', 'every', 'unit'],
      additionalProperties: false,
    },
    area: { type: 'string', description: 'The name of one of their areas of life, or an empty string.' },
    project: { type: 'string', description: 'The name of one of their projects, or an empty string.' },
    tags: { type: 'array', description: 'At most three short lower-case tags.', items: { type: 'string' } },
    estimatedMinutes: { type: 'integer', description: 'Only if a duration was stated. 0 otherwise.' },
    reminder: {
      type: 'string',
      enum: ['', 'at_time', '5m', '15m', '30m', '1h', '2h', '1d', '2d', '1w'],
      description: 'Only if they asked to be reminded.',
    },
    note: {
      type: 'string',
      description: 'One short clause naming anything you had to guess, or an empty string if it was unambiguous.',
    },
  },
  required: [
    'title', 'date', 'time', 'priority', 'important', 'recurrence',
    'area', 'project', 'tags', 'estimatedMinutes', 'reminder', 'note',
  ],
  additionalProperties: false,
};

export async function parseQuickAdd({ text, workspace, today, weekday, timezone }) {
  const instructions = [
    'Read this sentence as a single responsibility someone is adding to their planner, and return its fields.',
    '',
    `Today is ${weekday} ${today} in ${timezone}. Resolve every relative date against that, and return absolute dates.`,
    '',
    'Rules:',
    '- Take out the scheduling words from the title. "Chase the invoice again in a couple of weeks" has the title "Chase the invoice again".',
    '- Do not invent a date, a priority or a project that is not there. An empty string is the right answer when something was not said.',
    '- Match an area or project only to one that exists in their workspace, by its exact name. If nothing matches, leave it empty.',
    '- "A couple of weeks" is 14 days; "a few days" is 3. Prefer the plain reading over a clever one.',
    '- If the sentence describes something that repeats, fill in recurrence and set the date to the first occurrence.',
    '',
    `The sentence: "${text}"`,
  ].join('\n');

  const raw = await request({
    system: systemBlocks(workspace, null),
    messages: [{ role: 'user', content: instructions }],
    schema: QUICK_ADD_SCHEMA,
    maxTokens: 2048,
    effort: 'low',
  });

  try {
    return JSON.parse(raw);
  } catch {
    throw new AssistantError('The assistant could not read that one. Try the full editor.', { status: 502 });
  }
}

export const model = () => MODEL;
