import express from 'express';
import db from '../db.js';
import { HttpError, rateLimit, wrap } from '../middleware.js';
import {
  PRIORITIES, REMINDER_OFFSETS,
  dateOnly, ensureObject, enumValue, int, recurrence, str, stringArray, timeOnly,
} from '../validate.js';
import { todayFor } from '../domain.js';
import * as claude from '../assistant/claude.js';
import {
  localReply, suggestDescriptions, suggestSteps, suggestTags, suggestTitles,
} from '../assistant/local.js';
import { buildPlanDigest, renderPlanForPrompt } from '../assistant/plan.js';
import { applyActions, buildProposals, proposeLocally } from '../assistant/actions.js';

const router = express.Router();

/**
 * The assistant.
 *
 * Three modes, chosen per account:
 *   off    — the assistant is not available at all.
 *   local  — answered on this server from the product's own definitions.
 *            Nothing leaves the machine TELOS runs on. This is the default.
 *   claude — richer wording and open-ended help, via the Claude API.
 *
 * Claude mode is opt-in and cannot be reached by accident: the mode is stored
 * on the account, checked here on every request, and the API key exists only
 * in the server's environment. The browser never holds a key and never calls
 * Anthropic directly.
 */

/* Assistant calls cost money and take time, so they are throttled well below
 * the general API allowance. */
const chatLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 120,
  key: 'assistant-chat',
  message: 'The assistant has handled a lot of requests from here in the last hour. Try again shortly.',
});
const suggestLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 200,
  key: 'assistant-suggest',
  message: 'That is a lot of suggestions in one hour. Try again shortly.',
});

const modeFor = (user) => user.assistant_mode || 'local';

function requireEnabled(user) {
  const mode = modeFor(user);
  if (mode === 'off') {
    throw new HttpError(403, 'The assistant is turned off for this account. Turn it on in Settings → Assistant.');
  }
  if (mode === 'claude' && !claude.isConfigured()) {
    // The account asked for Claude but the server has no key — fall back to
    // local rather than failing, and say so in the response.
    return 'local';
  }
  return mode;
}

/**
 * A short, factual description of the account, assembled server-side from the
 * signed-in user's own rows. Names and counts only — never the contents of a
 * note, a description, or anything the person has written at length.
 */
