import api, { downloadExport } from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import {
  chip, confirmDialog, empty, field, menu, modal, notifyError, segmented, select, switchRow, toast,
} from '../ui.js';
import { formatDateTime, timeAgo } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { applyAppearance, invalidateReference, loadReference, setUser, state } from '../store.js';
import { page } from '../shell.js';
import { signOut } from '../shell.js';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'planning', label: 'Planning' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'areas', label: 'Areas of Life' },
  { id: 'privacy', label: 'Privacy & Security' },
  { id: 'data', label: 'Data' },
  { id: 'about', label: 'About' },
];

const AREA_ICONS = [
  'book', 'briefcase', 'coins', 'user', 'heart', 'activity', 'compass', 'lightbulb',
  'sparkle', 'home', 'palette', 'calendar', 'circle', 'target', 'leaf', 'globe',
];
const AREA_COLORS = ['slate', 'clay', 'moss', 'indigo', 'amber', 'rose', 'teal', 'violet', 'sand', 'ocean'];

const TIMEZONES = (() => {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone');
    if (supported?.length) return supported;
  } catch { /* fall through */ }
  return ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
})();

/** Persists a preference and re-applies appearance immediately. */
async function savePreference(patch, message) {
  try {
    const result = await api.patch('/account/me', patch);
    setUser(result.user);
    applyAppearance(result.user);
    if (message) toast(message);
    return result.user;
  } catch (error) {
    notifyError(error);
    return null;
  }
}

const sectionCard = (title, description, children) =>
  el('section', { class: 'card', style: { marginBottom: '24px' } }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack' }, [
        el('h3', { text: title, style: { fontSize: '1.0625rem' } }),
        description ? el('p', { class: 'hint', text: description }) : null,
      ]),
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);

const controlRow = (label, description, control) =>
  el('div', { class: 'setting-row' }, [
    el('div', { class: 'setting-copy' }, [
      el('span', { class: 'label', text: label }),
      description ? el('p', { class: 'hint', text: description }) : null,
    ]),
    el('div', { class: 'setting-control' }, [control]),
  ]);

/* ------------------------------------------------------------------ *
 * Appearance
 * ------------------------------------------------------------------ */

function appearanceSection() {
  return sectionCard('Appearance', 'How TELOS looks on this account, everywhere you sign in.', [
    controlRow('Theme', 'Follow your device, or choose one.',
      segmented(
        [
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
          { value: 'system', label: 'System', icon: 'monitor' },
        ],
        { value: state.user.theme, ariaLabel: 'Theme', onChange: (v) => savePreference({ theme: v }).then(() => navigate('/settings?section=appearance', { replace: true })) }
      )
    ),
    controlRow('Accent', 'A single restrained accent runs through the interface.',
      el('div', { class: 'row gap-2' },
        ['clay', 'moss', 'indigo', 'amber', 'slate'].map((accent) =>
          el('button', {
            class: 'btn-icon sm',
            type: 'button',
            'aria-label': accent,
            'aria-pressed': String(state.user.accent === accent),
            style: {
              border: state.user.accent === accent ? '2px solid var(--ink)' : '1px solid var(--line-strong)',
              borderRadius: '50%',
              background: {
                clay: '#a6553c', moss: '#4e6b52', indigo: '#4a5b8c', amber: '#9b6f2c', slate: '#4c5560',
              }[accent],
              width: '24px', height: '24px',
            },
            onClick: () => savePreference({ accent }).then(() => navigate('/settings?section=appearance', { replace: true })),
          })
        )
      )
    ),
    controlRow('Density', 'Compact tightens spacing across every view.',
      segmented(
        [{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }],
        { value: state.user.density, ariaLabel: 'Density', onChange: (v) => savePreference({ density: v }).then(() => navigate('/settings?section=appearance', { replace: true })) }
      )
    ),
  ]);
}

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

