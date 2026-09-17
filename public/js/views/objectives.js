import api from '../api.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import {
  chip, confirmDialog, empty, field, menu, meter, modal, notifyError, ring, select, toast,
} from '../ui.js';
import { formatDate, relativeDate, today } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { invalidateReference, loadReference, state } from '../store.js';
import { page } from '../shell.js';
import { taskRow } from '../components/task.js';
import { openQuickAdd } from '../components/quickAdd.js';
import { openProjectEditor } from './projects.js';
import { assistantEnabled, suggestButton } from '../components/assistant.js';

const HORIZONS = [
  { value: 'year', label: 'Yearly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'month', label: 'Monthly' },
  { value: 'life', label: 'Long horizon' },
];
const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];
const PRIORITIES = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
];

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

export async function openObjectiveEditor({ objectiveId = null, onSaved } = {}) {
  await loadReference().catch(() => {});
  let existing = null;
  if (objectiveId) {
    try {
      existing = (await api.get(`/objectives/${objectiveId}`)).objective;
    } catch (error) {
      notifyError(error);
      return;
    }
  }

  const values = {
    title: existing?.title ?? '',
    description: existing?.description ?? '',
    horizon: existing?.horizon ?? 'year',
    deadline: existing?.deadline ?? '',
    status: existing?.status ?? 'active',
    priority: existing?.priority ?? 'medium',
    areaId: existing?.areaId ?? '',
    progressMode: existing?.progressMode ?? 'auto',
    progressManual: existing?.progressManual ?? 0,
  };

  const input = (props) => el('input', { class: 'input', ...props });
  const titleInput = input({
    value: values.title, dataset: { autofocus: '' },
    placeholder: 'What are you moving toward?',
    onInput: (e) => { values.title = e.target.value; },
  });
  const milestonesInput = el('textarea', {
    class: 'textarea', style: { minHeight: '86px' },
    placeholder: 'One milestone per line',
  });

  const objectiveContext = () => ({ areaId: values.areaId || undefined });
  const assisted = (labelText, control, options) => {
    if (!assistantEnabled()) return field(labelText, control, options.hint);
    const { button, list } = suggestButton({ ...options, getContext: objectiveContext });
    return el('div', { class: 'field' }, [
      el('div', { class: 'field-head' }, [el('span', { class: 'label', text: labelText }), button]),
      control,
      list,
      options.hint ? el('p', { class: 'hint', text: options.hint }) : null,
    ]);
  };
  const manualInput = input({
    type: 'range', min: '0', max: '100', step: '5', value: String(values.progressManual),
    onInput: (e) => { values.progressManual = Number(e.target.value); manualLabel.textContent = `${e.target.value}%`; },
  });
  const manualLabel = el('span', { class: 'small mono', text: `${values.progressManual}%` });
  const manualRow = el('div', {
    class: 'row gap-3',
    style: { display: values.progressMode === 'manual' ? 'flex' : 'none' },
  }, [manualInput, manualLabel]);

  modal({
    title: existing ? 'Edit objective' : 'New objective',
    subtitle: existing ? null : 'What are you moving toward?',
    body: el('div', { class: 'stack gap-4' }, [
      assisted('Objective', titleInput, {
        kind: 'objective-title',
        getInput: () => values.title,
        onPick: (suggestion) => {
          values.title = suggestion;
          titleInput.value = suggestion;
          titleInput.removeAttribute('aria-invalid');
        },
      }),
      field('Description', el('textarea', {
        class: 'textarea', style: { minHeight: '64px' },
        placeholder: 'Why does this matter to you?',
        onInput: (e) => { values.description = e.target.value; },
      }, values.description)),
      el('div', { class: 'grid grid-3' }, [
        field('Horizon', select(HORIZONS, { value: values.horizon, onChange: (v) => { values.horizon = v; } })),
        field('Deadline', input({ type: 'date', value: values.deadline || '', onChange: (e) => { values.deadline = e.target.value; } })),
        field('Priority', select(PRIORITIES, { value: values.priority, onChange: (v) => { values.priority = v; } })),
      ]),
      el('div', { class: 'grid grid-2' }, [
        field('Area of life', select(
          [{ value: '', label: 'No area' }, ...state.areas.map((a) => ({ value: a.id, label: a.name }))],
          { value: values.areaId, ariaLabel: 'Area', onChange: (v) => { values.areaId = v; } }
        )),
        field('Status', select(STATUSES, { value: values.status, onChange: (v) => { values.status = v; } })),
      ]),
      field(
        'Progress',
        select(
          [
            { value: 'auto', label: 'Calculated from milestones and projects' },
            { value: 'manual', label: 'Set it myself' },
          ],
          {
            value: values.progressMode,
            onChange: (v) => {
              values.progressMode = v;
              manualRow.style.display = v === 'manual' ? 'flex' : 'none';
            },
          }
        )
      ),
      manualRow,
      existing ? null : assisted('Milestones', milestonesInput, {
        kind: 'milestones',
        hint: 'Optional. The markers on the way there.',
        getInput: () => values.title,
        onPick: (suggestion) => {
          const lines = milestonesInput.value.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!lines.includes(suggestion)) lines.push(suggestion);
          milestonesInput.value = lines.join('\n');
        },
      }),
    ]),
    footer: (close) => [
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: existing ? 'Save changes' : 'Create objective',
        onClick: async (event) => {
          if (!values.title.trim()) {
            titleInput.setAttribute('aria-invalid', 'true');
            titleInput.focus();
            return;
          }
          // Captured now: `currentTarget` is null once an await resumes.
          const button = event.currentTarget;
          button.disabled = true;
          const payload = {
            title: values.title.trim(),
            description: values.description,
            horizon: values.horizon,
            deadline: values.deadline || null,
            status: values.status,
            priority: values.priority,
            areaId: values.areaId || null,
            progressMode: values.progressMode,
            progressManual: values.progressManual,
          };
          try {
            if (existing) {
              await api.patch(`/objectives/${existing.id}`, payload);
              toast('Objective updated.');
            } else {
              const milestones = milestonesInput.value.split('\n').map((t) => t.trim()).filter(Boolean);
              await api.post('/objectives', { ...payload, milestones });
              toast('Objective created.');
            }
            invalidateReference();
            await loadReference({ force: true });
            close();
            onSaved?.();
          } catch (error) {
            notifyError(error);
            button.disabled = false;
          }
        },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ *
 * List
 * ------------------------------------------------------------------ */

export async function objectivesView({ query = {} } = {}) {
  const data = await api.get('/objectives', { status: query.status, includeMilestones: 'true' });
  const base = today();
  const refresh = async () => {
    invalidateReference();
    await loadReference({ force: true }).catch(() => {});
    navigate(`/objectives${buildQuery(query)}`, { replace: true });
  };

  const card = (objective) =>
    el('div', { class: 'card' }, [
      el('div', { class: 'row gap-4', style: { alignItems: 'flex-start' } }, [
        el('div', { class: 'grow stack gap-3' }, [
          el('div', { class: 'row gap-2 wrap' }, [
            el('span', { class: 'eyebrow', text: HORIZONS.find((h) => h.value === objective.horizon)?.label ?? objective.horizon }),
            objective.areaName ? el('span', { class: 'micro subtle', text: objective.areaName }) : null,
            objective.status !== 'active' ? chip(STATUSES.find((s) => s.value === objective.status)?.label ?? objective.status) : null,
          ]),
          el('a', { href: `#/objectives/${objective.id}` }, [
            el('h3', { text: objective.title, style: { fontSize: '1.125rem' } }),
          ]),
          objective.description ? el('p', { class: 'small muted', text: objective.description }) : null,
          el('div', { class: 'row gap-3 wrap' }, [
            el('span', { class: 'micro muted', text: `${objective.progress}% complete` }),
            objective.deadline
              ? el('span', { class: 'micro subtle', text: `by ${formatDate(objective.deadline, { month: 'long', day: 'numeric', year: 'numeric' })}` })
              : null,
          ]),
          meter(objective.progress),
          objective.milestones?.length
            ? el('div', { class: 'stack gap-2', style: { marginTop: '8px' } },
                objective.milestones.slice(0, 4).map((milestone) =>
                  el('div', { class: 'row gap-3' }, [
                    icon(milestone.status === 'completed' ? 'check' : 'milestone', { size: 14 }),
                    el('span', {
                      class: 'small grow truncate',
                      style: milestone.status === 'completed' ? { color: 'var(--ink-4)', textDecoration: 'line-through' } : {},
                      text: milestone.title,
                    }),
                    el('span', { class: 'micro subtle', text: `${milestone.progress}%` }),
                  ])
                )
              )
            : null,
        ]),
        el('div', { class: 'stack gap-2', style: { alignItems: 'center' } }, [
          ring(objective.progress, 46),
          el('button', {
            class: 'btn-icon sm', type: 'button', 'aria-label': `Options for ${objective.title}`,
            onClick: (event) => objectiveMenu(event.currentTarget, objective, refresh),
          }, [icon('more', { size: 16 })]),
        ]),
      ]),
    ]);

  const active = data.objectives.filter((o) => o.status === 'active');
  const other = data.objectives.filter((o) => o.status !== 'active');

  return page({
    title: 'Objectives',
    subtitle: data.objectives.length
      ? 'What you are moving toward, and how far along it is.'
      : 'An objective is an outcome you want to reach, not another item to check off.',
    actions: [
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onClick: () => openObjectiveEditor({ onSaved: refresh }),
      }, [icon('plus', { size: 15 }), el('span', { text: 'New objective' })]),
    ],
    children: data.objectives.length
      ? [
          el('div', { class: 'grid grid-2' }, active.map(card)),
          other.length
            ? el('section', { class: 'section', style: { marginTop: '40px' } }, [
                el('div', { class: 'section-head' }, [
                  el('div', { class: 'section-title' }, [
                    el('h2', { text: 'Not active', style: { fontSize: '1.125rem' } }),
                    el('span', { class: 'count-chip', text: String(other.length) }),
                  ]),
                ]),
                el('div', { class: 'grid grid-2' }, other.map(card)),
              ])
            : null,
        ]
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'objectives',
            title: 'What are you moving toward?',
            body: 'Objectives give the small things you do each day a direction to point at.',
            action: el('button', {
              class: 'btn btn-primary btn-sm', type: 'button', style: { marginTop: '12px' },
              onClick: () => openObjectiveEditor({ onSaved: refresh }),
            }, [el('span', { text: 'Create an objective' })]),
          }),
        ]),
  });
}

