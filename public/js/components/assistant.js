import api from '../api.js';
import { clear, el, trapFocus } from '../dom.js';
import { icon } from '../icons.js';
import { chip, notifyError, toast } from '../ui.js';
import { navigate, resolve } from '../router.js';
import { setUser, state } from '../store.js';

/**
 * The assistant panel.
 *
 * Replies arrive as plain text with a little light markup. Nothing is ever
 * assigned through innerHTML — the renderer below walks the text and builds
 * DOM nodes, so a reply is displayed as words no matter what it contains.
 */

/* ------------------------------------------------------------------ *
 * Minimal, safe rendering of **bold**, bullet lists and paragraphs
 * ------------------------------------------------------------------ */

function inline(text) {
  const nodes = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(document.createTextNode(text.slice(cursor, match.index)));
    nodes.push(el('strong', { text: match[1] }));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));
  return nodes;
}

export function renderReply(text) {
  const container = el('div');
  const blocks = String(text ?? '').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (!lines.length) continue;

    const bulletLines = lines.filter((line) => /^\s*[-*·]\s+/.test(line));
    if (bulletLines.length === lines.length) {
      container.append(
        el('ul', {}, lines.map((line) => el('li', {}, inline(line.replace(/^\s*[-*·]\s+/, '')))))
      );
      continue;
    }

    // Mixed block: leading prose, then any bullets beneath it.
    const prose = lines.filter((line) => !/^\s*[-*·]\s+/.test(line));
    if (prose.length) {
      const paragraph = el('p');
      prose.forEach((line, index) => {
        if (index) paragraph.append(el('br'));
        paragraph.append(...inline(line));
      });
      container.append(paragraph);
    }
    if (bulletLines.length) {
      container.append(
        el('ul', {}, bulletLines.map((line) => el('li', {}, inline(line.replace(/^\s*[-*·]\s+/, '')))))
      );
    }
  }
  return container;
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

let panel = null;

export function closeAssistant() {
  panel?.remove();
  panel = null;
}

export function isAssistantOpen() {
  return Boolean(panel);
}

