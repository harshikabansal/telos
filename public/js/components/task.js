import api from '../api.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { chip, confirmDialog, menu, notifyError, toast } from '../ui.js';
import {
  durationLabel, formatTime, overdueLabel, relativeDate, today,
} from '../dates.js';
import { areaById, projectById, state } from '../store.js';
import { openTaskEditor } from './taskEditor.js';

/** Views listen for this to refresh after any change to a responsibility. */
export const tasksChanged = (detail = {}) =>
  document.dispatchEvent(new CustomEvent('telos:tasks-changed', { detail }));

const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };

export async function completeTask(task, done = true) {
  try {
    const result = await api.post(`/tasks/${task.id}/complete`, { done });
    if (done) {
      const count = result.completedToday;
      if (result.recurredTo) {
        toast(`Completed. Next occurrence ${relativeDate(result.recurredTo).toLowerCase()}.`);
      } else {
        toast(
          count === 1
            ? '1 responsibility completed today.'
            : `${count} responsibilities completed today.`
        );
      }
    }
    tasksChanged({ taskId: task.id, done });
    return result;
  } catch (error) {
    notifyError(error);
    tasksChanged({ taskId: task.id });
    return null;
  }
}

export async function deleteTask(task) {
  const ok = await confirmDialog({
    title: 'Delete this responsibility?',
    message: `"${task.title}" will be removed permanently, along with its subtasks.`,
    confirmLabel: 'Delete',
    tone: 'danger',
  });
  if (!ok) return false;
  try {
    await api.del(`/tasks/${task.id}`);
    toast('Responsibility deleted.');
    tasksChanged({ taskId: task.id, deleted: true });
    return true;
  } catch (error) {
    notifyError(error);
    return false;
  }
}

async function patchTask(task, body, message) {
  try {
    await api.patch(`/tasks/${task.id}`, body);
    if (message) toast(message);
    tasksChanged({ taskId: task.id });
  } catch (error) {
    notifyError(error);
  }
}

async function reschedule(task, preset) {
  try {
    await api.post(`/tasks/${task.id}/reschedule`, { preset });
    toast(preset === 'clear' ? 'Date removed.' : `Moved to ${preset.replace('_', ' ')}.`);
    tasksChanged({ taskId: task.id });
  } catch (error) {
    notifyError(error);
  }
}

export function taskMenu(anchor, task, { onChanged } = {}) {
  const after = () => onChanged?.();
  menu(anchor, [
    { label: 'Edit', icon: 'edit', onClick: () => openTaskEditor({ taskId: task.id, onSaved: after }) },
    {
      label: task.status === 'completed' ? 'Mark not started' : 'Complete',
      icon: 'check',
      onClick: () => completeTask(task, task.status !== 'completed'),
    },
    {
      label: task.important ? 'Remove importance' : 'Mark important',
      icon: 'important',
      onClick: () => patchTask(task, { important: !task.important }, task.important ? 'No longer marked important.' : 'Marked important.'),
    },
    { separator: true },
    { label: 'Reschedule' },
    { label: 'Today', icon: 'calendar', onClick: () => reschedule(task, 'today') },
    { label: 'Tomorrow', icon: 'arrowRight', onClick: () => reschedule(task, 'tomorrow') },
    { label: 'Next week', icon: 'arrowRight', onClick: () => reschedule(task, 'next_week') },
    task.dueDate ? { label: 'Remove date', icon: 'close', onClick: () => reschedule(task, 'clear') } : null,
    { separator: true },
    { label: 'Priority' },
    ...['urgent', 'high', 'medium', 'low'].map((priority) => ({
      label: PRIORITY_LABEL[priority],
      checked: task.priority === priority,
      onClick: () => patchTask(task, { priority }, `Priority set to ${PRIORITY_LABEL[priority].toLowerCase()}.`),
    })),
    { separator: true },
    {
      label: 'Duplicate',
      icon: 'copy',
      onClick: async () => {
        try {
          await api.post(`/tasks/${task.id}/duplicate`);
          toast('Duplicated.');
          tasksChanged({});
        } catch (error) {
          notifyError(error);
        }
      },
    },
    {
      label: task.recurrence ? 'Edit recurrence' : 'Make recurring',
      icon: 'recurring',
      onClick: () => openTaskEditor({ taskId: task.id, focus: 'recurrence', onSaved: after }),
    },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteTask(task) },
  ]);
}

/**
 * A single responsibility. The meta line is the product's point of view in
 * miniature: when it is due, what it belongs to, and how it is classified —
 * with urgency and importance shown as different things.
 */
