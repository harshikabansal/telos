import api from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { chip, confirmDialog, empty, menu, notifyError, segmented, select, toast } from '../ui.js';
import { addDays, daysBetween, formatDate, relativeDate, today } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { state } from '../store.js';
import { page } from '../shell.js';
import { taskCard, taskRow, tasksChanged } from '../components/task.js';
import { openQuickAdd } from '../components/quickAdd.js';

const VIEWS = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'important', label: 'Important' },
  { value: 'meaningful', label: 'Meaningful' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'unscheduled', label: 'Unscheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

const VIEW_COPY = {
  today: { title: "Today's Focus", subtitle: 'What deserves your attention now.' },
  upcoming: { title: 'Upcoming', subtitle: 'What is ahead of you.' },
  overdue: { title: 'Attention Required', subtitle: 'Past their date and still open.' },
  important: { title: 'Important', subtitle: 'What matters, whether or not it is urgent.' },
  meaningful: { title: 'Meaningful', subtitle: 'Work that moves a long-term objective.' },
  recurring: { title: 'Recurring Responsibilities', subtitle: 'The rhythms you have chosen to keep.' },
  unscheduled: { title: 'Next Actions', subtitle: 'Open work without a date.' },
  completed: { title: 'Completed', subtitle: 'Your record of what is done.' },
  all: { title: 'My Tasks', subtitle: 'Every responsibility you are holding.' },
};

const SORTS = [
  { value: 'due', label: 'Due date' },
  { value: 'focus', label: 'Focus' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
];

const STATUS_COLUMNS = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const setQuery = (query, changes) =>
  navigate(`/tasks${buildQuery({ ...query, ...changes })}`, { replace: true });

/** Date buckets used when the list is ordered by due date. */
function bucketOf(task, base) {
  if (task.status === 'completed') return 'Completed';
  if (!task.dueDate) return 'No date';
  const delta = daysBetween(base, task.dueDate);
  if (delta < 0) return 'Overdue';
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta <= 7) return 'This week';
  if (delta <= 30) return 'This month';
  return 'Later';
}
const BUCKET_ORDER = ['Overdue', 'Today', 'Tomorrow', 'This week', 'This month', 'Later', 'No date', 'Completed'];

export async function tasksView({ query = {} } = {}) {
  const view = VIEWS.some((v) => v.value === query.view) ? query.view : 'today';
  const layout = ['list', 'board', 'timeline'].includes(query.layout)
    ? query.layout
    : state.user?.defaultView === 'board' || state.user?.defaultView === 'timeline'
      ? state.user.defaultView
      : 'list';
  const sort = SORTS.some((s) => s.value === query.sort) ? query.sort : view === 'today' ? 'focus' : 'due';
  const base = today();

  const params = {
    view,
    sort,
    areaId: query.areaId,
    projectId: query.projectId,
    priority: query.priority,
    tag: query.tag,
    q: query.q,
    from: query.from,
    to: query.to,
  };
  const data = await api.get('/tasks', params);
  const tasks = data.tasks;

  const refresh = () => navigate(`/tasks${buildQuery(query)}`, { replace: true });

  /* ---------------------------- Filter bar ----------------------------- */

  const viewChips = el('div', { class: 'row gap-2 wrap' },
    VIEWS.map((option) =>
      el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(option.value === view),
        style: option.value === view
          ? { background: 'var(--accent-wash)', color: 'var(--accent)', borderColor: 'var(--accent-wash)', fontWeight: '600' }
          : {},
        text: option.label,
        onClick: () => setQuery(query, { view: option.value, layout }),
      })
    )
  );

  const filterRow = el('div', { class: 'filters', style: { marginBottom: '20px' } }, [
    select(
      [{ value: '', label: 'All areas' }, ...state.areas.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))],
      { value: query.areaId || '', ariaLabel: 'Filter by area', onChange: (v) => setQuery(query, { areaId: v || undefined }) }
    ),
    select(
      [{ value: '', label: 'All projects' }, ...state.projects.map((p) => ({ value: p.id, label: p.name }))],
      { value: query.projectId || '', ariaLabel: 'Filter by project', onChange: (v) => setQuery(query, { projectId: v || undefined }) }
    ),
    select(
      [
        { value: '', label: 'Any priority' },
        { value: 'urgent', label: 'Urgent' }, { value: 'high', label: 'High' },
        { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
      ],
      { value: query.priority || '', ariaLabel: 'Filter by priority', onChange: (v) => setQuery(query, { priority: v || undefined }) }
    ),
    select(SORTS, { value: sort, ariaLabel: 'Sort by', onChange: (v) => setQuery(query, { sort: v }) }),
    (query.areaId || query.projectId || query.priority || query.tag || query.q)
      ? el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onClick: () => setQuery({ view, layout }, {}),
        }, [icon('close', { size: 14 }), el('span', { text: 'Clear filters' })])
      : null,
  ]);

  /* -------------------------- Bulk selection --------------------------- */

  const selection = new Set();
  const bulkBar = el('div', {
    class: 'row gap-3 wrap',
    style: {
      display: 'none', position: 'sticky', bottom: '16px', zIndex: '30',
      background: 'var(--surface)', border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius)', padding: '10px 14px', boxShadow: 'var(--shadow)',
      marginTop: '16px',
    },
  });

  const bulkAction = async (body, message) => {
    try {
      await api.post('/tasks/bulk', { ids: [...selection], ...body });
      toast(message);
      selection.clear();
      tasksChanged({});
      refresh();
    } catch (error) {
      notifyError(error);
    }
  };

  const paintBulk = () => {
    clear(bulkBar);
    bulkBar.style.display = selection.size ? 'flex' : 'none';
    if (!selection.size) return;
    bulkBar.append(
      el('span', { class: 'small grow', text: `${selection.size} selected` }),
      el('button', { class: 'btn btn-sm', type: 'button', text: 'Complete', onClick: () => bulkAction({ action: 'complete' }, 'Completed.') }),
      el('button', {
        class: 'btn btn-sm', type: 'button', text: 'Today',
        onClick: () => bulkAction({ action: 'reschedule', dueDate: base }, 'Moved to today.'),
      }),
      el('button', {
        class: 'btn btn-sm', type: 'button', text: 'Tomorrow',
        onClick: () => bulkAction({ action: 'reschedule', dueDate: addDays(base, 1) }, 'Moved to tomorrow.'),
      }),
      el('button', {
        class: 'btn btn-sm', type: 'button', text: 'Priority',
        onClick: (event) =>
          menu(event.currentTarget, ['urgent', 'high', 'medium', 'low'].map((priority) => ({
            label: priority[0].toUpperCase() + priority.slice(1),
            onClick: () => bulkAction({ action: 'priority', priority }, 'Priority updated.'),
          }))),
      }),
      el('button', {
        class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Delete ${selection.size} responsibilities?`,
            message: 'This cannot be undone.',
            confirmLabel: 'Delete', tone: 'danger',
          });
          if (ok) bulkAction({ action: 'delete' }, 'Deleted.');
        },
      }),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'Clear', onClick: () => { selection.clear(); refresh(); } })
    );
  };

  const onSelect = (id, checked) => {
    if (checked) selection.add(id);
    else selection.delete(id);
    paintBulk();
  };

  /* ------------------------------ Layouts ------------------------------ */

  function listLayout() {
    if (!tasks.length) return emptyState();
    if (sort !== 'due' && sort !== 'focus') {
      return el('div', { class: 'card card-flush' }, [
        el('div', { class: 'task-list', style: { padding: '4px 12px' } },
          tasks.map((task) => taskRow(task, { onChanged: refresh, selectable: true, selected: selection.has(task.id), onSelect }))),
      ]);
    }

    const groups = new Map();
    for (const task of tasks) {
      const bucket = bucketOf(task, base);
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push(task);
    }
    const ordered = BUCKET_ORDER.filter((key) => groups.has(key));

    return el('div', { class: 'stack gap-5' },
      ordered.map((bucket) =>
        el('div', { class: 'panel' }, [
          el('div', { class: 'panel-head' }, [
            el('span', { class: 'eyebrow', text: bucket }),
            el('span', { class: 'micro subtle', text: String(groups.get(bucket).length) }),
          ]),
          el('div', { class: 'task-list', style: { padding: '2px 12px' } },
            groups.get(bucket).map((task) =>
              taskRow(task, { onChanged: refresh, selectable: true, selected: selection.has(task.id), onSelect }))),
        ])
      )
    );
  }

  function boardLayout() {
    const board = el('div', { class: 'board' });
    let dragged = null;

    for (const column of STATUS_COLUMNS) {
      const items = tasks.filter((task) => task.status === column.key);
      const body = el('div', { class: 'board-col-body' });

      for (const task of items) {
        const card = taskCard(task, { onChanged: refresh });
        card.addEventListener('dragstart', (event) => {
          dragged = task;
          card.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', task.id);
        });
        card.addEventListener('dragend', () => {
          dragged = null;
          card.classList.remove('dragging');
        });
        body.append(card);
      }

      if (!items.length) {
        body.append(el('p', { class: 'hint', style: { padding: '10px' }, text: 'Nothing here.' }));
      }

      const col = el('div', { class: 'board-col' }, [
        el('div', { class: 'board-col-head' }, [
          el('span', { class: 'eyebrow', text: column.label }),
          el('span', { class: 'micro subtle', text: String(items.length) }),
        ]),
        body,
      ]);

      col.addEventListener('dragover', (event) => {
        event.preventDefault();
        col.classList.add('drop-active');
      });
      col.addEventListener('dragleave', () => col.classList.remove('drop-active'));
      col.addEventListener('drop', async (event) => {
        event.preventDefault();
        col.classList.remove('drop-active');
        const task = dragged;
        if (!task || task.status === column.key) return;
        try {
          if (column.key === 'completed') {
            await api.post(`/tasks/${task.id}/complete`, { done: true });
          } else {
            await api.patch(`/tasks/${task.id}`, { status: column.key });
          }
          tasksChanged({});
          refresh();
        } catch (error) {
          notifyError(error);
        }
      });

      board.append(col);
    }
    return board;
  }

  function timelineLayout() {
    const dated = tasks.filter((task) => task.dueDate).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
    if (!dated.length) return emptyState('Nothing with a date to place on a timeline.');

    const start = dated.reduce((min, t) => (t.startDate && t.startDate < min ? t.startDate : min), dated[0].dueDate);
    const from = start < base ? start : base;
    const to = dated[dated.length - 1].dueDate;
    const span = Math.max(1, daysBetween(from, to) + 1);
    const position = (ymd) => (daysBetween(from, ymd) / span) * 100;

    const scaleMarks = [];
    const stepDays = Math.max(1, Math.round(span / 6));
    for (let i = 0; i <= span; i += stepDays) {
      scaleMarks.push(
        el('span', { style: { flex: '1' }, class: 'micro subtle', text: formatDate(addDays(from, i)) })
      );
    }

    return el('div', { class: 'card' }, [
      el('div', { class: 'tl-row', style: { borderBottom: '1px solid var(--line)', paddingBottom: '8px' } }, [
        el('span', { class: 'eyebrow', text: 'Responsibility' }),
        el('div', { class: 'tl-scale' }, scaleMarks),
      ]),
      el('div', { class: 'timeline' },
        dated.map((task) => {
          const startAt = task.startDate && task.startDate < task.dueDate ? task.startDate : task.dueDate;
          const left = Math.max(0, position(startAt));
          const width = Math.max(1.5, position(task.dueDate) - left + 100 / span);
          const track = el('div', { class: 'tl-track' }, [
            el('div', {
              class: 'tl-bar',
              style: {
                left: `${left}%`,
                width: `${Math.min(100 - left, width)}%`,
                ...(task.overdue ? { borderColor: 'var(--danger)', background: 'var(--danger-wash)' } : {}),
                ...(task.status === 'completed' ? { opacity: '0.55' } : {}),
              },
              title: `${task.title} — ${relativeDate(task.dueDate, base)}`,
            }, [el('span', { class: 'truncate', text: relativeDate(task.dueDate, base) })]),
          ]);
          if (base >= from && base <= to) {
            track.append(el('div', { class: 'tl-today', style: { left: `${position(base)}%` } }));
          }
          return el('div', { class: 'tl-row' }, [
            el('span', { class: 'tl-label truncate', title: task.title, text: task.title }),
            track,
          ]);
        })
      ),
    ]);
  }

  function emptyState(message) {
    const copy = {
      today: { title: 'Your day is clear.', body: 'There are no outstanding responsibilities requiring your attention.' },
      overdue: { title: 'Nothing overdue.', body: 'Everything with a date is still ahead of you.' },
      upcoming: { title: 'Nothing scheduled ahead.', body: 'You have some room to breathe.' },
      important: { title: 'Nothing marked important.', body: 'Mark what matters and it will gather here, urgent or not.' },
      meaningful: { title: 'Nothing linked to an objective yet.', body: 'Connect a responsibility to an objective to see it here.' },
      recurring: { title: 'No recurring responsibilities.', body: 'Rhythms like a weekly review or monthly rent belong here.' },
      completed: { title: 'Nothing completed yet.', body: 'Your completion history will collect here.' },
      unscheduled: { title: 'Nothing waiting without a date.', body: 'Everything open has somewhere to sit.' },
      all: { title: 'Nothing here yet.', body: 'Add the first thing that needs your attention.' },
    }[view] || { title: 'Nothing here.', body: message };

    return el('div', { class: 'card' }, [
      empty({
        iconName: 'inbox',
        title: copy.title,
        body: message || copy.body,
        action: el('button', {
          class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' },
          onClick: () => openQuickAdd({ onSaved: refresh, defaults: { areaId: query.areaId, projectId: query.projectId } }),
        }, [el('span', { text: 'Add a responsibility' })]),
      }),
    ]);
  }

  const content =
    layout === 'board' ? boardLayout() : layout === 'timeline' ? timelineLayout() : listLayout();

  const copy = VIEW_COPY[view];

  return page({
    title: copy.title,
    subtitle: `${copy.subtitle}${tasks.length ? `  ·  ${tasks.length} ${tasks.length === 1 ? 'item' : 'items'}` : ''}`,
    wide: layout !== 'list',
    actions: [
      segmented(
        [
          { value: 'list', icon: 'list', label: 'List' },
          { value: 'board', icon: 'board', label: 'Board' },
          { value: 'timeline', icon: 'timeline', label: 'Timeline' },
        ],
        { value: layout, ariaLabel: 'View', onChange: (v) => setQuery(query, { layout: v }) }
      ),
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onClick: () => openQuickAdd({ onSaved: refresh, defaults: { areaId: query.areaId, projectId: query.projectId } }),
      }, [icon('plus', { size: 15 }), el('span', { text: 'Add' })]),
    ],
    children: [
      el('div', { class: 'stack gap-4', style: { marginBottom: '24px' } }, [viewChips, filterRow]),
      content,
      bulkBar,
    ],
  });
}

export default tasksView;
