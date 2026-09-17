import api from '../api.js';
import { clear, debounce, el } from '../dom.js';
import { icon } from '../icons.js';
import { modal, notifyError, toast } from '../ui.js';
import { looksUnread, parseQuickAdd, recurrenceLabel } from '../quickparse.js';
import { formatTime, relativeDate } from '../dates.js';
import { areaById, loadReference, projectById, state } from '../store.js';
import { openTaskEditor } from './taskEditor.js';

const TOKEN_ICON = {
  date: 'calendar', time: 'clock', priority: 'flag', important: 'important',
  recurrence: 'recurring', area: 'circle', project: 'projects', objective: 'objectives',
  tag: 'tasks', duration: 'clock', reminder: 'bell',
};

const REMINDER_LABEL = {
  at_time: 'At the due time', '5m': '5 min before', '15m': '15 min before',
  '30m': '30 min before', '1h': '1 hour before', '2h': '2 hours before',
  '1d': '1 day before', '2d': '2 days before', '1w': '1 week before',
};

const PRIORITY_LABEL = { low: 'Low priority', medium: 'Medium priority', high: 'High priority', urgent: 'Urgent' };

/**
 * A reading of the sentence, whichever produced it. Rendering both the pattern
 * matcher's result and Claude's through one function keeps the chips honest:
 * the person sees the same thing described the same way either way.
 */
function describeDraft(draft) {
  const chips = [];
  const add = (type, label) => label && chips.push({ type, label });

  if (draft.dueDate) add('date', relativeDate(draft.dueDate));
  if (draft.dueTime) add('time', formatTime(draft.dueTime));
  if (draft.recurrence) add('recurrence', recurrenceLabel(draft.recurrence));
  if (draft.priority) add('priority', PRIORITY_LABEL[draft.priority] ?? draft.priority);
  if (draft.important) add('important', 'Important');
  if (draft.areaId) add('area', areaById(draft.areaId)?.name);
  if (draft.projectId) add('project', projectById(draft.projectId)?.name);
  if (draft.estimatedMinutes) add('duration', `${draft.estimatedMinutes} min`);
  if (draft.reminder && draft.reminder !== 'none') add('reminder', REMINDER_LABEL[draft.reminder] ?? 'Reminder');
  for (const tag of draft.tags ?? []) add('tag', `#${tag}`);

  return chips;
}

/** Claude's reading fills the gaps; anything it left empty keeps the local value. */
function mergeDraft(local, remote) {
  if (!remote) return local;
  return {
    ...local,
    title: remote.title || local.title,
    dueDate: remote.dueDate ?? local.dueDate,
    dueTime: remote.dueTime ?? local.dueTime,
    priority: remote.priority ?? local.priority,
    important: remote.important || local.important,
    recurrence: remote.recurrence ?? local.recurrence,
    areaId: remote.areaId ?? local.areaId,
    projectId: remote.projectId ?? local.projectId,
    estimatedMinutes: remote.estimatedMinutes ?? local.estimatedMinutes,
    reminder: remote.reminder ?? local.reminder,
    tags: remote.tags?.length ? remote.tags : local.tags,
  };
}

/**
 * Quick Add. The parser's reading of the sentence is shown as chips before
 * anything is created, and the full editor is one click away for whatever it
 * did not catch. When the patterns clearly missed something and Claude is
 * available, it reads the sentence instead — still only as a proposal on
 * screen, never as a task created behind the person's back.
 */