function objectiveMenu(anchor, objective, refresh) {
  menu(anchor, [
    { label: 'Open', icon: 'arrowRight', onClick: () => navigate(`/objectives/${objective.id}`) },
    { label: 'Edit', icon: 'edit', onClick: () => openObjectiveEditor({ objectiveId: objective.id, onSaved: refresh }) },
    { separator: true },
    { label: 'Status' },
    ...STATUSES.map((status) => ({
      label: status.label,
      checked: objective.status === status.value,
      onClick: async () => {
        try {
          await api.patch(`/objectives/${objective.id}`, { status: status.value });
          toast(`Objective marked ${status.label.toLowerCase()}.`);
          refresh();
        } catch (error) {
          notifyError(error);
        }
      },
    })),
    { separator: true },
    {
      label: 'Delete', icon: 'trash', danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: `Delete "${objective.title}"?`,
          message: 'The objective and its milestones are removed. Projects and responsibilities remain, no longer linked.',
          confirmLabel: 'Delete objective',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          await api.del(`/objectives/${objective.id}`);
          toast('Objective deleted.');
          refresh();
        } catch (error) {
          notifyError(error);
        }
      },
    },
  ]);
}

/* ------------------------------------------------------------------ *
 * Detail — the ladder from objective down to today's action
 * ------------------------------------------------------------------ */

