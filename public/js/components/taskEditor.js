import api from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { field, modal, notifyError, select, toast } from '../ui.js';
import { loadReference, state } from '../store.js';
import { durationLabel } from '../dates.js';
import { assistantEnabled, suggestButton } from './assistant.js';

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];
const STATUSES = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const REMINDERS = [
  { value: 'none', label: 'No reminder' },
  { value: 'at_time', label: 'At the due time' },
  { value: '5m', label: '5 minutes before' },
  { value: '15m', label: '15 minutes before' },
  { value: '30m', label: '30 minutes before' },
  { value: '1h', label: '1 hour before' },
  { value: '2h', label: '2 hours before' },
  { value: '1d', label: '1 day before' },
  { value: '2d', label: '2 days before' },
  { value: '1w', label: '1 week before' },
];
const RECURRENCES = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'monthly_date', label: 'On a set day each month' },
  { value: 'quarterly', label: 'Every quarter' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom interval' },
];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const blankTask = () => ({
  title: '', description: '', notes: '', startDate: null, dueDate: null, dueTime: null,
  priority: state.user?.defaultPriority || 'medium', important: false, meaningful: false,
  status: 'not_started', tags: [], links: [], recurrence: null, recurrenceEnd: null,
  reminder: state.user?.defaultReminder || 'none',
  estimatedMinutes: state.user?.defaultDuration ?? null, actualMinutes: null,
  areaId: null, projectId: null, objectiveId: null, milestoneId: null, subtasks: [],
});

/**
 * The full editor for a responsibility. Everything the data model supports is
 * reachable here; the surface is organised so the common path (title, when,
 * how it matters) sits above the detail.
 */