function planningSection() {
  return sectionCard('Planning preferences', 'The defaults TELOS uses when you add something new.', [
    controlRow('Default priority', 'Applied to anything created without a stated priority.',
      select(
        [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }],
        { value: state.user.defaultPriority, ariaLabel: 'Default priority', onChange: (v) => savePreference({ defaultPriority: v }, 'Default priority updated.') }
      )
    ),
    controlRow('Default duration', 'The estimate applied to a new responsibility, in minutes.',
      el('input', {
        class: 'input', type: 'number', min: '0', max: '1440', step: '5',
        value: String(state.user.defaultDuration),
        style: { maxWidth: '120px' },
        onChange: (e) => savePreference({ defaultDuration: Number(e.target.value) }, 'Default duration updated.'),
      })
    ),
    controlRow('Default reminder', 'TELOS will never send more than you ask for.',
      select(
        [
          { value: 'none', label: 'No reminder' }, { value: 'at_time', label: 'At the due time' },
          { value: '15m', label: '15 minutes before' }, { value: '30m', label: '30 minutes before' },
          { value: '1h', label: '1 hour before' }, { value: '1d', label: '1 day before' },
        ],
        { value: state.user.defaultReminder, ariaLabel: 'Default reminder', onChange: (v) => savePreference({ defaultReminder: v }, 'Default reminder updated.') }
      )
    ),
    controlRow('Default view', 'Which layout My Tasks opens in.',
      select(
        [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }, { value: 'timeline', label: 'Timeline' }],
        { value: state.user.defaultView, ariaLabel: 'Default view', onChange: (v) => savePreference({ defaultView: v }, 'Default view updated.') }
      )
    ),
    controlRow('Week starts on', 'Used by the calendar and weekly planning.',
      select(
        [
          { value: '1', label: 'Monday' }, { value: '0', label: 'Sunday' },
          { value: '6', label: 'Saturday' },
        ],
        { value: String(state.user.weekStart), ariaLabel: 'Week start', onChange: (v) => savePreference({ weekStart: Number(v) }, 'Week start updated.') }
      )
    ),
    controlRow('Timezone', 'Dates and reminders are calculated in this timezone.',
      select(
        TIMEZONES.map((tz) => ({ value: tz, label: tz })),
        { value: state.user.timezone, ariaLabel: 'Timezone', onChange: (v) => savePreference({ timezone: v }, 'Timezone updated.') }
      )
    ),
    controlRow('Working hours', 'Helps TELOS understand when your day is realistically available.',
      el('div', { class: 'row gap-2' }, [
        el('input', {
          class: 'input', type: 'time', value: state.user.workStart, style: { maxWidth: '110px' },
          onChange: (e) => savePreference({ workStart: e.target.value }),
        }),
        el('input', {
          class: 'input', type: 'time', value: state.user.workEnd, style: { maxWidth: '110px' },
          onChange: (e) => savePreference({ workEnd: e.target.value }, 'Working hours updated.'),
        }),
      ])
    ),
    controlRow('Missed recurring items', 'What happens when a recurring responsibility is completed late.',
      select(
        [
          { value: 'skip', label: 'Move to the next future date' },
          { value: 'sequential', label: 'Advance one occurrence at a time' },
        ],
        { value: state.user.recurrenceCatchup, ariaLabel: 'Missed occurrences', onChange: (v) => savePreference({ recurrenceCatchup: v }, 'Preference updated.') }
      )
    ),
  ]);
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

function notificationsSection() {
  return sectionCard('Notifications', 'TELOS should never become a source of notification fatigue.', [
    switchRow({
      id: 'notify-push', label: 'In-app reminders',
      description: 'Reminders appear in TELOS when they come due.',
      checked: state.user.notifyPush,
      onChange: (checked) => savePreference({ notifyPush: checked }, checked ? 'Reminders on.' : 'Reminders off.'),
    }),
    switchRow({
      id: 'notify-email', label: 'Email reminders',
      description: 'Requires a configured mail transport on your server.',
      checked: state.user.notifyEmail,
      onChange: (checked) => savePreference({ notifyEmail: checked }),
    }),
    switchRow({
      id: 'notify-digest', label: 'Daily summary',
      description: 'One message each morning with what deserves your attention.',
      checked: state.user.notifyDigest,
      onChange: (checked) => savePreference({ notifyDigest: checked }),
    }),
    controlRow('Quiet hours', 'Nothing will reach you between these times.',
      el('div', { class: 'row gap-2' }, [
        el('input', {
          class: 'input', type: 'time', value: state.user.quietStart, style: { maxWidth: '110px' },
          onChange: (e) => savePreference({ quietStart: e.target.value }),
        }),
        el('input', {
          class: 'input', type: 'time', value: state.user.quietEnd, style: { maxWidth: '110px' },
          onChange: (e) => savePreference({ quietEnd: e.target.value }, 'Quiet hours updated.'),
        }),
      ])
    ),
  ]);
}

