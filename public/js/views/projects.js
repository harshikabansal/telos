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
import { openTaskEditor } from '../components/taskEditor.js';
import { assistantEnabled, suggestButton } from '../components/assistant.js';

const STATUSES = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PRIORITIES = [
  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
];

const STATUS_TONE = { active: 'accent', planning: '', on_hold: 'warning', completed: 'positive', cancelled: '' };

/* ------------------------------------------------------------------ *
 * Editor
 * ------------------------------------------------------------------ */

export async function openProjectEditor({ projectId = null, draft = {}, onSaved } = {}) {
  await loadReference().catch(() => {});
  let existing = null;
  if (projectId) {
    try {
      existing = (await api.get(`/projects/${projectId}`)).project;
    } catch (error) {
      notifyError(error);
      return;
    }
  }

  const values = {
    name: existing?.name ?? draft.name ?? '',
    description: existing?.description ?? '',
    deadline: existing?.deadline ?? draft.deadline ?? '',
    priority: existing?.priority ?? 'medium',
    status: existing?.status ?? 'active',
    objectiveId: existing?.objectiveId ?? draft.objectiveId ?? '',
    milestoneId: existing?.milestoneId ?? draft.milestoneId ?? '',
    areaId: existing?.areaId ?? draft.areaId ?? '',
  };

  const input = (props) => el('input', { class: 'input', ...props });
  const nameInput = input({
    value: values.name, dataset: { autofocus: '' },
    placeholder: 'What are you building or accomplishing?',
    onInput: (e) => { values.name = e.target.value; },
  });

  const milestoneSelect = select([{ value: '', label: 'No milestone' }], {
    value: values.milestoneId, ariaLabel: 'Milestone',
    onChange: (v) => { values.milestoneId = v; },
  });
  const paintMilestones = () => {
    const objective = state.objectives.find((o) => o.id === values.objectiveId);
    milestoneSelect.replaceChildren(
      ...[
        { value: '', label: objective ? 'No milestone' : 'Choose an objective first' },
        ...(objective?.milestones ?? []).map((m) => ({ value: m.id, label: m.title })),
      ].map((option) =>
        el('option', { value: option.value, text: option.label, selected: option.value === values.milestoneId })
      )
    );
    milestoneSelect.disabled = !objective;
  };
  paintMilestones();

  const starterTasks = el('textarea', {
    class: 'textarea',
    placeholder: 'One responsibility per line',
    style: { minHeight: '86px' },
  });

  const projectContext = () => ({
    areaId: values.areaId || undefined,
    objectiveId: values.objectiveId || undefined,
  });
  const assisted = (labelText, control, options) => {
    if (!assistantEnabled()) return field(labelText, control, options.hint);
    const { button, list } = suggestButton({ ...options, getContext: projectContext });
    return el('div', { class: 'field' }, [
      el('div', { class: 'field-head' }, [el('span', { class: 'label', text: labelText }), button]),
      control,
      list,
      options.hint ? el('p', { class: 'hint', text: options.hint }) : null,
    ]);
  };

  modal({
    title: existing ? 'Edit project' : 'New project',
    subtitle: existing ? null : 'What are you building or accomplishing?',
    body: el('div', { class: 'stack gap-4' }, [
      assisted('Name', nameInput, {
        kind: 'project-name',
        getInput: () => values.name,
        onPick: (suggestion) => {
          values.name = suggestion;
          nameInput.value = suggestion;
          nameInput.removeAttribute('aria-invalid');
        },
      }),
      field('Description', el('textarea', {
        class: 'textarea', style: { minHeight: '64px' },
        onInput: (e) => { values.description = e.target.value; },
      }, values.description)),
      el('div', { class: 'grid grid-2' }, [
        field('Objective', select(
          [{ value: '', label: 'No objective' }, ...state.objectives.map((o) => ({ value: o.id, label: o.title }))],
          {
            value: values.objectiveId, ariaLabel: 'Objective',
            onChange: (v) => { values.objectiveId = v; values.milestoneId = ''; paintMilestones(); },
          }
        )),
        field('Milestone', milestoneSelect),
      ]),
      el('div', { class: 'grid grid-3' }, [
        field('Deadline', input({ type: 'date', value: values.deadline || '', onChange: (e) => { values.deadline = e.target.value; } })),
        field('Priority', select(PRIORITIES, { value: values.priority, onChange: (v) => { values.priority = v; } })),
        field('Status', select(STATUSES, { value: values.status, onChange: (v) => { values.status = v; } })),
      ]),
      field('Area of life', select(
        [{ value: '', label: 'No area' }, ...state.areas.map((a) => ({ value: a.id, label: a.name }))],
        { value: values.areaId, ariaLabel: 'Area', onChange: (v) => { values.areaId = v; } }
      )),
      existing ? null : assisted('First responsibilities', starterTasks, {
        kind: 'project-tasks',
        hint: 'Optional. One per line.',
        getInput: () => values.name,
        onPick: (suggestion) => {
          const lines = starterTasks.value.split('\n').map((l) => l.trim()).filter(Boolean);
          if (!lines.includes(suggestion)) lines.push(suggestion);
          starterTasks.value = lines.join('\n');
        },
      }),
    ]),
    footer: (close) => [
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: existing ? 'Save changes' : 'Create project',
        onClick: async (event) => {
          if (!values.name.trim()) {
            nameInput.setAttribute('aria-invalid', 'true');
            nameInput.focus();
            return;
          }
          // Captured now: `currentTarget` is null once an await resumes.
          const button = event.currentTarget;
          button.disabled = true;
          const payload = {
            name: values.name.trim(),
            description: values.description,
            deadline: values.deadline || null,
            priority: values.priority,
            status: values.status,
            objectiveId: values.objectiveId || null,
            milestoneId: values.milestoneId || null,
            areaId: values.areaId || null,
          };
          try {
            if (existing) {
              await api.patch(`/projects/${existing.id}`, payload);
              toast('Project updated.');
            } else {
              const tasks = starterTasks.value.split('\n').map((t) => t.trim()).filter(Boolean);
              await api.post('/projects', { ...payload, tasks });
              toast('Project created.');
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

export async function projectsView({ query = {} } = {}) {
  const data = await api.get('/projects', { status: query.status, objectiveId: query.objectiveId });
  const base = today();
  const refresh = async () => {
    invalidateReference();
    await loadReference({ force: true }).catch(() => {});
    navigate(`/projects${buildQuery(query)}`, { replace: true });
  };

  const grouped = {
    active: data.projects.filter((p) => p.status === 'active'),
    planning: data.projects.filter((p) => p.status === 'planning'),
    on_hold: data.projects.filter((p) => p.status === 'on_hold'),
    completed: data.projects.filter((p) => ['completed', 'cancelled'].includes(p.status)),
  };

  const card = (project) =>
    el('div', { class: 'card' }, [
      el('div', { class: 'row gap-4', style: { alignItems: 'flex-start' } }, [
        el('div', { class: 'grow stack gap-2' }, [
          el('div', { class: 'row gap-2 wrap' }, [
            project.objectiveTitle ? el('span', { class: 'eyebrow', text: project.objectiveTitle }) : null,
            project.areaName ? el('span', { class: 'micro subtle', text: project.areaName }) : null,
          ]),
          el('a', { href: `#/projects/${project.id}` }, [el('h3', { text: project.name, style: { fontSize: '1.0625rem' } })]),
          project.description ? el('p', { class: 'small muted truncate', text: project.description }) : null,
          el('div', { class: 'row gap-3 wrap' }, [
            el('span', { class: 'micro muted', text: `${project.tasksDone} of ${project.tasksTotal} tasks complete` }),
            project.deadline
              ? el('span', {
                  class: 'micro',
                  style: project.deadline < base && project.status === 'active' ? { color: 'var(--danger)' } : { color: 'var(--ink-3)' },
                  text: relativeDate(project.deadline, base),
                })
              : null,
            chip(STATUSES.find((s) => s.value === project.status)?.label ?? project.status, { tone: STATUS_TONE[project.status] }),
          ]),
          meter(project.progress),
        ]),
        el('div', { class: 'stack gap-2', style: { alignItems: 'center' } }, [
          ring(project.progress, 42),
          el('button', {
            class: 'btn-icon sm', type: 'button', 'aria-label': `Options for ${project.name}`,
            onClick: (event) => projectMenu(event.currentTarget, project, refresh),
          }, [icon('more', { size: 16 })]),
        ]),
      ]),
    ]);

  const groups = [
    { key: 'active', label: 'Active' },
    { key: 'planning', label: 'Planning' },
    { key: 'on_hold', label: 'On hold' },
    { key: 'completed', label: 'Finished' },
  ].filter((group) => grouped[group.key].length);

  return page({
    title: 'Projects',
    subtitle: data.projects.length
      ? `${data.projects.length} ${data.projects.length === 1 ? 'project' : 'projects'} · ${grouped.active.length} active`
      : 'Where several responsibilities move toward a shared outcome.',
    actions: [
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onClick: () => openProjectEditor({ onSaved: refresh }),
      }, [icon('plus', { size: 15 }), el('span', { text: 'New project' })]),
    ],
    children: data.projects.length
      ? groups.map((group) =>
          el('section', { class: 'section' }, [
            el('div', { class: 'section-head' }, [
              el('div', { class: 'section-title' }, [
                el('h2', { text: group.label, style: { fontSize: '1.125rem' } }),
                el('span', { class: 'count-chip', text: String(grouped[group.key].length) }),
              ]),
            ]),
            el('div', { class: 'grid grid-2' }, grouped[group.key].map(card)),
          ])
        )
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'projects',
            title: 'No active projects.',
            body: 'Create one when several responsibilities begin moving toward a shared outcome.',
            action: el('button', {
              class: 'btn btn-primary btn-sm', type: 'button', style: { marginTop: '12px' },
              onClick: () => openProjectEditor({ onSaved: refresh }),
            }, [el('span', { text: 'Create a project' })]),
          }),
        ]),
  });
}

function projectMenu(anchor, project, refresh) {
  menu(anchor, [
    { label: 'Open', icon: 'arrowRight', onClick: () => navigate(`/projects/${project.id}`) },
    { label: 'Edit', icon: 'edit', onClick: () => openProjectEditor({ projectId: project.id, onSaved: refresh }) },
    { separator: true },
    { label: 'Status' },
    ...STATUSES.map((status) => ({
      label: status.label,
      checked: project.status === status.value,
      onClick: async () => {
        try {
          await api.patch(`/projects/${project.id}`, { status: status.value });
          toast(`Project marked ${status.label.toLowerCase()}.`);
          refresh();
        } catch (error) {
          notifyError(error);
        }
      },
    })),
    { separator: true },
    {
      label: 'Delete',
      icon: 'trash',
      danger: true,
      onClick: async () => {
        const ok = await confirmDialog({
          title: `Delete "${project.name}"?`,
          message: 'The project is removed. Its responsibilities remain, no longer grouped.',
          confirmLabel: 'Delete project',
          tone: 'danger',
        });
        if (!ok) return;
        try {
          await api.del(`/projects/${project.id}`);
          toast('Project deleted.');
          refresh();
        } catch (error) {
          notifyError(error);
        }
      },
    },
  ]);
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export async function projectDetailView({ params }) {
  const data = await api.get(`/projects/${params.id}`);
  const project = data.project;
  const base = today();
  const refresh = async () => {
    invalidateReference();
    await loadReference({ force: true }).catch(() => {});
    navigate(`/projects/${params.id}`, { replace: true });
  };

  const open = data.tasks.filter((t) => ['not_started', 'in_progress'].includes(t.status));
  const done = data.tasks.filter((t) => t.status === 'completed');

  const metaRow = el('div', { class: 'row gap-4 wrap', style: { marginTop: '12px' } }, [
    chip(STATUSES.find((s) => s.value === project.status)?.label ?? project.status, { tone: STATUS_TONE[project.status] }),
    project.priority !== 'medium' ? el('span', { class: `prio ${project.priority}`, text: `${project.priority} priority` }) : null,
    project.deadline
      ? el('span', {
          class: 'small',
          style: project.deadline < base && project.status === 'active' ? { color: 'var(--danger)' } : { color: 'var(--ink-3)' },
          text: `Deadline ${formatDate(project.deadline, { month: 'long', day: 'numeric', year: 'numeric' })}`,
        })
      : null,
    project.areaName ? el('span', { class: 'small muted', text: project.areaName }) : null,
  ]);

  const ladder = (project.objectiveTitle || project.milestoneTitle)
    ? el('div', { class: 'notice', style: { marginBottom: '24px' } }, [
        el('div', { class: 'row gap-3 wrap' }, [
          icon('objectives', { size: 15 }),
          project.objectiveId
            ? el('a', { class: 'small link', href: `#/objectives/${project.objectiveId}`, text: project.objectiveTitle })
            : null,
          project.milestoneTitle ? icon('chevronRight', { size: 13 }) : null,
          project.milestoneTitle ? el('span', { class: 'small muted', text: project.milestoneTitle }) : null,
          icon('chevronRight', { size: 13 }),
          el('span', { class: 'small', text: project.name }),
        ]),
      ])
    : null;

  return page({
    title: project.name,
    subtitle: project.description || null,
    actions: [
      el('button', {
        class: 'btn', type: 'button',
        onClick: () => openProjectEditor({ projectId: project.id, onSaved: refresh }),
      }, [icon('edit', { size: 15 }), el('span', { text: 'Edit' })]),
      el('button', {
        class: 'btn btn-primary', type: 'button',
        onClick: () => openQuickAdd({ onSaved: refresh, defaults: { projectId: project.id, areaId: project.areaId } }),
      }, [icon('plus', { size: 15 }), el('span', { text: 'Add responsibility' })]),
    ],
    children: [
      metaRow,
      el('div', { class: 'card', style: { margin: '24px 0' } }, [
        el('div', { class: 'row gap-5', style: { alignItems: 'center' } }, [
          ring(project.progress, 56),
          el('div', { class: 'grow stack gap-2' }, [
            el('span', { class: 'small', text: `${project.tasksDone} of ${project.tasksTotal} tasks complete` }),
            meter(project.progress, { tall: true }),
            el('span', { class: 'micro subtle', text: `${project.progress}% complete` }),
          ]),
        ]),
      ]),
      ladder,
      el('section', { class: 'section' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-title' }, [
            el('h2', { text: 'Responsibilities', style: { fontSize: '1.125rem' } }),
            el('span', { class: 'count-chip', text: String(open.length) }),
          ]),
        ]),
        open.length
          ? el('div', { class: 'card card-flush' }, [
              el('div', { class: 'task-list', style: { padding: '4px 12px' } },
                open.map((task) => taskRow(task, { onChanged: refresh, showProject: false }))),
            ])
          : el('div', { class: 'card' }, [
              empty({
                iconName: 'check',
                title: project.tasksTotal ? 'Everything here is complete.' : 'Nothing here yet.',
                body: project.tasksTotal
                  ? 'This project has no outstanding responsibilities.'
                  : 'Add the first responsibility that moves this project forward.',
                action: el('button', {
                  class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' },
                  onClick: () => openTaskEditor({ draft: { projectId: project.id, areaId: project.areaId }, onSaved: refresh }),
                }, [el('span', { text: 'Add a responsibility' })]),
              }),
            ]),
      ]),
      done.length
        ? el('section', { class: 'section' }, [
            el('div', { class: 'section-head' }, [
              el('div', { class: 'section-title' }, [
                el('h2', { text: 'Completed', style: { fontSize: '1.125rem' } }),
                el('span', { class: 'count-chip', text: String(done.length) }),
              ]),
            ]),
            el('div', { class: 'card card-flush' }, [
              el('div', { class: 'task-list', style: { padding: '4px 12px' } },
                done.map((task) => taskRow(task, { onChanged: refresh, showProject: false }))),
            ]),
          ])
        : null,
    ],
  });
}

export default projectsView;
