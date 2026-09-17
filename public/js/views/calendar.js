import api from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { empty, menu, notifyError, segmented, toast } from '../ui.js';
import {
  addDays, addMonths, endOfMonth, formatDate, formatFull, formatMonth, formatTime,
  startOfMonth, startOfWeek, today, toDate, weekdayNames,
} from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { state } from '../store.js';
import { page } from '../shell.js';
import { taskRow, tasksChanged } from '../components/task.js';
import { openTaskEditor } from '../components/taskEditor.js';
import { openQuickAdd } from '../components/quickAdd.js';

const MODES = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const setQuery = (query, changes) =>
  navigate(`/calendar${buildQuery({ ...query, ...changes })}`, { replace: true });

/** Moves a responsibility to a new date, used by every drop target. */
async function moveTask(taskId, date) {
  try {
    await api.post(`/tasks/${taskId}/reschedule`, { dueDate: date });
    toast(`Moved to ${formatDate(date, { month: 'long', day: 'numeric' })}.`);
    tasksChanged({ taskId });
    return true;
  } catch (error) {
    notifyError(error);
    return false;
  }
}

export async function calendarView({ query = {} } = {}) {
  const mode = MODES.some((m) => m.value === query.mode) ? query.mode : 'month';
  const base = today();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : base;

  const range = {
    day: { from: anchor, to: anchor },
    week: { from: startOfWeek(anchor), to: addDays(startOfWeek(anchor), 6) },
    month: {
      from: addDays(startOfWeek(startOfMonth(anchor)), 0),
      to: addDays(startOfWeek(endOfMonth(anchor)), 41),
    },
    year: { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` },
  }[mode];

  const data = await api.get('/calendar', { from: range.from, to: range.to });
  const refresh = () => navigate(`/calendar${buildQuery(query)}`, { replace: true });

  /* Index everything by date once. */
  const byDate = new Map();
  const push = (date, item) => {
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(item);
  };
  for (const task of data.tasks) push(task.dueDate, { kind: 'task', task });
  for (const event of data.events) push(event.startDate, { kind: 'event', event });
  for (const deadline of data.deadlines) push(deadline.date, { kind: 'deadline', deadline });

  const navigateBy = (delta) => {
    const next =
      mode === 'day' ? addDays(anchor, delta)
      : mode === 'week' ? addDays(anchor, delta * 7)
      : mode === 'month' ? addMonths(anchor, delta)
      : `${Number(anchor.slice(0, 4)) + delta}-01-01`;
    setQuery(query, { date: next, mode });
  };

  const headingText =
    mode === 'day' ? formatFull(anchor)
    : mode === 'week' ? `${formatDate(startOfWeek(anchor), { month: 'long', day: 'numeric' })} – ${formatDate(addDays(startOfWeek(anchor), 6), { month: 'long', day: 'numeric' })}`
    : mode === 'month' ? formatMonth(anchor)
    : anchor.slice(0, 4);

  /* ------------------------------ Items -------------------------------- */

  function itemNode(entry, { draggable = true } = {}) {
    if (entry.kind === 'event') {
      return el('button', {
        class: 'cal-item event', type: 'button',
        title: entry.event.title,
        text: `${entry.event.startTime ? `${formatTime(entry.event.startTime)} ` : ''}${entry.event.title}`,
        onClick: () => openEventEditor({ event: entry.event, onSaved: refresh }),
      });
    }
    if (entry.kind === 'deadline') {
      const path = entry.deadline.kind === 'project' ? `/projects/${entry.deadline.id}`
        : entry.deadline.kind === 'objective' ? `/objectives/${entry.deadline.id}` : null;
      return el(path ? 'a' : 'span', {
        class: 'cal-item deadline',
        ...(path ? { href: `#${path}` } : {}),
        title: `${entry.deadline.kind}: ${entry.deadline.title}`,
        text: entry.deadline.title,
      });
    }

    const task = entry.task;
    const node = el('button', {
      class: `cal-item ${task.priority}${task.status === 'completed' ? ' done' : ''}${task.projected ? ' projected' : ''}`,
      type: 'button',
      draggable: draggable && !task.projected ? 'true' : 'false',
      title: `${task.title}${task.projected ? ' (upcoming occurrence)' : ''}`,
      text: `${task.dueTime ? `${formatTime(task.dueTime)} ` : ''}${task.title}`,
      onClick: () => openTaskEditor({ taskId: task.sourceId || task.id, onSaved: refresh }),
    });
    if (draggable && !task.projected) {
      node.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
      });
    }
    return node;
  }

  function makeDropTarget(node, date) {
    node.addEventListener('dragover', (event) => {
      event.preventDefault();
      node.classList.add('drop-active');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-active'));
    node.addEventListener('drop', async (event) => {
      event.preventDefault();
      node.classList.remove('drop-active');
      const taskId = event.dataTransfer.getData('text/plain');
      if (!taskId || taskId.includes('@')) return;
      if (await moveTask(taskId, date)) refresh();
    });
    return node;
  }

  /* ------------------------------ Month -------------------------------- */

  function monthGrid() {
    const first = startOfWeek(startOfMonth(anchor));
    const monthPrefix = anchor.slice(0, 7);
    const days = el('div', { class: 'cal-days' });

    for (let i = 0; i < 42; i += 1) {
      const date = addDays(first, i);
      const entries = byDate.get(date) ?? [];
      const cell = el('div', {
        class: `cal-day${date.slice(0, 7) !== monthPrefix ? ' outside' : ''}${date === base ? ' today' : ''}`,
      }, [
        el('button', {
          class: 'cal-daynum', type: 'button',
          'aria-label': `Add on ${formatFull(date)}`,
          text: String(toDate(date).getUTCDate()),
          onClick: () => openTaskEditor({ draft: { dueDate: date }, onSaved: refresh }),
        }),
        ...entries.slice(0, 3).map((entry) => itemNode(entry)),
        entries.length > 3
          ? el('button', {
              class: 'cal-more', type: 'button',
              text: `${entries.length - 3} more`,
              onClick: () => setQuery(query, { mode: 'day', date }),
            })
          : null,
      ]);
      makeDropTarget(cell, date);
      days.append(cell);
    }

    return el('div', { class: 'cal-grid' }, [
      el('div', { class: 'cal-weekdays' }, weekdayNames().map((name) => el('div', { text: name }))),
      days,
    ]);
  }

  /* ------------------------------- Week -------------------------------- */

  function weekGrid() {
    const first = startOfWeek(anchor);
    return el('div', { class: 'cal-week' },
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(first, i);
        const entries = byDate.get(date) ?? [];
        const body = el('div', { class: 'cal-week-body' }, [
          ...entries.map((entry) => itemNode(entry)),
          !entries.length ? el('p', { class: 'micro subtle', style: { padding: '6px' }, text: 'Nothing scheduled' }) : null,
        ]);
        const col = el('div', { class: `cal-week-col${date === base ? ' today' : ''}` }, [
          el('div', { class: 'cal-week-head row', style: { justifyContent: 'space-between' } }, [
            el('div', { class: 'stack' }, [
              el('span', { class: 'eyebrow', text: formatDate(date, { weekday: 'short' }) }),
              el('span', { class: 'small', text: String(toDate(date).getUTCDate()) }),
            ]),
            el('button', {
              class: 'btn-icon sm', type: 'button', 'aria-label': `Add on ${formatFull(date)}`,
              onClick: () => openTaskEditor({ draft: { dueDate: date }, onSaved: refresh }),
            }, [icon('plus', { size: 14 })]),
          ]),
          body,
        ]);
        makeDropTarget(col, date);
        return col;
      })
    );
  }

  /* -------------------------------- Day -------------------------------- */

  function dayView() {
    const entries = byDate.get(anchor) ?? [];
    const tasks = entries.filter((e) => e.kind === 'task').map((e) => e.task);
    const others = entries.filter((e) => e.kind !== 'task');

    return el('div', { class: 'stack gap-5' }, [
      el('div', { class: 'card card-flush' }, [
        el('div', { class: 'panel-head' }, [
          el('span', { class: 'eyebrow', text: 'Responsibilities' }),
          el('button', {
            class: 'btn btn-sm', type: 'button',
            onClick: () => openTaskEditor({ draft: { dueDate: anchor }, onSaved: refresh }),
          }, [icon('plus', { size: 14 }), el('span', { text: 'Add' })]),
        ]),
        tasks.length
          ? el('div', { class: 'task-list', style: { padding: '4px 12px' } },
              tasks.map((task) =>
                task.projected
                  ? el('div', { class: 'task-row' }, [
                      el('div', { class: 'task-check', style: { opacity: '0.4' } }),
                      el('div', { class: 'task-body' }, [
                        el('span', { class: 'task-title muted', text: task.title }),
                        el('div', { class: 'task-meta' }, [el('span', { text: 'Upcoming occurrence' })]),
                      ]),
                    ])
                  : taskRow(task, { onChanged: refresh })
              ))
          : empty({ iconName: 'check', title: 'Nothing scheduled.', body: 'This day is open.' }),
      ]),
      others.length
        ? el('div', { class: 'card' }, [
            el('div', { class: 'card-head' }, [el('h3', { text: 'Also on this day', style: { fontSize: '1rem' } })]),
            el('div', { class: 'stack gap-2' }, others.map((entry) => itemNode(entry, { draggable: false }))),
          ])
        : null,
    ]);
  }

  /* -------------------------------- Year ------------------------------- */

  function yearView() {
    const year = anchor.slice(0, 4);
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);

    return el('div', { class: 'cal-year' },
      months.map((monthStart) => {
        const prefix = monthStart.slice(0, 7);
        const last = Number(endOfMonth(monthStart).slice(8));
        const offset = (toDate(monthStart).getUTCDay() - (state.user?.weekStart ?? 1) + 7) % 7;

        const counts = new Map();
        for (const [date, entries] of byDate) {
          if (date.startsWith(prefix)) counts.set(date, entries.length);
        }

        const grid = el('div', { class: 'mini-grid' });
        for (let i = 0; i < offset; i += 1) grid.append(el('span'));
        for (let day = 1; day <= last; day += 1) {
          const date = `${prefix}-${String(day).padStart(2, '0')}`;
          grid.append(
            el('button', {
              class: `mini-day${counts.get(date) ? ' has' : ''}${date === base ? ' today' : ''}`,
              type: 'button',
              title: counts.get(date) ? `${counts.get(date)} items` : formatFull(date),
              text: String(day),
              onClick: () => setQuery(query, { mode: 'day', date }),
            })
          );
        }

        const monthDeadlines = data.deadlines.filter((d) => d.date.startsWith(prefix));
        const monthTaskCount = data.tasks.filter((t) => t.dueDate?.startsWith(prefix)).length;

        return el('div', { class: 'year-month' }, [
          el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
            el('h4', { text: formatDate(monthStart, { month: 'long' }) }),
            el('button', {
              class: 'btn-icon sm', type: 'button', 'aria-label': `Open ${formatMonth(monthStart)}`,
              onClick: () => setQuery(query, { mode: 'month', date: monthStart }),
            }, [icon('arrowRight', { size: 14 })]),
          ]),
          grid,
          el('div', { class: 'stack gap-1' }, [
            el('span', { class: 'micro subtle', text: `${monthTaskCount} responsibilities` }),
            ...monthDeadlines.slice(0, 3).map((deadline) =>
              el('span', { class: 'micro', style: { color: 'var(--accent)' }, text: `${formatDate(deadline.date)} · ${deadline.title}` })
            ),
          ]),
        ]);
      })
    );
  }

  const body =
    mode === 'day' ? dayView()
    : mode === 'week' ? weekGrid()
    : mode === 'year' ? yearView()
    : monthGrid();

  const head = el('div', { class: 'cal-head' }, [
    el('div', { class: 'row gap-2' }, [
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Previous', onClick: () => navigateBy(-1) },
        [icon('chevronLeft', { size: 18 })]),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Today', onClick: () => setQuery(query, { date: base }) }),
      el('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Next', onClick: () => navigateBy(1) },
        [icon('chevronRight', { size: 18 })]),
      el('h2', { style: { marginLeft: '8px', fontSize: '1.25rem' }, text: headingText }),
    ]),
    el('div', { class: 'row gap-2' }, [
      segmented(MODES, { value: mode, ariaLabel: 'Calendar view', onChange: (v) => setQuery(query, { mode: v }) }),
      el('button', {
        class: 'btn btn-sm', type: 'button',
        onClick: (event) => menu(event.currentTarget, [
          { label: 'Add responsibility', icon: 'plus', onClick: () => openTaskEditor({ draft: { dueDate: anchor }, onSaved: refresh }) },
          { label: 'Quick add', icon: 'sparkle', onClick: () => openQuickAdd({ onSaved: refresh }) },
          { label: 'Add event', icon: 'calendar', onClick: () => openEventEditor({ date: anchor, onSaved: refresh }) },
        ]),
      }, [icon('plus', { size: 15 }), el('span', { text: 'Add' })]),
    ]),
  ]);

  return page({
    wide: true,
    children: [
      head,
      body,
      el('p', { class: 'hint', style: { marginTop: '16px' }, text: 'Drag a responsibility to another day to reschedule it. Dashed items are future occurrences of a recurring responsibility.' }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export async function openEventEditor({ event: existing = null, date = today(), onSaved } = {}) {
  const { modal, field } = await import('../ui.js');
  const values = {
    title: existing?.title ?? '',
    startDate: existing?.startDate ?? date,
    startTime: existing?.startTime ?? '',
    endDate: existing?.endDate ?? '',
    location: existing?.location ?? '',
    description: existing?.description ?? '',
    areaId: existing?.areaId ?? '',
  };

  const input = (props) => el('input', { class: 'input', ...props });
  const titleInput = input({
    value: values.title, dataset: { autofocus: '' }, placeholder: 'What is happening?',
    onInput: (e) => { values.title = e.target.value; },
  });

  const save = async (close) => {
    if (!values.title.trim()) {
      titleInput.focus();
      return;
    }
    try {
      const payload = {
        title: values.title.trim(),
        startDate: values.startDate,
        startTime: values.startTime || null,
        endDate: values.endDate || null,
        location: values.location,
        description: values.description,
        areaId: values.areaId || null,
        allDay: !values.startTime,
      };
      if (existing) await api.patch(`/events/${existing.id}`, payload);
      else await api.post('/events', payload);
      toast(existing ? 'Event updated.' : 'Event added.');
      close();
      onSaved?.();
    } catch (error) {
      notifyError(error);
    }
  };

  modal({
    title: existing ? 'Edit event' : 'New event',
    body: el('div', { class: 'stack gap-4' }, [
      field('Title', titleInput),
      el('div', { class: 'grid grid-3' }, [
        field('Date', input({ type: 'date', value: values.startDate, onChange: (e) => { values.startDate = e.target.value; } })),
        field('Time', input({ type: 'time', value: values.startTime, onChange: (e) => { values.startTime = e.target.value; } })),
        field('Ends', input({ type: 'date', value: values.endDate, onChange: (e) => { values.endDate = e.target.value; } })),
      ]),
      field('Location', input({ value: values.location, onChange: (e) => { values.location = e.target.value; } })),
      field('Description', el('textarea', {
        class: 'textarea', style: { minHeight: '64px' },
        onInput: (e) => { values.description = e.target.value; },
      }, values.description)),
    ]),
    footer: (close) => [
      existing
        ? el('button', {
            class: 'btn btn-danger', type: 'button', text: 'Delete',
            onClick: async () => {
              try {
                await api.del(`/events/${existing.id}`);
                toast('Event deleted.');
                close();
                onSaved?.();
              } catch (error) {
                notifyError(error);
              }
            },
          })
        : null,
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
      el('button', { class: 'btn btn-primary', type: 'button', text: 'Save', onClick: () => save(close) }),
    ],
  });
}

export default calendarView;
