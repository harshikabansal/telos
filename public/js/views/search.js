import api from '../api.js';
import { el } from '../dom.js';
import { icon } from '../icons.js';
import { empty, meter } from '../ui.js';
import { formatDate, relativeDate, today } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { page } from '../shell.js';
import { taskRow } from '../components/task.js';

/** Global search across every surface a user holds. */
export async function searchView({ query = {} } = {}) {
  const term = (query.q || '').trim();
  const base = today();

  const input = el('input', {
    class: 'input',
    type: 'search',
    value: term,
    placeholder: 'Search tasks, projects, objectives, milestones, notes and areas',
    dataset: { autofocus: '' },
    'aria-label': 'Search',
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') navigate(`/search${buildQuery({ q: event.target.value.trim() })}`, { replace: true });
  });

  const searchBar = el('div', { class: 'row gap-3', style: { marginBottom: '28px' } }, [
    el('div', { class: 'grow' }, [input]),
    el('button', {
      class: 'btn btn-primary', type: 'button', text: 'Search',
      onClick: () => navigate(`/search${buildQuery({ q: input.value.trim() })}`, { replace: true }),
    }),
  ]);

  if (term.length < 1) {
    return page({
      title: 'Search',
      subtitle: 'Everything you hold in TELOS, in one place.',
      children: [
        searchBar,
        el('div', { class: 'card' }, [
          empty({
            iconName: 'search',
            title: 'What are you looking for?',
            body: 'Search across responsibilities, projects, objectives, milestones, notes, events and areas of life.',
          }),
        ]),
      ],
    });
  }

  const data = await api.get('/search', { q: term });
  const refresh = () => navigate(`/search${buildQuery({ q: term })}`, { replace: true });

  const resultSection = (title, items, renderItem) =>
    items.length
      ? el('section', { class: 'section' }, [
          el('div', { class: 'section-head' }, [
            el('div', { class: 'section-title' }, [
              el('h2', { text: title, style: { fontSize: '1.125rem' } }),
              el('span', { class: 'count-chip', text: String(items.length) }),
            ]),
          ]),
          el('div', { class: 'panel' }, [el('div', { class: 'rows' }, items.map(renderItem))]),
        ])
      : null;

  const linkRow = (href, iconName, title, subtitle, trailing) =>
    el('a', { class: 'list-row', href: `#${href}` }, [
      icon(iconName, { size: 16 }),
      el('div', { class: 'stack grow', style: { minWidth: '0' } }, [
        el('span', { class: 'small truncate', text: title }),
        subtitle ? el('span', { class: 'micro subtle truncate', text: subtitle }) : null,
      ]),
      trailing || null,
    ]);

  const sections = [
    data.tasks.length
      ? el('section', { class: 'section' }, [
          el('div', { class: 'section-head' }, [
            el('div', { class: 'section-title' }, [
              el('h2', { text: 'Responsibilities', style: { fontSize: '1.125rem' } }),
              el('span', { class: 'count-chip', text: String(data.tasks.length) }),
            ]),
          ]),
          el('div', { class: 'card card-flush' }, [
            el('div', { class: 'task-list', style: { padding: '4px 12px' } },
              data.tasks.map((task) => taskRow(task, { onChanged: refresh }))),
          ]),
        ])
      : null,

    resultSection('Projects', data.projects, (project) =>
      linkRow(
        `/projects/${project.id}`, 'projects', project.name,
        [project.status, project.deadline ? relativeDate(project.deadline, base) : null].filter(Boolean).join(' · ')
      )
    ),

    resultSection('Objectives', data.objectives, (objective) =>
      linkRow(
        `/objectives/${objective.id}`, 'objectives', objective.title,
        [objective.horizon, objective.deadline ? formatDate(objective.deadline, { month: 'long', year: 'numeric' }) : null]
          .filter(Boolean).join(' · ')
      )
    ),

    resultSection('Milestones', data.milestones, (milestone) =>
      linkRow(
        '/objectives',
        'milestone', milestone.title,
        [milestone.objective_title, milestone.target_date ? relativeDate(milestone.target_date, base) : null]
          .filter(Boolean).join(' · ')
      )
    ),

    resultSection('Notes', data.notes, (note) =>
      linkRow(`/notes${buildQuery({ id: note.id })}`, 'notes', note.title || 'Untitled note', note.body.slice(0, 90))
    ),

    resultSection('Events', data.events, (event) =>
      linkRow(
        `/calendar${buildQuery({ mode: 'day', date: event.start_date })}`,
        'calendar', event.title, formatDate(event.start_date, { month: 'long', day: 'numeric', year: 'numeric' })
      )
    ),

    resultSection('Areas of life', data.areas, (area) =>
      linkRow(`/tasks${buildQuery({ view: 'all', areaId: area.id })}`, area.icon || 'circle', area.name, null)
    ),
  ].filter(Boolean);

  return page({
    title: 'Search',
    subtitle: `${data.total} ${data.total === 1 ? 'result' : 'results'} for "${term}"`,
    children: [
      searchBar,
      ...(sections.length
        ? sections
        : [
            el('div', { class: 'card' }, [
              empty({
                iconName: 'search',
                title: 'Nothing matched.',
                body: `No responsibilities, projects, objectives, notes or areas contain "${term}".`,
              }),
            ]),
          ]),
    ],
  });
}

export default searchView;
