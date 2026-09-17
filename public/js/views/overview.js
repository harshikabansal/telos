import api from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { chip, empty, meter, ring } from '../ui.js';
import { formatDate, formatFull, formatTime, greeting, relativeDate, today } from '../dates.js';
import { navigate } from '../router.js';
import { state } from '../store.js';
import { page } from '../shell.js';
import { taskRow } from '../components/task.js';
import { openQuickAdd } from '../components/quickAdd.js';
import { openTaskEditor } from '../components/taskEditor.js';
import { openProjectEditor } from './projects.js';
import { openObjectiveEditor } from './objectives.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The one-line reading of the day, assembled from what is actually true. */
function summaryLine(summary) {
  const parts = [];
  const outstanding = summary.dueToday + summary.overdue;
  if (outstanding) parts.push(plural(outstanding, 'responsibility today', 'responsibilities today'));
  if (summary.highPriority) parts.push(`${summary.highPriority} high priority`);
  if (summary.overdue) parts.push(`${summary.overdue} overdue`);
  if (!parts.length && summary.completedToday) {
    return `Day complete. ${plural(summary.completedToday, 'responsibility has', 'responsibilities have')} been completed.`;
  }
  if (!parts.length) return 'Nothing is due today.';
  return parts.join(' · ');
}

function sectionHead(title, { count, action } = {}) {
  return el('div', { class: 'section-head' }, [
    el('div', { class: 'section-title' }, [
      el('h2', { text: title }),
      count !== undefined && count !== null ? el('span', { class: 'count-chip', text: String(count) }) : null,
    ]),
    action || null,
  ]);
}

const linkButton = (label, path) =>
  el('a', { class: 'btn btn-ghost btn-sm', href: `#${path}` }, [
    el('span', { text: label }),
    icon('arrowRight', { size: 14 }),
  ]);