export async function openAssistant({ seed = '' } = {}) {
  if (panel) {
    panel.querySelector('.assistant-input')?.focus();
    return;
  }

  let status;
  try {
    status = await api.get('/assistant/status');
  } catch (error) {
    notifyError(error);
    return;
  }

  if (status.mode === 'off') {
    toast('The assistant is turned off. Turn it on in Settings → Assistant.', {
      action: { label: 'Settings', onClick: () => navigate('/settings?section=assistant') },
      duration: 6000,
    });
    return;
  }

  /** The running conversation, sent back each turn so replies have context. */
  const turns = [];

  const body = el('div', { class: 'assistant-body' });
  const input = el('textarea', {
    class: 'assistant-input',
    rows: '1',
    placeholder: 'Ask about TELOS, or paste a rough task',
    'aria-label': 'Message the assistant',
    value: seed,
  });

  const send = el('button', {
    class: 'btn btn-primary btn-icon', type: 'submit', 'aria-label': 'Send',
    style: { width: '40px', height: '40px', flex: 'none' },
  }, [icon('arrowRight', { size: 17 })]);

  const modeChip = status.effectiveMode === 'claude'
    ? chip('Claude', { tone: 'accent' })
    : chip('On this server');

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    untrap();
    closeAssistant();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && !document.querySelector('.overlay')) {
      event.stopPropagation();
      close();
    }
  };

  panel = el('aside', {
    class: 'assistant', role: 'complementary', 'aria-label': 'Assistant',
  }, [
    el('div', { class: 'assistant-head' }, [
      el('div', { class: 'grow row gap-3' }, [
        icon('sparkle', { size: 18 }),
        el('h2', { text: 'Assistant' }),
        modeChip,
      ]),
      el('button', {
        class: 'btn-icon', type: 'button', 'aria-label': 'Assistant settings',
        onClick: () => { close(); navigate('/settings?section=assistant'); },
      }, [icon('settings', { size: 17 })]),
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Close assistant', onClick: close },
        [icon('close', { size: 18 })]),
    ]),
    body,
    el('div', { class: 'assistant-foot' }, [
      el('form', {
        class: 'assistant-form',
        onSubmit: (event) => {
          event.preventDefault();
          submit();
        },
      }, [input, send]),
      el('p', {
        class: 'micro subtle', style: { marginTop: '8px' },
        text: status.effectiveMode !== 'claude'
          ? 'Answered on this server from your own plan. Nothing you write leaves it.'
          : status.sharesPlanWithClaude
            ? 'Sends your message and a summary of your plan — titles, dates and progress — to Claude.'
            : 'Sends what you type, plus your area and project names, to Claude.',
      }),
    ]),
  ]);

  document.body.append(panel);
  const untrap = trapFocus(panel);
  document.addEventListener('keydown', onKey, true);

  /* --------------------------- Message flow --------------------------- */

  const addMessage = (who, content, { note = null } = {}) => {
    const wrap = el('div', { class: `msg ${who === 'you' ? 'msg-you' : 'msg-them'}` }, [
      el('div', { class: 'msg-bubble' }, [
        typeof content === 'string' ? renderReply(content) : content,
      ]),
      note ? el('span', { class: 'msg-note', text: note }) : null,
    ]);
    body.append(wrap);
    body.scrollTop = body.scrollHeight;
    return wrap;
  };

  const addChips = (prompts, onPick) => {
    const row = el('div', { class: 'assistant-chips' },
      prompts.map((prompt) =>
        el('button', {
          class: 'assistant-chip', type: 'button', text: prompt,
          onClick: () => { row.remove(); onPick(prompt); },
        })
      )
    );
    body.append(row);
    body.scrollTop = body.scrollHeight;
    return row;
  };

  /**
   * A proposal card. Nothing has happened yet: each action is listed with a
   * checkbox, and only what is still ticked when Apply is pressed is sent.
   */
  const addProposal = (actions) => {
    const chosen = new Set(actions.map((_, index) => index));

    const items = el('div', { class: 'proposal-list' },
      actions.map((action, index) =>
        el('label', { class: 'proposal-item' }, [
          el('input', {
            type: 'checkbox', checked: true,
            'aria-label': action.description,
            onChange: (event) => {
              if (event.target.checked) chosen.add(index);
              else chosen.delete(index);
              apply.disabled = chosen.size === 0;
              apply.textContent = chosen.size === actions.length
                ? 'Apply' : `Apply ${chosen.size}`;
            },
          }),
          el('span', {}, [
            el('span', { text: action.description }),
            action.reason ? el('span', { class: 'reason', text: action.reason }) : null,
          ]),
        ])
      )
    );

    const apply = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Apply' });
    const dismiss = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Dismiss' });
    const foot = el('div', { class: 'proposal-foot' }, [apply, dismiss, el('span', { class: 'grow' })]);

    const card = el('div', { class: 'proposal' }, [
      el('div', { class: 'proposal-head' }, [
        icon('check', { size: 14 }),
        el('span', { class: 'eyebrow grow', text: `${actions.length} proposed change${actions.length === 1 ? '' : 's'}` }),
      ]),
      items,
      foot,
    ]);

    dismiss.addEventListener('click', () => {
      card.remove();
      addMessage('them', 'Left as it was.');
    });

    apply.addEventListener('click', async () => {
      apply.disabled = true;
      dismiss.disabled = true;
      apply.textContent = 'Applying…';
      const selected = actions.filter((_, index) => chosen.has(index));
      try {
        const result = await api.post('/assistant/apply', { actions: selected });
        card.classList.add('applied');
        items.querySelectorAll('input').forEach((input) => { input.disabled = true; });
        clear(foot);
        foot.append(
          el('span', {
            class: 'micro grow',
            style: { color: 'var(--positive)' },
            text: `${result.count} applied${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}.`,
          })
        );

        const undoActions = (result.applied ?? []).map((entry) => entry.undo).filter(Boolean);
        const createdIds = (result.applied ?? []).filter((entry) => entry.created).map((entry) => entry.taskId);

        if (undoActions.length || createdIds.length) {
          foot.append(
            el('button', {
              class: 'btn btn-sm', type: 'button', text: 'Undo',
              onClick: async (event) => {
                // Captured now: `currentTarget` is null once an await resumes.
                const button = event.currentTarget;
                button.disabled = true;
                try {
                  if (undoActions.length) await api.post('/assistant/apply', { actions: undoActions });
                  for (const id of createdIds) await api.del(`/tasks/${id}`);
                  toast('Reverted.');
                  document.dispatchEvent(new CustomEvent('telos:tasks-changed', { detail: {} }));
                  resolve();
                  button.remove();
                } catch (error) {
                  button.disabled = false;
                  notifyError(error);
                }
              },
            })
          );
        }

        toast(result.count === 1 ? '1 change applied.' : `${result.count} changes applied.`);
        // The panel sits beside whatever the person was looking at, so redraw
        // it — a list still showing the old dates would be worse than useless.
        document.dispatchEvent(new CustomEvent('telos:tasks-changed', { detail: {} }));
        resolve();
      } catch (error) {
        apply.disabled = false;
        dismiss.disabled = false;
        apply.textContent = 'Apply';
        notifyError(error);
      }
    });

    body.append(card);
    body.scrollTop = body.scrollHeight;
  };

  let busy = false;

  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true;
    send.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    addMessage('you', text);
    turns.push({ role: 'user', content: text });

    const pending = addMessage('them',
      el('div', { class: 'assistant-thinking' }, [el('i'), el('i'), el('i')]));

    try {
      const result = await api.post('/assistant/chat', {
        messages: turns.slice(-12),
        context: currentContext(),
      });
      pending.remove();

      const note = [
        result.notice,
        result.degraded && !result.notice
          ? 'Claude is not configured on this server, so this was answered locally.'
          : null,
        result.sources?.length ? `From: ${result.sources.join(', ')}` : null,
      ].filter(Boolean).join(' · ');

      if (result.reply) {
        addMessage('them', result.reply, { note: note || null });
        turns.push({ role: 'assistant', content: result.reply });
      }

      if (result.actions?.length) addProposal(result.actions);

      if (result.suggestions?.length) {
        addChips(result.suggestions.map((s) => `Use: ${s}`), (picked) => {
          const value = picked.replace(/^Use: /, '');
          navigator.clipboard?.writeText(value).then(
            () => toast('Copied.'),
            () => toast('Could not copy — select the text instead.', { tone: 'danger' })
          );
        });
      }
    } catch (error) {
      pending.remove();
      addMessage('them', error.message || 'That did not work. Try again.');
    } finally {
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  const submit = () => ask(input.value.trim());

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  /* ------------------------------ Opening ----------------------------- */

  addMessage('them', [
    `Hello${state.user?.name ? `, ${state.user.name.split(' ')[0]}` : ''}. I can help you word a responsibility, suggest tags, break something into steps, or explain any setting in TELOS.`,
  ].join(''));
  addChips(status.prompts ?? [], (prompt) => ask(prompt));

  requestAnimationFrame(() => input.focus());
  if (seed.trim()) ask(seed.trim());
}