export function taskRow(task, options = {}) {
  const {
    showProject = true,
    showArea = true,
    selectable = false,
    selected = false,
    onSelect,
    onChanged,
    compact = false,
  } = options;

  const done = task.status === 'completed';
  const base = today();

  const checkbox = el('button', {
    class: `task-check${task.priority === 'urgent' && !done ? ' urgent' : ''}`,
    type: 'button',
    role: 'checkbox',
    'aria-checked': String(done),
    'aria-label': done ? `Mark "${task.title}" as not started` : `Complete "${task.title}"`,
    dataset: { done: String(done) },
  });

  const row = el('div', {
    class: `task-row${selected ? ' selected' : ''}`,
    dataset: { taskId: task.id },
  });

  checkbox.addEventListener('click', async () => {
    const next = !done;
    checkbox.dataset.done = String(next);
    checkbox.setAttribute('aria-checked', String(next));
    if (next) {
      title.classList.add('done');
      row.classList.add('is-completing');
    }
    await completeTask(task, next);
    onChanged?.();
  });

  const title = el('button', {
    class: `task-title${done ? ' done' : ''}`,
    type: 'button',
    text: task.title,
    onClick: () => openTaskEditor({ taskId: task.id, onSaved: onChanged }),
  });

  const meta = [];
  if (task.dueDate) {
    const isOverdue = !done && task.dueDate < base;
    const isToday = task.dueDate === base;
    meta.push(
      el('span', {
        class: isOverdue ? 'overdue' : isToday ? 'today' : '',
        text: isOverdue
          ? overdueLabel(task.dueDate, base)
          : relativeDate(task.dueDate, base) + (task.dueTime ? ` · ${formatTime(task.dueTime)}` : ''),
      })
    );
  } else if (task.dueTime) {
    meta.push(el('span', { text: formatTime(task.dueTime) }));
  }

  if (task.priority && task.priority !== 'medium') {
    meta.push(el('span', { class: `prio ${task.priority}`, text: PRIORITY_LABEL[task.priority] }));
  }
  if (task.important) {
    meta.push(el('span', { class: 'row gap-1' }, [icon('important', { size: 11 }), el('span', { text: 'Important' })]));
  }
  if (task.status === 'in_progress') meta.push(el('span', { text: 'In progress' }));

  const project = task.projectName || projectById(task.projectId)?.name;
  if (showProject && project) {
    meta.push(el('span', { class: 'row gap-1' }, [icon('projects', { size: 11 }), el('span', { text: project })]));
  }
  const area = task.areaName || areaById(task.areaId)?.name;
  if (showArea && area && !compact) meta.push(el('span', { text: area }));

  if (task.subtaskTotal > 0) {
    meta.push(
      el('span', { class: 'subtask-line' }, [
        icon('tasks', { size: 11 }),
        el('span', { text: `${task.subtaskDone}/${task.subtaskTotal}` }),
      ])
    );
  }
  if (task.recurrence) {
    meta.push(
      el('span', { class: 'row gap-1', title: task.recurrenceLabel || 'Recurring' }, [
        icon('recurring', { size: 11 }),
        el('span', { text: compact ? '' : task.recurrenceLabel || 'Recurring' }),
      ])
    );
  }
  if (task.reminder && task.reminder !== 'none' && !compact) {
    meta.push(el('span', { class: 'row gap-1' }, [icon('bell', { size: 11 })]));
  }
  if (task.estimatedMinutes && !compact) {
    meta.push(el('span', { text: durationLabel(task.estimatedMinutes) }));
  }
  for (const tag of task.tags ?? []) meta.push(el('span', { class: 'tag', text: tag }));

  const metaRow = meta.length
    ? el('div', { class: 'task-meta' }, meta.flatMap((node, index) =>
        index === 0 ? [node] : [el('i', { class: 'dot' }), node]
      ))
    : null;

  const moreButton = el('button', {
    class: 'btn-icon sm',
    type: 'button',
    'aria-label': `Options for ${task.title}`,
    onClick: (event) => {
      event.stopPropagation();
      taskMenu(event.currentTarget, task, { onChanged });
    },
  }, [icon('more', { size: 16 })]);

  row.append(
    selectable
      ? el('input', {
          type: 'checkbox',
          class: 'row-select',
          checked: selected,
          'aria-label': `Select ${task.title}`,
          style: { marginTop: '4px' },
          onChange: (event) => onSelect?.(task.id, event.target.checked),
        })
      : '',
    checkbox,
    el('div', { class: 'task-body' }, [title, metaRow]),
    el('div', { class: 'task-actions' }, [moreButton])
  );

  return row;
}

/** Compact card used by the board and calendar surfaces. */
export function taskCard(task, { onChanged } = {}) {
  const base = today();
  const card = el('div', { class: 'board-card', draggable: 'true', dataset: { taskId: task.id } }, [
    el('button', {
      class: 'board-card-title',
      type: 'button',
      text: task.title,
      onClick: () => openTaskEditor({ taskId: task.id, onSaved: onChanged }),
      style: { textAlign: 'left', display: 'block', width: '100%' },
    }),
    el('div', { class: 'row gap-2 wrap' }, [
      task.dueDate
        ? chip(relativeDate(task.dueDate, base), { tone: task.dueDate < base && task.status !== 'completed' ? 'danger' : '' })
        : null,
      task.priority !== 'medium' ? el('span', { class: `prio ${task.priority}`, text: PRIORITY_LABEL[task.priority] }) : null,
      task.important ? chip('Important', { tone: 'accent' }) : null,
      task.subtaskTotal ? chip(`${task.subtaskDone}/${task.subtaskTotal}`) : null,
    ]),
  ]);
  return card;
}

export { openTaskEditor };