export async function overviewView() {
  const data = await api.get('/overview');
  const base = data.today;
  const refresh = () => navigate('/', { replace: true });

  /* ------------------------------ Header ------------------------------- */

  const header = el('div', { class: 'page-head' }, [
    el('p', { class: 'eyebrow', text: formatFull(base) }),
    el('h1', { style: { marginTop: '6px' }, text: `${greeting()}, ${state.user?.name?.split(' ')[0] || ''}`.trim() }),
    el('p', { class: 'page-sub', style: { marginTop: '8px' }, text: summaryLine(data.summary) }),
  ]);

  /* --------------------------- Quick actions --------------------------- */

  const quickActions = el('div', { class: 'row gap-2 wrap', style: { marginBottom: '32px' } }, [
    el('button', { class: 'btn btn-primary', type: 'button', onClick: () => openQuickAdd({ onSaved: refresh }) },
      [icon('plus', { size: 15 }), el('span', { text: 'Add task' })]),
    el('button', { class: 'btn', type: 'button', onClick: () => openProjectEditor({ onSaved: refresh }) },
      [icon('projects', { size: 15 }), el('span', { text: 'Add project' })]),
    el('button', { class: 'btn', type: 'button', onClick: () => openObjectiveEditor({ onSaved: refresh }) },
      [icon('objectives', { size: 15 }), el('span', { text: 'Add objective' })]),
    el('button', {
      class: 'btn', type: 'button',
      onClick: () => openTaskEditor({ draft: { dueDate: base, reminder: '1h' }, focus: 'recurrence', onSaved: refresh }),
    }, [icon('bell', { size: 15 }), el('span', { text: 'Add reminder' })]),
    el('button', {
      class: 'btn', type: 'button',
      onClick: () => openTaskEditor({ draft: { dueDate: base, recurrence: { freq: 'daily' } }, focus: 'recurrence', onSaved: refresh }),
    }, [icon('recurring', { size: 15 }), el('span', { text: 'Add habit' })]),
    el('a', { class: 'btn', href: '#/calendar' }, [icon('calendar', { size: 15 }), el('span', { text: 'Open calendar' })]),
  ]);

  /* --------------------------- Today's Focus --------------------------- */

  const focusSection = el('section', { class: 'section' }, [
    sectionHead("Today's Focus", {
      count: data.focus.length || null,
      action: data.focus.length ? linkButton('All tasks', '/tasks') : null,
    }),
    data.focus.length
      ? el('div', { class: 'card card-flush' }, [
          el('div', { class: 'task-list', style: { padding: '4px 12px' } },
            data.focus.map((task) => taskRow(task, { onChanged: refresh }))),
        ])
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'check',
            title: data.summary.completedToday ? 'Day complete.' : 'Your day is clear.',
            body: data.summary.completedToday
              ? `${plural(data.summary.completedToday, 'responsibility has', 'responsibilities have')} been completed.`
              : 'There are no outstanding responsibilities requiring your attention.',
            action: el('button', {
              class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' },
              onClick: () => openQuickAdd({ onSaved: refresh }),
            }, [el('span', { text: 'Add something' })]),
          }),
        ]),
  ]);

  /* -------------------------- Attention Required ------------------------ */

  const attentionGroups = [
    { key: 'overdue', label: 'Overdue', items: data.attention.overdue, tone: 'danger' },
    { key: 'approaching', label: 'Approaching deadlines', items: data.attention.approaching, tone: 'warning' },
    { key: 'urgent', label: 'Urgent', items: data.attention.urgent, tone: 'danger' },
    { key: 'important', label: 'Important, unfinished', items: data.attention.important, tone: '' },
  ].filter((group) => group.items.length);

  const attentionSection = attentionGroups.length
    ? el('section', { class: 'section' }, [
        sectionHead('Attention Required'),
        el('div', { class: 'stack gap-4' },
          attentionGroups.map((group) =>
            el('div', { class: 'panel' }, [
              el('div', { class: 'panel-head' }, [
                el('span', { class: 'eyebrow', text: group.label }),
                chip(String(group.items.length), { tone: group.tone }),
              ]),
              el('div', { class: 'task-list', style: { padding: '2px 12px' } },
                group.items.map((task) => taskRow(task, { onChanged: refresh }))),
            ])
          )
        ),
      ])
    : null;

  /* ------------------------------ Upcoming ------------------------------ */

  const upcomingGroups = [
    { label: 'Tomorrow', items: data.upcoming.tomorrow },
    { label: 'Next 7 days', items: data.upcoming.next7 },
    { label: 'Next 30 days', items: data.upcoming.next30 },
  ];
  const hasUpcoming = upcomingGroups.some((g) => g.items.length);

  const upcomingSection = el('section', { class: 'section' }, [
    sectionHead('Upcoming', { action: linkButton('Calendar', '/calendar') }),
    hasUpcoming
      ? el('div', { class: 'stack gap-4' },
          upcomingGroups
            .filter((group) => group.items.length)
            .map((group) =>
              el('div', { class: 'panel' }, [
                el('div', { class: 'panel-head' }, [
                  el('span', { class: 'eyebrow', text: group.label }),
                  el('span', { class: 'micro subtle', text: plural(group.items.length, 'item', 'items') }),
                ]),
                el('div', { class: 'task-list', style: { padding: '2px 12px' } },
                  group.items.slice(0, 6).map((task) => taskRow(task, { onChanged: refresh, compact: true }))),
                group.items.length > 6
                  ? el('div', { style: { padding: '8px 16px' } }, [linkButton(`${group.items.length - 6} more`, '/tasks?view=upcoming')])
                  : null,
              ])
            )
        )
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'calendar',
            title: 'Nothing scheduled ahead.',
            body: 'You have some room to breathe.',
          }),
        ]),
  ]);

  /* ---------------------- Objectives & projects ------------------------- */

  const objectiveCard = (objective) =>
    el('a', { class: 'card', href: `#/objectives/${objective.id}`, style: { display: 'block' } }, [
      el('div', { class: 'row gap-4', style: { alignItems: 'flex-start' } }, [
        el('div', { class: 'grow stack gap-2' }, [
          el('span', { class: 'eyebrow', text: objective.areaName || objective.horizon }),
          el('h3', { text: objective.title, style: { fontSize: '1rem' } }),
          el('div', { class: 'row gap-3 wrap' }, [
            el('span', { class: 'micro muted', text: `${objective.progress}% complete` }),
            objective.deadline ? el('span', { class: 'micro subtle', text: relativeDate(objective.deadline, base) }) : null,
            objective.milestones?.length
              ? el('span', { class: 'micro subtle', text: plural(objective.milestones.length, 'milestone', 'milestones') })
              : null,
          ]),
          meter(objective.progress),
        ]),
        ring(objective.progress, 40),
      ]),
    ]);

  const projectCard = (project) =>
    el('a', { class: 'card', href: `#/projects/${project.id}`, style: { display: 'block' } }, [
      el('div', { class: 'stack gap-2' }, [
        el('span', { class: 'eyebrow', text: project.objectiveTitle || project.areaName || 'Project' }),
        el('h3', { text: project.name, style: { fontSize: '1rem' } }),
        el('div', { class: 'row gap-3 wrap' }, [
          el('span', { class: 'micro muted', text: `${project.tasksDone} of ${project.tasksTotal} tasks complete` }),
          project.deadline ? el('span', { class: 'micro subtle', text: relativeDate(project.deadline, base) }) : null,
        ]),
        meter(project.progress),
        el('span', { class: 'micro subtle', text: `${project.progress}%` }),
      ]),
    ]);

  const objectivesSection = el('section', { class: 'section' }, [
    sectionHead('Objectives', { count: data.objectives.length || null, action: linkButton('All objectives', '/objectives') }),
    data.objectives.length
      ? el('div', { class: 'grid grid-2' }, data.objectives.slice(0, 4).map(objectiveCard))
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'objectives',
            title: 'What are you moving toward?',
            body: 'An objective gives your daily work a direction to point at.',
            action: el('button', {
              class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' },
              onClick: () => openObjectiveEditor({ onSaved: refresh }),
            }, [el('span', { text: 'Add an objective' })]),
          }),
        ]),
  ]);

  const projectsSection = el('section', { class: 'section' }, [
    sectionHead('Active Projects', { count: data.projects.length || null, action: linkButton('All projects', '/projects') }),
    data.projects.length
      ? el('div', { class: 'grid grid-2' }, data.projects.slice(0, 4).map(projectCard))
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'projects',
            title: 'No active projects.',
            body: 'Create one when several responsibilities begin moving toward a shared outcome.',
            action: el('button', {
              class: 'btn btn-sm', type: 'button', style: { marginTop: '12px' },
              onClick: () => openProjectEditor({ onSaved: refresh }),
            }, [el('span', { text: 'Add a project' })]),
          }),
        ]),
  ]);

  /* --------------------------- Side column ------------------------------ */

  const sideCards = [];

  if (data.recurringToday.length) {
    sideCards.push(
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [
          el('h3', { text: 'Recurring today', style: { fontSize: '1rem' } }),
          el('a', { class: 'micro link', href: '#/recurring', text: 'All' }),
        ]),
        el('div', { class: 'stack gap-2' },
          data.recurringToday.slice(0, 6).map((task) =>
            el('div', { class: 'row gap-3' }, [
              icon('recurring', { size: 14 }),
              el('span', { class: 'small grow truncate', text: task.title }),
              el('span', { class: 'micro subtle', text: task.recurrenceLabel }),
            ])
          )
        ),
      ])
    );
  }

  if (data.events.length) {
    sideCards.push(
      el('div', { class: 'card' }, [
        el('div', { class: 'card-head' }, [el('h3', { text: 'Events', style: { fontSize: '1rem' } })]),
        el('div', { class: 'stack gap-3' },
          data.events.slice(0, 5).map((event) =>
            el('div', { class: 'stack' }, [
              el('span', { class: 'small', text: event.title }),
              el('span', {
                class: 'micro subtle',
                text: [relativeDate(event.startDate, base), event.startTime ? formatTime(event.startTime) : null, event.location || null]
                  .filter(Boolean).join(' · '),
              }),
            ])
          )
        ),
      ])
    );
  }

  sideCards.push(
    el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: 'This week', style: { fontSize: '1rem' } })]),
      el('div', { class: 'stack gap-4' }, [
        el('div', { class: 'row gap-4' }, [
          el('div', { class: 'grow stack' }, [
            el('span', { class: 'stat-value', style: { fontSize: '1.5rem' }, text: String(data.summary.completedThisWeek) }),
            el('span', { class: 'micro subtle', text: 'completed in the last 7 days' }),
          ]),
          el('div', { class: 'grow stack' }, [
            el('span', { class: 'stat-value', style: { fontSize: '1.5rem' }, text: String(data.summary.openTotal) }),
            el('span', { class: 'micro subtle', text: 'open responsibilities' }),
          ]),
        ]),
        el('a', { class: 'btn btn-sm btn-block', href: '#/insights' }, [
          icon('insights', { size: 14 }), el('span', { text: 'Open insights' }),
        ]),
      ]),
    ])
  );

  /**
   * An offer, not a nudge. It appears only when the week that just ended
   * actually held something, and it disappears the moment anything is written
   * — nothing here nags, counts streaks, or reappears to shame a skipped week.
   */
  const reviewOffer = data.review?.available
    ? el('div', { class: 'notice', style: { marginBottom: '28px' } }, [
        el('div', { class: 'row gap-4 wrap', style: { justifyContent: 'space-between' } }, [
          el('div', { class: 'stack gap-1' }, [
            el('span', { class: 'small', text: 'Last week has finished.' }),
            el('span', {
              class: 'micro subtle',
              text: `${plural(data.review.completed, 'responsibility', 'responsibilities')} completed between ${formatDate(data.review.periodStart, { month: 'short', day: 'numeric' })} and ${formatDate(data.review.periodEnd, { month: 'short', day: 'numeric' })}. Worth a look back?`,
            }),
          ]),
          el('a', {
            class: 'btn btn-sm',
            href: `#/insights?tab=review&week=${data.review.periodStart}`,
          }, [icon('notes', { size: 14 }), el('span', { text: 'Reflect on the week' })]),
        ]),
      ])
    : null;

  const layout = el('div', { class: 'split' }, [
    el('div', { class: 'stack' }, [focusSection, attentionSection, upcomingSection].filter(Boolean)),
    el('div', { class: 'stack gap-5' }, [...sideCards]),
  ]);

  return el('div', { class: 'page' }, [
    header,
    quickActions,
    reviewOffer,
    layout,
    objectivesSection,
    projectsSection,
  ]);
}

export default overviewView;