export async function objectiveDetailView({ params }) {
  const data = await api.get(`/objectives/${params.id}`);
  const objective = data.objective;
  const base = today();
  const refresh = async () => {
    invalidateReference();
    await loadReference({ force: true }).catch(() => {});
    navigate(`/objectives/${params.id}`, { replace: true });
  };

  async function addMilestone() {
    const input = el('input', { class: 'input', dataset: { autofocus: '' }, placeholder: 'Complete three portfolio projects' });
    const dateInput = el('input', { class: 'input', type: 'date' });
    modal({
      title: 'New milestone',
      subtitle: 'A meaningful marker on the way there.',
      size: 'modal-sm',
      body: el('div', { class: 'stack gap-4' }, [
        field('Milestone', input),
        field('Target date', dateInput),
      ]),
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: 'Add milestone',
          onClick: async () => {
            if (!input.value.trim()) return;
            try {
              await api.post(`/objectives/${objective.id}/milestones`, {
                title: input.value.trim(),
                targetDate: dateInput.value || null,
              });
              toast('Milestone added.');
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

  const milestoneNode = (milestone) => {
    const projects = data.projects.filter((p) => p.milestoneId === milestone.id);
    const tasks = data.tasks.filter((t) => t.milestoneId === milestone.id && !t.projectId);
    const complete = milestone.status === 'completed';

    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'row gap-3 grow' }, [
          el('button', {
            class: 'task-check', type: 'button', role: 'checkbox',
            'aria-checked': String(complete),
            'aria-label': complete ? `Reopen ${milestone.title}` : `Complete ${milestone.title}`,
            dataset: { done: String(complete) },
            onClick: async () => {
              try {
                await api.patch(`/milestones/${milestone.id}`, { status: complete ? 'active' : 'completed' });
                refresh();
              } catch (error) {
                notifyError(error);
              }
            },
          }),
          el('div', { class: 'stack grow' }, [
            el('span', {
              class: 'small',
              style: complete ? { color: 'var(--ink-4)', textDecoration: 'line-through' } : {},
              text: milestone.title,
            }),
            el('span', {
              class: 'micro subtle',
              text: [
                milestone.targetDate ? relativeDate(milestone.targetDate, base) : null,
                `${milestone.progress}%`,
                projects.length ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}` : null,
              ].filter(Boolean).join(' · '),
            }),
          ]),
        ]),
        el('button', {
          class: 'btn-icon sm', type: 'button', 'aria-label': `Options for ${milestone.title}`,
          onClick: (event) => menu(event.currentTarget, [
            {
              label: 'Add project here', icon: 'projects',
              onClick: () => openProjectEditor({
                draft: { objectiveId: objective.id, milestoneId: milestone.id, areaId: objective.areaId },
                onSaved: refresh,
              }),
            },
            {
              label: 'Add responsibility', icon: 'plus',
              onClick: () => openQuickAdd({
                onSaved: refresh,
                defaults: { objectiveId: objective.id, milestoneId: milestone.id, areaId: objective.areaId },
              }),
            },
            { separator: true },
            {
              label: 'Delete milestone', icon: 'trash', danger: true,
              onClick: async () => {
                const ok = await confirmDialog({
                  title: `Delete "${milestone.title}"?`,
                  message: 'Projects and responsibilities beneath it remain, no longer linked to this milestone.',
                  confirmLabel: 'Delete', tone: 'danger',
                });
                if (!ok) return;
                try {
                  await api.del(`/milestones/${milestone.id}`);
                  toast('Milestone deleted.');
                  refresh();
                } catch (error) {
                  notifyError(error);
                }
              },
            },
          ]),
        }, [icon('more', { size: 15 })]),
      ]),
      el('div', { style: { padding: '4px 16px 12px' } }, [
        meter(milestone.progress),
        projects.length
          ? el('div', { class: 'stack gap-2', style: { marginTop: '12px' } },
              projects.map((project) =>
                el('a', { class: 'row gap-3', href: `#/projects/${project.id}` }, [
                  icon('projects', { size: 14 }),
                  el('span', { class: 'small grow truncate', text: project.name }),
                  el('span', { class: 'micro subtle', text: `${project.tasksDone}/${project.tasksTotal}` }),
                ])
              )
            )
          : null,
        tasks.length
          ? el('div', { class: 'task-list', style: { marginTop: '8px' } },
              tasks.map((task) => taskRow(task, { onChanged: refresh, compact: true })))
          : null,
      ]),
    ]);
  };

  const looseProjects = data.projects.filter((p) => !p.milestoneId);
  const looseTasks = data.tasks.filter((t) => !t.milestoneId && !t.projectId);

  return page({
    title: objective.title,
    subtitle: objective.description || null,
    actions: [
      el('button', {
        class: 'btn', type: 'button',
        onClick: () => openObjectiveEditor({ objectiveId: objective.id, onSaved: refresh }),
      }, [icon('edit', { size: 15 }), el('span', { text: 'Edit' })]),
      el('button', {
        class: 'btn btn-primary', type: 'button', onClick: addMilestone,
      }, [icon('plus', { size: 15 }), el('span', { text: 'Add milestone' })]),
    ],
    children: [
      el('div', { class: 'card', style: { marginBottom: '32px' } }, [
        el('div', { class: 'row gap-5', style: { alignItems: 'center' } }, [
          ring(objective.progress, 60),
          el('div', { class: 'grow stack gap-2' }, [
            el('div', { class: 'row gap-3 wrap' }, [
              chip(HORIZONS.find((h) => h.value === objective.horizon)?.label ?? objective.horizon),
              objective.areaName ? chip(objective.areaName) : null,
              objective.deadline
                ? chip(`by ${formatDate(objective.deadline, { month: 'long', day: 'numeric', year: 'numeric' })}`,
                    { tone: objective.deadline < base ? 'danger' : '' })
                : null,
              chip(STATUSES.find((s) => s.value === objective.status)?.label ?? objective.status,
                { tone: objective.status === 'completed' ? 'positive' : '' }),
            ]),
            meter(objective.progress, { tall: true }),
            el('span', { class: 'micro subtle', text: `${objective.progress}% complete · ${objective.milestones?.length ?? 0} milestones · ${data.projects.length} projects · ${data.tasks.length} responsibilities` }),
          ]),
        ]),
      ]),

      el('section', { class: 'section' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-title' }, [
            el('h2', { text: 'Milestones', style: { fontSize: '1.125rem' } }),
            el('span', { class: 'count-chip', text: String(objective.milestones?.length ?? 0) }),
          ]),
        ]),
        objective.milestones?.length
          ? el('div', { class: 'stack gap-4' }, objective.milestones.map(milestoneNode))
          : el('div', { class: 'card' }, [
              empty({
                iconName: 'milestone',
                title: 'No milestones yet.',
                body: 'Milestones bridge an objective and the work beneath it. Name the markers you will pass on the way.',
                action: el('button', {
                  class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' },
                  onClick: addMilestone,
                }, [el('span', { text: 'Add a milestone' })]),
              }),
            ]),
      ]),

      looseProjects.length
        ? el('section', { class: 'section' }, [
            el('div', { class: 'section-head' }, [
              el('div', { class: 'section-title' }, [el('h2', { text: 'Projects', style: { fontSize: '1.125rem' } })]),
            ]),
            el('div', { class: 'grid grid-2' },
              looseProjects.map((project) =>
                el('a', { class: 'card', href: `#/projects/${project.id}` }, [
                  el('div', { class: 'stack gap-2' }, [
                    el('h3', { text: project.name, style: { fontSize: '1rem' } }),
                    el('span', { class: 'micro muted', text: `${project.tasksDone} of ${project.tasksTotal} complete` }),
                    meter(project.progress),
                  ]),
                ])
              )
            ),
          ])
        : null,

      looseTasks.length
        ? el('section', { class: 'section' }, [
            el('div', { class: 'section-head' }, [
              el('div', { class: 'section-title' }, [el('h2', { text: 'Direct responsibilities', style: { fontSize: '1.125rem' } })]),
            ]),
            el('div', { class: 'card card-flush' }, [
              el('div', { class: 'task-list', style: { padding: '4px 12px' } },
                looseTasks.map((task) => taskRow(task, { onChanged: refresh }))),
            ]),
          ])
        : null,
    ],
  });
}

export default objectivesView;