export async function openQuickAdd({ onSaved, initial = '', defaults = {} } = {}) {
  await loadReference().catch(() => {});

  let status = { effectiveMode: 'local' };
  try {
    status = await api.get('/assistant/status');
  } catch { /* Quick Add works without the assistant */ }
  const claudeAvailable = status.effectiveMode === 'claude';

  const input = el('input', {
    class: 'quickadd-input',
    placeholder: 'What needs your attention?',
    value: initial,
    maxlength: '400',
    'aria-label': 'Quick add',
    dataset: { autofocus: '' },
    autocomplete: 'off',
    spellcheck: 'true',
  });

  const chips = el('div', { class: 'quickadd-parse' });
  const hint = el('p', {
    class: 'hint',
    text: 'Try: "Submit assignment tomorrow at 6 PM, high priority" or "Review finances every Sunday at 10 AM".',
  });

  let local = parseQuickAdd(initial);
  let remote = null;
  let remoteNote = '';
  let readBy = 'patterns';
  let asking = false;
  let lastAsked = '';

  const current = () => mergeDraft(local, remote);

  const readButton = el('button', {
    class: 'suggest-btn', type: 'button',
    onClick: () => askClaude(input.value.trim(), { force: true }),
  }, [icon('sparkle', { size: 12 }), el('span', { text: 'Read with Claude' })]);

  const renderChips = () => {
    clear(chips);
    const draft = current();
    const described = describeDraft(draft);

    if (asking) {
      chips.append(el('span', { class: 'micro subtle', text: 'Reading the sentence…' }));
      return;
    }

    if (!described.length) {
      chips.append(
        el('span', {
          class: 'micro subtle',
          text: 'Add a date, time, priority or #area and TELOS will read it.',
        })
      );
    }

    for (const chip of described) {
      chips.append(
        el('span', { class: 'parse-chip' }, [
          icon(TOKEN_ICON[chip.type] || 'circle', { size: 11 }),
          el('span', { text: chip.label }),
        ])
      );
    }

    if (readBy === 'claude') {
      chips.append(
        el('span', { class: 'micro subtle', style: { width: '100%' } }, [
          el('span', { text: remoteNote ? `Read by Claude — ${remoteNote}` : 'Read by Claude.' }),
        ])
      );
    } else if (claudeAvailable && input.value.trim().length >= 12) {
      chips.append(readButton);
    }
  };

  /** Asks Claude to read the sentence. Never creates anything. */
  async function askClaude(text, { force = false } = {}) {
    if (!claudeAvailable || asking) return;
    if (!text || text.length < 12) return;
    if (!force && text === lastAsked) return;
    lastAsked = text;
    asking = true;
    renderChips();

    try {
      const result = await api.post('/assistant/parse', { text });
      // A slower reply must not overwrite a sentence the person has since changed.
      if (input.value.trim() !== text) return;
      if (result.draft) {
        remote = result.draft;
        remoteNote = result.note || '';
        readBy = 'claude';
      } else if (force && result.notice) {
        toast(result.notice, { duration: 5000 });
      }
    } catch (error) {
      if (force) notifyError(error);
    } finally {
      asking = false;
      renderChips();
    }
  }

  // Only fires when the patterns clearly left scheduling language unread —
  // one call per settled sentence, not one per keystroke.
  const maybeAsk = debounce((text) => {
    if (claudeAvailable && looksUnread(text, local)) askClaude(text);
  }, 750);

  input.addEventListener('input', () => {
    const text = input.value.trim();
    local = parseQuickAdd(input.value);
    // The patterns are authoritative again the moment the sentence changes.
    remote = null;
    remoteNote = '';
    readBy = 'patterns';
    renderChips();
    maybeAsk(text);
  });

  renderChips();

  const draftFor = () => {
    const draft = current();
    return {
      title: draft.title,
      dueDate: draft.dueDate,
      dueTime: draft.dueTime,
      priority: draft.priority ?? undefined,
      important: draft.important || undefined,
      recurrence: draft.recurrence,
      areaId: draft.areaId ?? defaults.areaId ?? null,
      projectId: draft.projectId ?? defaults.projectId ?? null,
      objectiveId: draft.objectiveId ?? defaults.objectiveId ?? null,
      milestoneId: defaults.milestoneId ?? null,
      tags: draft.tags ?? [],
      estimatedMinutes: draft.estimatedMinutes ?? undefined,
      reminder: draft.reminder ?? undefined,
    };
  };

  const submit = async (close) => {
    const value = input.value.trim();
    if (!value) return;
    maybeAsk.cancel();

    const payload = draftFor();
    if (!payload.title) {
      toast('Give this responsibility a name.', { tone: 'danger' });
      return;
    }
    try {
      await api.post('/tasks', payload);
      toast(payload.dueDate ? `Added for ${relativeDate(payload.dueDate).toLowerCase()}.` : 'Added.');
      close();
      document.dispatchEvent(new CustomEvent('telos:tasks-changed', { detail: {} }));
      onSaved?.();
    } catch (error) {
      notifyError(error);
    }
  };

  const instance = modal({
    title: 'Quick add',
    subtitle: 'Write it the way you would say it.',
    size: 'modal-lg',
    body: el('div', { class: 'stack' }, [
      el('div', { style: { margin: '0 -20px' } }, [input, chips]),
      hint,
    ]),
    footer: (close) => [
      el('button', {
        class: 'btn btn-ghost', type: 'button',
        onClick: () => {
          const payload = draftFor();
          maybeAsk.cancel();
          close();
          openTaskEditor({ draft: payload, onSaved });
        },
      }, [icon('edit', { size: 15 }), el('span', { text: 'More options' })]),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Add', onClick: () => submit(close) }),
    ],
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit(instance.close);
    }
  });

  if (initial.trim()) maybeAsk(initial.trim());
  return instance;
}

export default openQuickAdd;