/* ------------------------------------------------------------------ *
 * Assistant
 * ------------------------------------------------------------------ */

async function assistantSection() {
  const status = await api.get('/assistant/status').catch(() => null);
  const refresh = () => navigate('/settings?section=assistant', { replace: true });

  const MODES = [
    {
      value: 'local',
      title: 'On this server only',
      body: 'Answers come from what TELOS itself defines — its settings, its vocabulary, and simple wording rules. Nothing you write leaves the machine TELOS runs on. Works with no setup.',
    },
    {
      value: 'claude',
      title: 'Use Claude',
      body: 'Richer wording, descriptions and breakdowns. Sends the specific text you ask about, plus the names of your areas, projects and objectives — never your notes, and only when you ask.',
    },
    {
      value: 'off',
      title: 'Off',
      body: 'No assistant, no suggestion buttons anywhere in the app.',
    },
  ];

  const current = state.user.assistantMode || 'local';

  const option = (mode) => {
    const disabled = mode.value === 'claude' && !status?.claudeAvailable;
    return el('button', {
      class: 'choice', type: 'button',
      'aria-pressed': String(current === mode.value),
      disabled,
      style: { alignItems: 'flex-start', padding: 'var(--s-4)', opacity: disabled ? '0.55' : '1' },
      onClick: async () => {
        if (disabled) return;
        await savePreference({ assistantMode: mode.value }, `Assistant set to "${mode.title.toLowerCase()}".`);
        refresh();
      },
    }, [
      el('div', { class: 'stack gap-1' }, [
        el('span', { class: 'label', text: mode.title }),
        el('p', { class: 'hint', text: mode.body }),
        disabled
          ? el('p', { class: 'hint', style: { color: 'var(--warning)' }, text: 'No Anthropic API key is configured on this server.' })
          : null,
      ]),
    ]);
  };

  return el('div', {}, [
    sectionCard('Assistant', 'A small helper for wording, tags, breaking work into steps, and questions about TELOS itself.', [
      el('div', { class: 'stack gap-3' }, MODES.map(option)),
    ]),

    sectionCard('What Claude may see', 'The assistant always reads your plan when answering on this server — that costs nothing and goes nowhere. Sending it to Claude is a separate choice.', [
      switchRow({
        id: 'assistant-share-plan',
        label: 'Let Claude see what is on your plate',
        description:
          'Shares the shape of your plan: titles, dates, priorities, statuses and progress. Your descriptions, notes and links are never sent. Without this, Claude only sees the message you type and the names of your areas and projects.',
        checked: state.user.assistantSharePlan,
        onChange: (checked) =>
          savePreference(
            { assistantSharePlan: checked },
            checked ? 'Claude can now see your plan.' : 'Claude no longer sees your plan.'
          ),
      }),
      current !== 'claude'
        ? el('p', { class: 'hint', text: 'This setting only applies in Claude mode. On this server, your plan never leaves the machine either way.' })
        : null,
    ]),

    sectionCard('Making changes', 'The assistant can propose changes to your plan. It can never make one on its own — proposals are listed for you to review, and nothing happens until you press Apply.', [
      switchRow({
        id: 'assistant-may-act',
        label: 'Let the assistant propose changes',
        description:
          'Completing, rescheduling, changing a priority, marking something important, or adding a responsibility. Every proposal is shown with a checkbox before anything happens, and applied changes can be undone.',
        checked: state.user.assistantMayAct,
        onChange: (checked) =>
          savePreference(
            { assistantMayAct: checked },
            checked ? 'The assistant can now propose changes.' : 'The assistant will no longer propose changes.'
          ),
      }),
      el('p', { class: 'hint', text: 'The assistant cannot delete anything, in any mode. Deletion stays something you do directly.' }),
    ]),

    sectionCard('What it can do', null, [
      el('div', { class: 'stack gap-3' },
        [
          ['Tell you what is overdue, due today, or coming up', 'Both modes'],
          ['Report progress on an objective or project by name', 'Both modes'],
          ['Propose changes for you to confirm — reschedule, complete, add', 'Both modes'],
          ['Suggest titles for a responsibility, project or objective', 'Both modes'],
          ['Suggest tags', 'Both modes'],
          ['Break work into steps or milestones', 'Both modes'],
          ['Explain any setting, and where to find it', 'Both modes'],
          ['Rewrite a description in your own register', 'Claude only'],
          ['Reason about trade-offs across your whole plan', 'Claude only'],
        ].map(([what, where]) =>
          el('div', { class: 'row gap-3' }, [
            icon('check', { size: 14 }),
            el('span', { class: 'small grow', text: what }),
            el('span', { class: 'micro subtle', text: where }),
          ])
        )
      ),
    ]),

    sectionCard('What is shared', 'TELOS is private by default, and the assistant does not change that.', [
      el('div', { class: 'stack gap-3' }, [
        el('p', { class: 'small' }, [
          el('span', { text: 'On this server only: nothing is sent anywhere. The assistant runs inside TELOS, answers from its own definitions, and reads your plan straight from the database — the same data already on your screen.' }),
        ]),
        el('p', { class: 'small' }, [
          el('span', { text: 'Using Claude: the text you type, or the specific field you ask it to improve, is sent to Anthropic along with the names of your areas, projects and objectives. If you also allow it to see your plan, that adds titles, dates, priorities and progress. Your descriptions, notes and links are never sent. Nothing is sent unless you send a message or press Suggest.' }),
        ]),
        status?.model
          ? el('p', { class: 'hint', text: `This server is configured to use ${status.model}. The API key lives in the server's environment — your browser never holds it.` })
          : el('p', { class: 'hint', text: 'To enable Claude, set TELOS_ANTHROPIC_API_KEY in the server environment and restart TELOS.' }),
      ]),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Areas of Life
 * ------------------------------------------------------------------ */

async function areasSection() {
  const data = await api.get('/areas');
  const refresh = async () => {
    invalidateReference();
    await loadReference({ force: true }).catch(() => {});
    navigate('/settings?section=areas', { replace: true });
  };

  function areaEditor(area = null) {
    const values = {
      name: area?.name ?? '',
      icon: area?.icon ?? 'circle',
      color: area?.color ?? 'slate',
    };
    const nameInput = el('input', {
      class: 'input', value: values.name, dataset: { autofocus: '' },
      placeholder: 'Area name', maxlength: '60',
      onInput: (e) => { values.name = e.target.value; },
    });

    const iconGrid = el('div', { class: 'row gap-2 wrap' },
      AREA_ICONS.map((name) =>
        el('button', {
          class: 'btn-icon', type: 'button', 'aria-label': name,
          'aria-pressed': String(values.icon === name),
          style: values.icon === name ? { background: 'var(--accent-wash)', color: 'var(--accent)' } : {},
          onClick: (event) => {
            values.icon = name;
            [...event.currentTarget.parentElement.children].forEach((child) => {
              child.setAttribute('aria-pressed', String(child === event.currentTarget));
              child.style.background = child === event.currentTarget ? 'var(--accent-wash)' : '';
              child.style.color = child === event.currentTarget ? 'var(--accent)' : '';
            });
          },
        }, [icon(name, { size: 18 })])
      )
    );

    modal({
      title: area ? 'Edit area' : 'New area',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        field('Name', nameInput),
        field('Icon', iconGrid),
        field('Colour', select(
          AREA_COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })),
          { value: values.color, ariaLabel: 'Colour', onChange: (v) => { values.color = v; } }
        )),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: area ? 'Save' : 'Add area',
          onClick: async () => {
            if (!values.name.trim()) {
              nameInput.focus();
              return;
            }
            try {
              if (area) await api.patch(`/areas/${area.id}`, values);
              else await api.post('/areas', values);
              toast(area ? 'Area updated.' : 'Area added.');
              close();
              refresh();
            } catch (error) {
              notifyError(error);
            }
          },
        }),
      ],
    });
  }

  const move = async (index, delta) => {
    const order = data.areas.map((a) => a.id);
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    try {
      await api.post('/areas/reorder', { order });
      refresh();
    } catch (error) {
      notifyError(error);
    }
  };

  return sectionCard('Areas of Life', 'The parts of your life TELOS keeps track of. Reorder them to match how you think.', [
    el('div', { class: 'rows', style: { marginBottom: '16px' } },
      data.areas.map((area, index) =>
        el('div', { class: 'list-row' }, [
          icon(area.icon, { size: 18 }),
          el('div', { class: 'stack grow' }, [
            el('span', { class: 'small', text: area.name }),
            el('span', { class: 'micro subtle', text: `${area.taskCount} responsibilities · ${area.taskDone} complete` }),
          ]),
          area.archived ? chip('Hidden') : null,
          el('button', { class: 'btn-icon sm', type: 'button', 'aria-label': `Move ${area.name} up`, onClick: () => move(index, -1) },
            [icon('chevronUp', { size: 15 })]),
          el('button', { class: 'btn-icon sm', type: 'button', 'aria-label': `Move ${area.name} down`, onClick: () => move(index, 1) },
            [icon('chevronDown', { size: 15 })]),
          el('button', {
            class: 'btn-icon sm', type: 'button', 'aria-label': `Options for ${area.name}`,
            onClick: (event) => menu(event.currentTarget, [
              { label: 'Edit', icon: 'edit', onClick: () => areaEditor(area) },
              {
                label: area.archived ? 'Show again' : 'Hide from pickers',
                icon: 'archive',
                onClick: async () => {
                  await api.patch(`/areas/${area.id}`, { archived: !area.archived }).catch(notifyError);
                  refresh();
                },
              },
              { separator: true },
              {
                label: 'Delete', icon: 'trash', danger: true,
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `Delete "${area.name}"?`,
                    message: 'Responsibilities in this area are kept — they simply become unassigned.',
                    confirmLabel: 'Delete area', tone: 'danger',
                  });
                  if (!ok) return;
                  try {
                    await api.del(`/areas/${area.id}`);
                    toast('Area deleted.');
                    refresh();
                  } catch (error) {
                    notifyError(error);
                  }
                },
              },
            ]),
          }, [icon('more', { size: 15 })]),
        ])
      )
    ),
    el('button', { class: 'btn', type: 'button', onClick: () => areaEditor(null) },
      [icon('plus', { size: 15 }), el('span', { text: 'Add area' })]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Privacy & Security
 * ------------------------------------------------------------------ */

async function privacySection() {
  const [sessionsResult, summary, connections] = await Promise.all([
    api.get('/account/sessions'),
    api.get('/account/privacy-summary'),
    api.get('/account/connections'),
  ]);
  const refresh = () => navigate('/settings?section=privacy', { replace: true });

  function changePassword() {
    const current = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', dataset: { autofocus: '' } });
    const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const confirm = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const error = el('p', { class: 'error-text', style: { display: 'none' } });

    modal({
      title: 'Change password',
      subtitle: 'Other signed-in devices will be signed out.',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        error,
        field('Current password', current),
        field('New password', next, 'At least 10 characters, using three of: lowercase, uppercase, numbers, symbols.'),
        field('Confirm new password', confirm),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: 'Change password',
          onClick: async (event) => {
            error.style.display = 'none';
            if (next.value !== confirm.value) {
              error.textContent = 'The two passwords do not match.';
              error.style.display = 'block';
              return;
            }
            // Captured now: `currentTarget` is null once an await resumes.
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await api.post('/account/password', {
                currentPassword: current.value,
                newPassword: next.value,
                confirmPassword: confirm.value,
                keepCurrentSession: true,
              });
              toast(result.message);
              close();
              refresh();
            } catch (err) {
              error.textContent = err.message;
              error.style.display = 'block';
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  async function deleteAccount() {
    const password = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const confirmText = el('input', { class: 'input', placeholder: 'DELETE MY ACCOUNT' });
    const error = el('p', { class: 'error-text', style: { display: 'none' } });

    modal({
      title: 'Delete your account',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        el('div', { class: 'notice danger' }, [
          el('span', { text: 'This permanently removes your account and everything in it: responsibilities, projects, objectives, milestones, notes, areas, history and sessions. Nothing is retained and nothing can be recovered.' }),
        ]),
        error,
        field('Your password', password),
        field('Type DELETE MY ACCOUNT to confirm', confirmText),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Keep my account', onClick: () => close() }),
        el('button', {
          class: 'btn btn-danger', type: 'button', text: 'Delete permanently',
          onClick: async (event) => {
            error.style.display = 'none';
            // Captured now: `currentTarget` is null once an await resumes.
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await api.post('/account/delete', {
                password: password.value,
                confirm: confirmText.value.trim(),
              });
              close();
              setUser(null);
              window.location.hash = '#/login';
              window.location.reload();
            } catch (err) {
              error.textContent = err.message;
              error.style.display = 'block';
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  const sessionRow = (session) =>
    el('div', { class: 'list-row' }, [
      icon('device', { size: 18 }),
      el('div', { class: 'stack grow', style: { minWidth: '0' } }, [
        el('span', { class: 'small truncate', text: session.userAgent || 'Unknown device' }),
        el('span', { class: 'micro subtle', text: `${session.ip || 'unknown address'} · last active ${timeAgo(session.lastSeenAt)} · expires ${formatDateTime(session.expiresAt)}` }),
      ]),
      session.current ? chip('This device', { tone: 'accent' }) : null,
      el('button', {
        class: 'btn btn-sm', type: 'button', text: session.current ? 'Sign out' : 'Revoke',
        onClick: async () => {
          try {
            const result = await api.del(`/account/sessions/${session.id}`);
            if (result.signedOutCurrent) {
              setUser(null);
              window.location.hash = '#/login';
              window.location.reload();
              return;
            }
            toast('Session revoked.');
            refresh();
          } catch (error) {
            notifyError(error);
          }
        },
      }),
    ]);

  return el('div', {}, [
    sectionCard('Password', 'Your password is stored only as a memory-hard hash. TELOS never has a copy of it.', [
      controlRow('Change password', 'You will need your current password.',
        el('button', { class: 'btn', type: 'button', text: 'Change password', onClick: changePassword })
      ),
      controlRow('Email address', state.user.emailVerified ? 'Confirmed.' : 'Not yet confirmed.',
        state.user.emailVerified
          ? chip('Confirmed', { tone: 'positive' })
          : el('button', {
              class: 'btn btn-sm', type: 'button', text: 'Resend confirmation',
              onClick: async () => {
                try {
                  const result = await api.post('/auth/resend-verification', {});
                  toast(result.message);
                  if (result.devVerifyUrl) console.info('[TELOS] Development verification link:', result.devVerifyUrl);
                } catch (error) {
                  notifyError(error);
                }
              },
            })
      ),
    ]),

    sectionCard('Active sessions', 'Every device currently signed in to your account.', [
      el('div', { class: 'rows' }, sessionsResult.sessions.map(sessionRow)),
      el('div', { class: 'row gap-3', style: { marginTop: '16px' } }, [
        el('button', {
          class: 'btn', type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Sign out of other sessions?',
              message: 'Every device except this one will be signed out immediately.',
              confirmLabel: 'Sign out others',
            });
            if (!ok) return;
            try {
              const result = await api.post('/account/sessions/revoke-others', {});
              toast(result.revoked ? `${result.revoked} session${result.revoked === 1 ? '' : 's'} signed out.` : 'No other sessions.');
              refresh();
            } catch (error) {
              notifyError(error);
            }
          },
        }, [icon('logout', { size: 15 }), el('span', { text: 'Sign out of other sessions' })]),
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Sign out of this device', onClick: signOut }),
      ]),
    ]),

    sectionCard('Connected accounts', 'Third-party sign-in providers linked to this account.', [
      connections.connections.length
        ? el('div', { class: 'rows' }, connections.connections.map((connection) =>
            el('div', { class: 'list-row' }, [el('span', { class: 'small grow', text: connection.provider })])
          ))
        : el('p', { class: 'hint', text: connections.available.length
            ? 'No providers are linked to this account yet.'
            : 'No sign-in providers are configured on this server. TELOS is using email and password only.' }),
    ]),

    sectionCard('What TELOS holds', 'Everything below is stored on the server you control. There is no third-party analytics and nothing is shared.', [
      el('div', { class: 'grid grid-3', style: { marginBottom: '16px' } },
        Object.entries(summary.storage).map(([key, value]) =>
          el('div', { class: 'stack' }, [
            el('span', { class: 'small mono', text: String(value) }),
            el('span', { class: 'micro subtle', text: key }),
          ])
        )
      ),
      el('p', { class: 'hint', text: summary.dataResidency }),
    ]),

    sectionCard('Delete account', 'This is irreversible.', [
      controlRow('Delete this account and all of its data', 'Your responsibilities, projects, objectives, notes and history are permanently removed.',
        el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete account', onClick: deleteAccount })
      ),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

function dataSection() {
  const refresh = () => navigate('/settings?section=data', { replace: true });

  const SCOPES = [
    { value: 'tasks', label: 'Responsibilities and subtasks' },
    { value: 'projects', label: 'Projects' },
    { value: 'objectives', label: 'Objectives and milestones' },
    { value: 'notes', label: 'Notes' },
    { value: 'events', label: 'Events' },
    { value: 'history', label: 'Completion history' },
    { value: 'notifications', label: 'Reminders and notifications' },
    { value: 'areas', label: 'Areas of life' },
  ];

  function importDialog() {
    const fileInput = el('input', { type: 'file', accept: 'application/json', class: 'input' });
    const replace = el('input', { type: 'checkbox' });
    const error = el('p', { class: 'error-text', style: { display: 'none' } });

    modal({
      title: 'Import a TELOS export',
      subtitle: 'Records are given new identifiers and added to this account.',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        error,
        field('Export file', fileInput),
        el('label', { class: 'checkbox' }, [
          replace,
          el('span', { class: 'checkbox-label', text: 'Replace everything currently in this account first' }),
        ]),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: 'Import',
          onClick: async (event) => {
            const file = fileInput.files?.[0];
            if (!file) {
              error.textContent = 'Choose a file to import.';
              error.style.display = 'block';
              return;
            }
            if (file.size > 8 * 1024 * 1024) {
              error.textContent = 'That file is larger than 8 MB.';
              error.style.display = 'block';
              return;
            }
            // Captured now: `currentTarget` is null once an await resumes.
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const text = await file.text();
              const data = JSON.parse(text);
              const result = await api.post('/account/import', { data, replace: replace.checked });
              const total = Object.values(result.imported).reduce((a, b) => a + b, 0);
              toast(`${total} records imported.`);
              close();
              invalidateReference();
              await loadReference({ force: true }).catch(() => {});
              refresh();
            } catch (err) {
              error.textContent = err.message || 'That file could not be read as a TELOS export.';
              error.style.display = 'block';
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  function deleteSelected() {
    const checks = SCOPES.map((scope) => ({
      scope,
      input: el('input', { type: 'checkbox' }),
    }));
    const confirmText = el('input', { class: 'input', placeholder: 'DELETE' });
    const error = el('p', { class: 'error-text', style: { display: 'none' } });

    modal({
      title: 'Delete selected data',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        el('div', { class: 'notice danger', text: 'Deleted data cannot be recovered. Export first if you may want it later.' }),
        error,
        el('div', { class: 'stack gap-2' },
          checks.map(({ scope, input }) =>
            el('label', { class: 'checkbox' }, [input, el('span', { class: 'checkbox-label', text: scope.label })])
          )
        ),
        field('Type DELETE to confirm', confirmText),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
        el('button', {
          class: 'btn btn-danger', type: 'button', text: 'Delete selected',
          onClick: async (event) => {
            const scopes = checks.filter((c) => c.input.checked).map((c) => c.scope.value);
            if (!scopes.length) {
              error.textContent = 'Select at least one kind of data.';
              error.style.display = 'block';
              return;
            }
            // Captured now: `currentTarget` is null once an await resumes.
            const button = event.currentTarget;
            button.disabled = true;
            try {
              await api.post('/account/data/delete', { scopes, confirm: confirmText.value.trim() });
              toast('Selected data deleted.');
              close();
              invalidateReference();
              await loadReference({ force: true }).catch(() => {});
              refresh();
            } catch (err) {
              error.textContent = err.message;
              error.style.display = 'block';
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  function deleteEverything() {
    const password = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const confirmText = el('input', { class: 'input', placeholder: 'DELETE EVERYTHING' });
    const error = el('p', { class: 'error-text', style: { display: 'none' } });

    modal({
      title: 'Delete all planning data',
      subtitle: 'Your account stays; everything inside it is removed.',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        el('div', { class: 'notice danger', text: 'Every responsibility, project, objective, milestone, note, event and completion record will be permanently deleted.' }),
        error,
        field('Your password', password),
        field('Type DELETE EVERYTHING to confirm', confirmText),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
        el('button', {
          class: 'btn btn-danger', type: 'button', text: 'Delete everything',
          onClick: async (event) => {
            // Captured now: `currentTarget` is null once an await resumes.
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await api.post('/account/data/delete-all', {
                password: password.value,
                confirm: confirmText.value.trim(),
              });
              toast(result.message);
              close();
              invalidateReference();
              await loadReference({ force: true }).catch(() => {});
              refresh();
            } catch (err) {
              error.textContent = err.message;
              error.style.display = 'block';
              button.disabled = false;
            }
          },
        }),
      ],
    });
  }

  return el('div', {}, [
    sectionCard('Export', 'A complete copy of everything in your account, as a single JSON file.', [
      controlRow('Export all data', 'Includes responsibilities, projects, objectives, milestones, notes, events, areas and history.',
        el('button', { class: 'btn', type: 'button', onClick: () => { downloadExport(); toast('Export started.'); } },
          [icon('download', { size: 15 }), el('span', { text: 'Export' })])
      ),
    ]),
    sectionCard('Import', 'Restore a previous export into this account.', [
      controlRow('Import from a TELOS export', 'Imported records are given new identifiers and belong only to this account.',
        el('button', { class: 'btn', type: 'button', onClick: importDialog },
          [icon('upload', { size: 15 }), el('span', { text: 'Import' })])
      ),
    ]),
    sectionCard('Delete data', 'Remove parts of your data without closing your account.', [
      controlRow('Delete selected data', 'Choose exactly what to remove.',
        el('button', { class: 'btn btn-danger', type: 'button', text: 'Choose data', onClick: deleteSelected })
      ),
      controlRow('Delete all data', 'Empties the account entirely, keeping your sign-in.',
        el('button', { class: 'btn btn-danger', type: 'button', text: 'Delete all data', onClick: deleteEverything })
      ),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * About
 * ------------------------------------------------------------------ */

function aboutSection() {
  const nameInput = el('input', {
    class: 'input', value: state.user.name, maxlength: '100',
    onChange: (e) => savePreference({ name: e.target.value.trim() }, 'Name updated.'),
  });

  return el('div', {}, [
    sectionCard('Your account', null, [
      controlRow('Name', 'How TELOS greets you.', nameInput),
      controlRow('Email', 'Used for sign-in and account recovery.',
        el('span', { class: 'small muted', text: state.user.email })),
      controlRow('Member since', null,
        el('span', { class: 'small muted', text: formatDateTime(state.user.createdAt) })),
    ]),
    sectionCard('About TELOS', null, [
      el('div', { class: 'stack gap-3' }, [
        el('p', { class: 'small' }, [
          el('span', { text: 'TELOS takes its name from the Greek idea of an ultimate purpose — the end toward which something is directed. It exists to connect the small things you do each day with the larger life you are trying to build.' }),
        ]),
        el('p', { class: 'small muted', text: 'Live with intention. Move with purpose.' }),
        el('div', { class: 'row gap-3 wrap', style: { marginTop: '8px' } }, [
          chip('Purpose'), icon('chevronRight', { size: 12 }),
          chip('Objective'), icon('chevronRight', { size: 12 }),
          chip('Milestone'), icon('chevronRight', { size: 12 }),
          chip('Project'), icon('chevronRight', { size: 12 }),
          chip('Responsibility'), icon('chevronRight', { size: 12 }),
          chip('Today', { tone: 'accent' }),
        ]),
      ]),
    ]),
    sectionCard('Keyboard', 'A few shortcuts, for when your hands are already there.', [
      el('div', { class: 'stack gap-2' },
        [
          ['N', 'Quick add'],
          ['A', 'Assistant'],
          ['/', 'Search'],
          ['G then O', 'Overview'],
          ['G then T', 'My Tasks'],
          ['G then C', 'Calendar'],
          ['G then P', 'Projects'],
          ['G then I', 'Insights'],
          ['Esc', 'Close a dialog'],
        ].map(([key, label]) =>
          el('div', { class: 'row gap-3' }, [
            el('span', { class: 'kbd', text: key }),
            el('span', { class: 'small muted', text: label }),
          ])
        )
      ),
    ]),
  ]);
}

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export async function settingsView({ query = {} } = {}) {
  const section = SECTIONS.some((s) => s.id === query.section) ? query.section : 'appearance';

  const nav = el('nav', { class: 'settings-nav', 'aria-label': 'Settings sections' },
    SECTIONS.map((entry) =>
      el('button', {
        type: 'button',
        'aria-current': String(entry.id === section),
        text: entry.label,
        onClick: () => navigate(`/settings${buildQuery({ section: entry.id })}`, { replace: true }),
      })
    )
  );

  const body =
    section === 'appearance' ? appearanceSection()
    : section === 'planning' ? planningSection()
    : section === 'notifications' ? notificationsSection()
    : section === 'assistant' ? await assistantSection()
    : section === 'areas' ? await areasSection()
    : section === 'privacy' ? await privacySection()
    : section === 'data' ? dataSection()
    : aboutSection();

  return page({
    title: 'Settings',
    subtitle: 'How TELOS behaves, and what it holds.',
    children: el('div', { class: 'settings' }, [nav, el('div', {}, [body])]),
  });
}

export default settingsView;