export async function openTaskEditor({ taskId = null, draft = {}, focus = null, onSaved } = {}) {
  await loadReference().catch(() => {});

  let task = { ...blankTask(), ...draft };
  let subtasks = [];

  if (taskId) {
    try {
      const result = await api.get(`/tasks/${taskId}`);
      task = { ...blankTask(), ...result.task };
      subtasks = result.task.subtasks ?? [];
    } catch (error) {
      notifyError(error);
      return;
    }
  } else {
    subtasks = (draft.subtasks ?? []).map((title, index) => ({
      id: `new-${index}`, title, done: false, isNew: true,
    }));
  }

  const values = { ...task };
  let recurrenceFreq = task.recurrence?.freq || '';
  let recurrenceWeekdays = task.recurrence?.weekdays ?? [];
  let recurrenceDay = task.recurrence?.day ?? 1;
  let recurrenceEvery = task.recurrence?.every ?? 2;
  let recurrenceUnit = task.recurrence?.unit ?? 'day';
  let saving = false;

  const input = (props) => el('input', { class: 'input', ...props });

  /** What the editor currently knows, so suggestions fit the surrounding work. */
  const suggestionContext = () => ({
    areaId: values.areaId || undefined,
    projectId: values.projectId || undefined,
    objectiveId: values.objectiveId || undefined,
    dueDate: values.dueDate || undefined,
  });

  /**
   * A field with a "Suggest" control beside its label. The suggestions appear
   * beneath the field and are only applied when one is chosen.
   */
  const assistedField = (labelText, control, { kind, getInput, onPick, hint, label }) => {
    if (!assistantEnabled()) return field(labelText, control, hint);
    const { button, list } = suggestButton({
      kind, getInput, getContext: suggestionContext, onPick, label,
    });
    return el('div', { class: 'field' }, [
      el('div', { class: 'field-head' }, [el('span', { class: 'label', text: labelText }), button]),
      control,
      list,
      hint ? el('p', { class: 'hint', text: hint }) : null,
    ]);
  };

  const titleInput = input({
    value: values.title, placeholder: 'What needs your attention?',
    dataset: { autofocus: focus ? undefined : '' }, maxlength: '200',
    onInput: (e) => { values.title = e.target.value; },
  });
  const descInput = el('textarea', {
    class: 'textarea', placeholder: 'Add any detail that will help you start.',
    style: { minHeight: '72px' }, maxlength: '4000',
    onInput: (e) => { values.description = e.target.value; },
  }, values.description || '');

  const startInput = input({
    type: 'date', value: values.startDate || '',
    onChange: (e) => { values.startDate = e.target.value || null; },
  });
  const dueInput = input({
    type: 'date', value: values.dueDate || '',
    onChange: (e) => { values.dueDate = e.target.value || null; },
  });
  const timeInput = input({
    type: 'time', value: values.dueTime || '',
    onChange: (e) => { values.dueTime = e.target.value || null; },
  });

  const prioritySelect = select(PRIORITIES, {
    value: values.priority, ariaLabel: 'Priority', onChange: (v) => { values.priority = v; },
  });
  const statusSelect = select(STATUSES, {
    value: values.status, ariaLabel: 'Status', onChange: (v) => { values.status = v; },
  });

  const areaSelect = select(
    [{ value: '', label: 'No area' }, ...state.areas.map((a) => ({ value: a.id, label: a.name }))],
    { value: values.areaId || '', ariaLabel: 'Area of life', onChange: (v) => { values.areaId = v || null; } }
  );

  const projectSelect = select(
    [{ value: '', label: 'No project' }, ...state.projects.map((p) => ({ value: p.id, label: p.name }))],
    { value: values.projectId || '', ariaLabel: 'Project', onChange: (v) => { values.projectId = v || null; } }
  );

  const objectiveSelect = select(
    [{ value: '', label: 'No objective' }, ...state.objectives.map((o) => ({ value: o.id, label: o.title }))],
    {
      value: values.objectiveId || '',
      ariaLabel: 'Objective',
      onChange: (v) => {
        values.objectiveId = v || null;
        values.milestoneId = null;
        renderMilestoneOptions();
      },
    }
  );

  const milestoneSelect = select([{ value: '', label: 'No milestone' }], {
    value: '', ariaLabel: 'Milestone', onChange: (v) => { values.milestoneId = v || null; },
  });

  function renderMilestoneOptions() {
    const objective = state.objectives.find((o) => o.id === values.objectiveId);
    const options = [
      { value: '', label: objective ? 'No milestone' : 'Choose an objective first' },
      ...(objective?.milestones ?? []).map((m) => ({ value: m.id, label: m.title })),
    ];
    clear(milestoneSelect);
    for (const option of options) {
      milestoneSelect.append(
        el('option', { value: option.value, text: option.label, selected: option.value === (values.milestoneId || '') })
      );
    }
    milestoneSelect.disabled = !objective;
  }
  renderMilestoneOptions();

  const importantToggle = el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox', checked: values.important,
      onChange: (e) => { values.important = e.target.checked; },
    }),
    el('span', { class: 'small', text: 'Important' }),
  ]);
  const meaningfulToggle = el('label', { class: 'switch' }, [
    el('input', {
      type: 'checkbox', checked: values.meaningful,
      onChange: (e) => { values.meaningful = e.target.checked; },
    }),
    el('span', { class: 'small', text: 'Meaningful' }),
  ]);

  const reminderSelect = select(REMINDERS, {
    value: values.reminder, ariaLabel: 'Reminder', onChange: (v) => { values.reminder = v; },
  });

  const durationInput = input({
    type: 'number', min: '0', max: '1440', step: '5',
    value: values.estimatedMinutes ?? '',
    onChange: (e) => { values.estimatedMinutes = e.target.value === '' ? null : Number(e.target.value); },
  });

  const tagsInput = input({
    value: (values.tags ?? []).join(', '),
    placeholder: 'deep-work, review',
    onChange: (e) => {
      values.tags = e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 24);
    },
  });

  /* ------------------------------ Recurrence ----------------------------- */

  const recurrenceDetail = el('div', { class: 'stack gap-3' });
  const recurrenceSelect = select(RECURRENCES, {
    value: recurrenceFreq, ariaLabel: 'Recurrence',
    onChange: (v) => { recurrenceFreq = v; renderRecurrenceDetail(); },
  });
  const recurrenceEndInput = input({
    type: 'date', value: values.recurrenceEnd || '',
    onChange: (e) => { values.recurrenceEnd = e.target.value || null; },
  });

  function renderRecurrenceDetail() {
    clear(recurrenceDetail);
    if (!recurrenceFreq) return;

    if (recurrenceFreq === 'weekly' || recurrenceFreq === 'biweekly') {
      const row = el('div', { class: 'row gap-2 wrap' });
      WEEKDAY_LABELS.forEach((label, day) => {
        const active = recurrenceWeekdays.includes(day);
        row.append(
          el('button', {
            type: 'button',
            class: 'choice',
            style: { padding: '6px 0', justifyContent: 'center', minWidth: '38px', flex: '0 0 38px' },
            'aria-pressed': String(active),
            'aria-label': WEEKDAY_NAMES[day],
            text: label,
            onClick: (event) => {
              recurrenceWeekdays = active
                ? recurrenceWeekdays.filter((d) => d !== day)
                : [...recurrenceWeekdays, day].sort();
              event.currentTarget.setAttribute('aria-pressed', String(!active));
              renderRecurrenceDetail();
            },
          })
        );
      });
      recurrenceDetail.append(
        field('Repeat on', row, recurrenceWeekdays.length ? '' : 'Leave empty to repeat on the same weekday as the due date.')
      );
    }

    if (recurrenceFreq === 'monthly_date') {
      recurrenceDetail.append(
        field('Day of month', input({
          type: 'number', min: '1', max: '31', value: String(recurrenceDay),
          onChange: (e) => { recurrenceDay = Math.min(31, Math.max(1, Number(e.target.value) || 1)); },
        }))
      );
    }

    if (recurrenceFreq === 'custom') {
      recurrenceDetail.append(
        el('div', { class: 'row gap-3' }, [
          el('div', { class: 'grow' }, [
            field('Every', input({
              type: 'number', min: '1', max: '365', value: String(recurrenceEvery),
              onChange: (e) => { recurrenceEvery = Math.max(1, Number(e.target.value) || 1); },
            })),
          ]),
          el('div', { class: 'grow' }, [
            field('Unit', select(
              [
                { value: 'day', label: 'Days' }, { value: 'week', label: 'Weeks' },
                { value: 'month', label: 'Months' }, { value: 'year', label: 'Years' },
              ],
              { value: recurrenceUnit, onChange: (v) => { recurrenceUnit = v; } }
            )),
          ]),
        ])
      );
    }

    recurrenceDetail.append(field('Ends on', recurrenceEndInput, 'Leave empty to repeat indefinitely.'));
  }
  renderRecurrenceDetail();

  /* ------------------------------- Subtasks ------------------------------ */

  const subtaskList = el('div', { class: 'stack gap-2' });
  const subtaskInput = input({
    placeholder: 'Add a step and press Enter',
    onKeydown: async (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const title = event.target.value.trim();
      if (!title) return;
      event.target.value = '';
      if (taskId) {
        try {
          const result = await api.post(`/tasks/${taskId}/subtasks`, { title });
          subtasks.push(result.subtask);
        } catch (error) {
          notifyError(error);
          return;
        }
      } else {
        subtasks.push({ id: `new-${subtasks.length}`, title, done: false, isNew: true });
      }
      renderSubtasks();
    },
  });

  function renderSubtasks() {
    clear(subtaskList);
    if (!subtasks.length) {
      subtaskList.append(el('p', { class: 'hint', text: 'Break this into steps if that would help you begin.' }));
    }
    for (const sub of subtasks) {
      subtaskList.append(
        el('div', { class: 'row gap-3' }, [
          el('label', { class: 'checkbox grow' }, [
            el('input', {
              type: 'checkbox', checked: sub.done,
              onChange: async (event) => {
                sub.done = event.target.checked;
                if (!sub.isNew && taskId) {
                  try {
                    await api.patch(`/tasks/${taskId}/subtasks/${sub.id}`, { done: sub.done });
                  } catch (error) {
                    notifyError(error);
                  }
                }
              },
            }),
            el('span', { class: 'checkbox-label', text: sub.title }),
          ]),
          el('button', {
            class: 'btn-icon sm', type: 'button', 'aria-label': `Remove ${sub.title}`,
            onClick: async () => {
              if (!sub.isNew && taskId) {
                try {
                  await api.del(`/tasks/${taskId}/subtasks/${sub.id}`);
                } catch (error) {
                  notifyError(error);
                  return;
                }
              }
              subtasks = subtasks.filter((s) => s.id !== sub.id);
              renderSubtasks();
            },
          }, [icon('close', { size: 14 })]),
        ])
      );
    }
  }
  renderSubtasks();

  /* --------------------------------- Links ------------------------------- */

  const linksInput = input({
    value: (values.links ?? []).map((l) => l.url).join('\n'),
    placeholder: 'https://…',
    onChange: (e) => {
      values.links = e.target.value
        .split(/[\n,\s]+/)
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((url) => ({ label: '', url }));
    },
  });

  const notesInput = el('textarea', {
    class: 'textarea', placeholder: 'Private notes for yourself.', maxlength: '20000',
    onInput: (e) => { values.notes = e.target.value; },
  }, values.notes || '');

  /* ------------------------------ Disclosure ----------------------------- */

  const detailsWrap = el('div', { class: 'stack gap-5', style: { display: focus ? 'flex' : 'none' } });
  const detailsToggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    'aria-expanded': String(Boolean(focus)),
    onClick: (event) => {
      const open = detailsWrap.style.display !== 'none';
      detailsWrap.style.display = open ? 'none' : 'flex';
      event.currentTarget.setAttribute('aria-expanded', String(!open));
      clear(event.currentTarget);
      event.currentTarget.append(
        icon(open ? 'chevronDown' : 'chevronUp', { size: 15 }),
        el('span', { text: open ? 'More detail' : 'Less detail' })
      );
    },
  }, [icon(focus ? 'chevronUp' : 'chevronDown', { size: 15 }), el('span', { text: focus ? 'Less detail' : 'More detail' })]);

  detailsWrap.append(
    el('div', { class: 'grid grid-2' }, [
      field('Status', statusSelect),
      field('Reminder', reminderSelect),
    ]),
    el('div', { class: 'grid grid-2' }, [
      field('Objective', objectiveSelect),
      field('Milestone', milestoneSelect),
    ]),
    el('div', { class: 'grid grid-2' }, [
      field('Start date', startInput),
      field('Estimated duration (minutes)', durationInput, values.estimatedMinutes ? durationLabel(values.estimatedMinutes) : ''),
    ]),
    field('Repeats', recurrenceSelect),
    recurrenceDetail,
    assistedField('Tags', tagsInput, {
      kind: 'tags',
      hint: 'Separate with commas.',
      getInput: () => values.title,
      onPick: (suggestion) => {
        const next = [...new Set([...(values.tags ?? []), suggestion])].slice(0, 24);
        values.tags = next;
        tagsInput.value = next.join(', ');
      },
    }),
    field('Links', linksInput, 'One web address per line.'),
    field('Notes', notesInput),
    assistedField('Steps', el('div', { class: 'stack gap-2' }, [subtaskList, subtaskInput]), {
      kind: 'subtasks',
      label: 'Suggest steps',
      getInput: () => values.title,
      onPick: async (suggestion) => {
        if (taskId) {
          try {
            const result = await api.post(`/tasks/${taskId}/subtasks`, { title: suggestion });
            subtasks.push(result.subtask);
          } catch (error) {
            notifyError(error);
            return;
          }
        } else {
          subtasks.push({ id: `new-${subtasks.length}`, title: suggestion, done: false, isNew: true });
        }
        renderSubtasks();
      },
    })
  );

  const body = el('div', { class: 'stack gap-5' }, [
    assistedField('Title', titleInput, {
      kind: 'title',
      getInput: () => values.title,
      onPick: (suggestion) => {
        values.title = suggestion;
        titleInput.value = suggestion;
        titleInput.removeAttribute('aria-invalid');
      },
    }),
    assistedField('Description', descInput, {
      kind: 'description',
      getInput: () => values.title,
      onPick: (suggestion) => {
        values.description = suggestion;
        descInput.value = suggestion;
      },
    }),
    el('div', { class: 'grid grid-3' }, [
      field('Due date', dueInput),
      field('Due time', timeInput),
      field('Priority', prioritySelect),
    ]),
    el('div', { class: 'grid grid-2' }, [
      field('Area of life', areaSelect),
      field('Project', projectSelect),
    ]),
    el('div', { class: 'row gap-6 wrap' }, [
      importantToggle,
      meaningfulToggle,
    ]),
    el('p', { class: 'hint', text: 'Important means it matters to an outcome you care about. Meaningful means it moves a long-term objective, even without a deadline.' }),
    el('div', { class: 'row' }, [detailsToggle]),
    detailsWrap,
  ]);

  const saveButton = el('button', { class: 'btn btn-primary', type: 'button', text: taskId ? 'Save changes' : 'Add responsibility' });

  const instance = modal({
    title: taskId ? 'Edit responsibility' : 'New responsibility',
    size: 'modal-lg',
    body,
    footer: (close) => [
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
      saveButton,
    ],
  });

  saveButton.addEventListener('click', async () => {
    if (saving) return;
    if (!values.title.trim()) {
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
      toast('Give this responsibility a title.', { tone: 'danger' });
      return;
    }
    saving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';

    const recurrence = recurrenceFreq
      ? {
          freq: recurrenceFreq,
          ...(recurrenceFreq === 'weekly' || recurrenceFreq === 'biweekly' ? { weekdays: recurrenceWeekdays } : {}),
          ...(recurrenceFreq === 'monthly_date' ? { day: recurrenceDay } : {}),
          ...(recurrenceFreq === 'custom' ? { every: recurrenceEvery, unit: recurrenceUnit } : {}),
        }
      : null;

    const payload = {
      title: values.title.trim(),
      description: values.description || '',
      notes: values.notes || '',
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      dueTime: values.dueTime || null,
      priority: values.priority,
      important: values.important,
      meaningful: values.meaningful,
      status: values.status,
      tags: values.tags ?? [],
      links: values.links ?? [],
      recurrence,
      recurrenceEnd: values.recurrenceEnd || null,
      reminder: values.reminder,
      estimatedMinutes: values.estimatedMinutes,
      areaId: values.areaId || null,
      projectId: values.projectId || null,
      objectiveId: values.objectiveId || null,
      milestoneId: values.milestoneId || null,
    };

    try {
      if (taskId) {
        await api.patch(`/tasks/${taskId}`, payload);
        toast('Saved.');
      } else {
        await api.post('/tasks', { ...payload, subtasks: subtasks.map((s) => s.title) });
        toast('Added.');
      }
      instance.close();
      document.dispatchEvent(new CustomEvent('telos:tasks-changed', { detail: { taskId } }));
      onSaved?.();
    } catch (error) {
      notifyError(error);
      saving = false;
      saveButton.disabled = false;
      saveButton.textContent = taskId ? 'Save changes' : 'Add responsibility';
    }
  });

  if (focus === 'recurrence') recurrenceSelect.focus();
  return instance;
}

export default openTaskEditor;