function workspaceFor(userId) {
  const areas = db
    .prepare(`SELECT name FROM areas WHERE user_id = ? AND archived = 0 ORDER BY position LIMIT 20`)
    .all(userId)
    .map((row) => row.name);
  const objectives = db
    .prepare(`SELECT title FROM objectives WHERE user_id = ? AND status = 'active' ORDER BY position LIMIT 10`)
    .all(userId)
    .map((row) => row.title);
  const projects = db
    .prepare(`SELECT name FROM projects WHERE user_id = ? AND status IN ('active','planning') ORDER BY position LIMIT 12`)
    .all(userId)
    .map((row) => row.name);
  const openCount = db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status IN ('not_started','in_progress')`)
    .get(userId).n;

  return { areas, objectives, projects, openCount };
}

/** Resolves the display names behind the ids the client sends as context. */
function resolveContext(body, userId) {
  const context = {};
  const ctx = body.context && typeof body.context === 'object' ? body.context : {};

  if (ctx.areaId) {
    const area = db.prepare(`SELECT name FROM areas WHERE id = ? AND user_id = ?`).get(String(ctx.areaId), userId);
    if (area) context.areaName = area.name;
  }
  if (ctx.projectId) {
    const project = db.prepare(`SELECT name FROM projects WHERE id = ? AND user_id = ?`).get(String(ctx.projectId), userId);
    if (project) context.projectName = project.name;
  }
  if (ctx.objectiveId) {
    const objective = db.prepare(`SELECT title FROM objectives WHERE id = ? AND user_id = ?`).get(String(ctx.objectiveId), userId);
    if (objective) context.objectiveTitle = objective.title;
  }
  if (ctx.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(String(ctx.dueDate))) {
    context.dueDate = String(ctx.dueDate);
  }
  return context;
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

router.get('/status', (req, res) => {
  const mode = modeFor(req.user);
  const effectiveMode = mode === 'claude' && !claude.isConfigured() ? 'local' : mode;
  res.json({
    mode,
    effectiveMode,
    claudeAvailable: claude.isConfigured(),
    // Reading the plan is free and private in local mode — the data never
    // leaves the server. Sending it to Claude is a separate, explicit choice.
    sharePlan: Boolean(req.user.assistant_share_plan),
    sharesPlanWithClaude: effectiveMode === 'claude' && Boolean(req.user.assistant_share_plan),
    // Proposing is separate again: even with it on, nothing changes until the
    // person applies a proposal.
    mayAct: Boolean(req.user.assistant_may_act),
    model: claude.isConfigured() ? claude.model() : null,
    prompts: [
      'What should I start with today?',
      'What is overdue?',
      'How are my objectives going?',
      'What is the difference between important and urgent?',
    ],
  });
});

/* ------------------------------------------------------------------ *
 * Chat
 * ------------------------------------------------------------------ */

const MAX_TURNS = 20;

router.post(
  '/chat',
  chatLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const mode = requireEnabled(req.user);

    const rawTurns = Array.isArray(body.messages) ? body.messages : [];
    if (!rawTurns.length) throw new HttpError(400, 'Send at least one message.');
    if (rawTurns.length > MAX_TURNS) throw new HttpError(400, 'That conversation is too long. Start a new one.');

    const messages = rawTurns.map((turn) => ({
      role: enumValue(turn?.role, ['user', 'assistant'], 'Message role'),
      content: str(turn?.content, 'Message', { min: 1, max: 4000, required: true }),
    }));
    if (messages[messages.length - 1].role !== 'user') {
      throw new HttpError(400, 'The last message must be yours.');
    }

    const context = resolveContext(body, req.user.id);
    const latest = messages[messages.length - 1].content;

    // The digest is read from this account's own rows. In local mode it never
    // leaves the server, so it is always available; sending it to Claude is a
    // separate permission, checked here rather than trusted from the client.
    const plan = buildPlanDigest(req.user);
    const mayAct = Boolean(req.user.assistant_may_act);

    const localAnswer = () => {
      // A request to change something is answered with a proposal, never with
      // a change. Everything else falls through to the ordinary responder.
      if (mayAct) {
        const proposed = proposeLocally(latest, plan, req.user);
        if (proposed) {
          return {
            reply: proposed.reply,
            sources: [],
            suggestions: [],
            actions: buildProposals(proposed.actions, { user: req.user, digest: plan }),
          };
        }
      }
      const result = localReply(latest, { context, plan });
      return {
        reply: result.reply,
        sources: result.sources ?? [],
        suggestions: result.suggestions ?? [],
        actions: [],
      };
    };

    if (mode === 'local') {
      return res.json({
        ...localAnswer(),
        mode: 'local',
        grounded: true,
        degraded: modeFor(req.user) === 'claude',
      });
    }

    const mayShare = Boolean(req.user.assistant_share_plan);
    try {
      const workspace = claude.describeWorkspace(workspaceFor(req.user.id));
      const planText = mayShare ? renderPlanForPrompt(plan) : null;

      // Proposing requires the plan: an action can only reference something
      // the assistant can actually see.
      if (mayAct && planText) {
        const result = await claude.chatWithActions({ messages, workspace, plan: planText });
        return res.json({
          reply: result.reply,
          mode: 'claude',
          sources: [],
          grounded: true,
          actions: buildProposals(result.actions, { user: req.user, digest: plan }),
        });
      }

      const reply = await claude.chat({ messages, workspace, plan: planText });
      return res.json({ reply, mode: 'claude', sources: [], grounded: mayShare, actions: [] });
    } catch (error) {
      if (error instanceof claude.AssistantError) {
        // Rather than leaving the person with nothing, answer locally and say
        // plainly that the richer mode was unavailable.
        return res.status(200).json({
          ...localAnswer(),
          mode: 'local',
          grounded: true,
          notice: error.message,
        });
      }
      throw error;
    }
  })
);

/* ------------------------------------------------------------------ *
 * Quick Add fallback
 * ------------------------------------------------------------------ */

const parseLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 150,
  key: 'assistant-parse',
  message: 'That is a lot of Quick Add interpretations in one hour. Try again shortly.',
});

/** Matches a name the model returned to one of this account's own records. */
function resolveByName(table, column, name, userId) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  const rows = db.prepare(`SELECT id, ${column} AS label FROM ${table} WHERE user_id = ?`).all(userId);
  return (
    rows.find((row) => row.label.toLowerCase() === wanted) ??
    rows.find((row) => row.label.toLowerCase().startsWith(wanted)) ??
    rows.find((row) => wanted.includes(row.label.toLowerCase())) ??
    null
  )?.id ?? null;
}

router.post(
  '/parse',
  parseLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const mode = requireEnabled(req.user);
    const text = str(body.text, 'Text', { min: 1, max: 500, required: true });

    // The pattern matcher in the browser *is* the on-server reading. There is
    // nothing better to fall back to without Claude, so say so plainly rather
    // than returning a worse answer dressed as a better one.
    if (mode !== 'claude') {
      return res.json({
        draft: null,
        mode: 'local',
        notice: claude.isConfigured()
          ? 'Turn on Claude in Settings → Assistant to have it read sentences TELOS cannot parse.'
          : 'No Anthropic API key is configured on this server, so TELOS can only use its own pattern matching here.',
      });
    }

    const today = todayFor(req.user.timezone);
    const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' })
      .format(new Date(`${today}T12:00:00Z`));

    let raw;
    try {
      raw = await claude.parseQuickAdd({
        text,
        workspace: claude.describeWorkspace(workspaceFor(req.user.id)),
        today,
        weekday,
        timezone: req.user.timezone,
      });
    } catch (error) {
      if (error instanceof claude.AssistantError) {
        return res.json({ draft: null, mode: 'local', notice: error.message });
      }
      throw error;
    }

    // Everything below is validated as though it came from a hostile client.
    // A field that does not survive validation is dropped, not guessed at.
    const draft = { title: str(raw.title, 'Title', { max: 200 }) || text.slice(0, 200) };
    const keep = (fn) => {
      try {
        return fn();
      } catch {
        return null;
      }
    };

    draft.dueDate = keep(() => dateOnly(raw.date, 'Date'));
    draft.dueTime = keep(() => timeOnly(raw.time, 'Time'));
    draft.priority = keep(() => (raw.priority ? enumValue(raw.priority, PRIORITIES, 'Priority') : null));
    draft.important = Boolean(raw.important);
    draft.reminder = keep(() => (raw.reminder ? enumValue(raw.reminder, REMINDER_OFFSETS, 'Reminder') : null));
    draft.tags = keep(() => stringArray(raw.tags, 'Tags')) ?? [];
    draft.estimatedMinutes = keep(() =>
      raw.estimatedMinutes > 0 ? int(raw.estimatedMinutes, 'Duration', { min: 1, max: 100000 }) : null
    );

    const rule = raw.recurrence;
    draft.recurrence = rule?.freq
      ? keep(() =>
          recurrence(
            {
              freq: rule.freq,
              weekdays: Array.isArray(rule.weekdays) ? rule.weekdays : undefined,
              day: rule.day || undefined,
              every: rule.every || undefined,
              unit: rule.unit || undefined,
            },
            'Recurrence'
          )
        )
      : null;

    // Names are matched against this account's rows; an id is never taken from
    // the model.
    draft.areaId = resolveByName('areas', 'name', raw.area, req.user.id);
    draft.projectId = resolveByName('projects', 'name', raw.project, req.user.id);

    res.json({
      draft,
      mode: 'claude',
      note: str(raw.note, 'Note', { max: 200 }) || '',
    });
  })
);

/* ------------------------------------------------------------------ *
 * Applying confirmed actions
 * ------------------------------------------------------------------ */

router.post(
  '/apply',
  rateLimit({ windowMs: 60 * 60_000, max: 120, key: 'assistant-apply' }),
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    requireEnabled(req.user);

    if (!req.user.assistant_may_act) {
      throw new HttpError(403, 'The assistant is not allowed to make changes. Turn that on in Settings → Assistant.');
    }

    // Every action is re-validated and re-checked for ownership here. What the
    // browser sends is treated as untrusted, whatever was proposed earlier.
    const { applied, skipped } = applyActions(body.actions, { user: req.user });

    res.json({
      applied: applied.map((entry) => ({
        type: entry.type,
        taskId: entry.taskId,
        recurredTo: entry.recurredTo ?? null,
        created: Boolean(entry.created),
        undo: entry.undo ?? null,
      })),
      skipped,
      count: applied.length,
    });
  })
);

/* ------------------------------------------------------------------ *
 * Suggestions
 * ------------------------------------------------------------------ */

const KINDS = [
  'title', 'project-name', 'objective-title', 'description',
  'tags', 'subtasks', 'milestones', 'project-tasks',
];

/** What the local responder does for each kind, when Claude is not in play. */
function localSuggestions(kind, input, context) {
  switch (kind) {
    case 'title':
    case 'project-name':
    case 'objective-title':
      return suggestTitles(input, { context });
    case 'description':
      return suggestDescriptions(input, { context });
    case 'tags':
      return suggestTags(input, { context });
    case 'subtasks':
      return suggestSteps(input, { kind: 'subtasks' });
    case 'milestones':
      return suggestSteps(input, { kind: 'milestones' });
    case 'project-tasks':
      return suggestSteps(input, { kind: 'project-tasks' });
    default:
      return [];
  }
}

router.post(
  '/suggest',
  suggestLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const mode = requireEnabled(req.user);
    const kind = enumValue(body.kind, KINDS, 'Suggestion kind');
    const input = str(body.input, 'Text', { min: 1, max: 2000, required: true });
    const context = resolveContext(body, req.user.id);

    if (mode === 'local') {
      return res.json({
        suggestions: localSuggestions(kind, input, context),
        mode: 'local',
        degraded: modeFor(req.user) === 'claude',
      });
    }

    try {
      const suggestions = await claude.suggest({
        kind,
        input,
        context,
        workspace: claude.describeWorkspace(workspaceFor(req.user.id)),
      });
      return res.json({ suggestions, mode: 'claude' });
    } catch (error) {
      if (error instanceof claude.AssistantError) {
        return res.json({
          suggestions: localSuggestions(kind, input, context),
          mode: 'local',
          notice: error.message,
        });
      }
      throw error;
    }
  })
);

export default router;