/** What the user is currently looking at, so suggestions can fit it. */
function currentContext() {
  const hash = window.location.hash;
  const projectMatch = hash.match(/#\/projects\/([^?/]+)/);
  const objectiveMatch = hash.match(/#\/objectives\/([^?/]+)/);
  return {
    projectId: projectMatch?.[1],
    objectiveId: objectiveMatch?.[1],
  };
}

/* ------------------------------------------------------------------ *
 * Inline suggestions, used inside the editors
 * ------------------------------------------------------------------ */

const KIND_LABEL = {
  title: 'Suggest titles',
  'project-name': 'Suggest names',
  'objective-title': 'Suggest titles',
  description: 'Suggest wording',
  tags: 'Suggest tags',
  subtasks: 'Suggest steps',
  milestones: 'Suggest milestones',
  'project-tasks': 'Suggest responsibilities',
};

/**
 * A small "Suggest" button that fetches options and offers them beneath the
 * field. `getInput` supplies the text to work from; `onPick` receives the
 * chosen option. Nothing is applied without the person choosing it.
 */
export function suggestButton({ kind, getInput, getContext = () => ({}), onPick, label }) {
  const list = el('div', { class: 'suggest-list' });
  let open = false;

  const button = el('button', {
    class: 'suggest-btn', type: 'button',
    'aria-label': KIND_LABEL[kind] || 'Suggest',
    onClick: async () => {
      if (open) {
        clear(list);
        open = false;
        return;
      }
      const input = String(getInput() || '').trim();
      if (!input) {
        toast('Write a few words first, then I can suggest alternatives.');
        return;
      }
      button.disabled = true;
      clear(list);
      list.append(el('span', { class: 'micro subtle', text: 'Thinking…' }));
      try {
        const result = await api.post('/assistant/suggest', {
          kind, input, context: getContext(),
        });
        clear(list);
        open = true;
        if (!result.suggestions?.length) {
          list.append(el('span', { class: 'micro subtle', text: 'No suggestions for that one.' }));
          return;
        }
        for (const suggestion of result.suggestions) {
          list.append(
            el('button', {
              class: 'suggest-option', type: 'button', text: suggestion,
              onClick: () => {
                onPick(suggestion);
                clear(list);
                open = false;
              },
            })
          );
        }
        if (result.notice) {
          list.append(el('span', { class: 'micro subtle', text: result.notice }));
        }
      } catch (error) {
        clear(list);
        if (error.status === 403) {
          list.append(el('span', { class: 'micro subtle', text: 'Turn the assistant on in Settings → Assistant.' }));
        } else {
          list.append(el('span', { class: 'micro subtle', text: error.message || 'Could not fetch suggestions.' }));
        }
      } finally {
        button.disabled = false;
      }
    },
  }, [icon('sparkle', { size: 12 }), el('span', { text: label || KIND_LABEL[kind] || 'Suggest' })]);

  return { button, list };
}

/** True when the account has the assistant available at all. */
export const assistantEnabled = () => (state.user?.assistantMode ?? 'local') !== 'off';

export async function setAssistantMode(mode) {
  const result = await api.patch('/account/me', { assistantMode: mode });
  setUser(result.user);
  return result.user;
}
