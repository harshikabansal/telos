import api from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { empty, meter, segmented } from '../ui.js';
import { formatDate, relativeDate, today } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { page } from '../shell.js';
import { reflectionView } from './reflection.js';

/**
 * Insights.
 *
 * Every chart here answers one question with one measure, so each is a single
 * series: no legend is needed and no categorical palette is cycled. Magnitude
 * is carried by one hue — the account's accent — light to dark, with direct
 * labels doing the identifying. Priority is the one exception, and it uses the
 * reserved status colours that already appear on responsibilities, always
 * beside a written label rather than alone.
 *
 * There is no score, no streak and no comparison. The point is reflection.
 */

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: '1 year' },
];

const PRIORITY_COLOR = {
  urgent: 'var(--danger)',
  high: 'var(--warning)',
  medium: 'var(--accent)',
  low: 'var(--ink-4)',
};

const statTile = (value, label, note) =>
  el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value', text: String(value) }),
    el('div', { class: 'stat-label', text: label }),
    note ? el('div', { class: 'stat-note', text: note }) : null,
  ]);

/** A thin-bar series over time, with a hover readout above it. */
function barSeries(points, { label = 'Completed', formatX = (p) => p.date } = {}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const readout = el('p', { class: 'micro subtle', style: { minHeight: '18px' }, text: '' });
  const bars = el('div', { class: 'bars' });

  for (const point of points) {
    const height = point.count ? Math.max(4, (point.count / max) * 100) : 2;
    const bar = el('div', {
      class: 'bar',
      style: { height: `${height}%`, opacity: point.count ? '1' : '0.35' },
      tabindex: '0',
      role: 'img',
      'aria-label': `${formatX(point)}: ${point.count} ${label.toLowerCase()}`,
      title: `${formatX(point)} · ${point.count}`,
    }, [el('i', { style: { background: point.count ? 'var(--accent)' : 'var(--surface-3)' } })]);

    const show = () => {
      readout.textContent = `${formatX(point)} · ${point.count} ${point.count === 1 ? 'responsibility' : 'responsibilities'}`;
    };
    bar.addEventListener('mouseenter', show);
    bar.addEventListener('focus', show);
    bar.addEventListener('mouseleave', () => { readout.textContent = ''; });
    bar.addEventListener('blur', () => { readout.textContent = ''; });
    bars.append(bar);
  }

  return el('div', { class: 'stack gap-2' }, [
    readout,
    bars,
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      el('span', { class: 'micro subtle', text: points.length ? formatX(points[0]) : '' }),
      el('span', { class: 'micro subtle', text: points.length ? formatX(points[points.length - 1]) : '' }),
    ]),
  ]);
}

/** Horizontal magnitude bars: one hue, direct value labels. */
function hbars(rows, { colorFor = () => 'var(--accent)' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return el('div', { class: 'stack gap-3' },
    rows.map((row) =>
      el('div', { class: 'hbar-row' }, [
        el('span', { class: 'truncate', title: row.label, text: row.label }),
        el('div', { class: 'hbar', title: `${row.label}: ${row.value}` }, [
          el('i', { style: { width: `${(row.value / max) * 100}%`, background: colorFor(row) } }),
        ]),
        el('span', { class: 'hbar-num', text: String(row.value) }),
      ])
    )
  );
}

function tableView(caption, columns, rows) {
  const table = el('table', {
    style: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--t-small)' },
  }, [
    el('caption', { class: 'sr-only', text: caption }),
    el('thead', {}, [
      el('tr', {}, columns.map((column) =>
        el('th', {
          class: 'eyebrow',
          style: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' },
          text: column,
        })
      )),
    ]),
    el('tbody', {}, rows.map((row) =>
      el('tr', {}, row.map((cell) =>
        el('td', { style: { padding: '6px 8px', borderBottom: '1px solid var(--line)' }, text: String(cell) })
      ))
    )),
  ]);
  return el('div', { style: { overflowX: 'auto' } }, [table]);
}

/** A chart card that can be switched to its underlying table. */
function chartCard({ title, note, chart, table }) {
  const body = el('div', {}, [chart]);
  let showingTable = false;
  const toggle = el('button', {
    class: 'btn-icon sm', type: 'button', 'aria-label': 'Show as table',
    onClick: (event) => {
      showingTable = !showingTable;
      clear(body);
      body.append(showingTable ? table : chart);
      event.currentTarget.setAttribute('aria-label', showingTable ? 'Show as chart' : 'Show as table');
      clear(event.currentTarget);
      event.currentTarget.append(icon(showingTable ? 'insights' : 'list', { size: 15 }));
    },
  }, [icon('list', { size: 15 })]);

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack' }, [
        el('h3', { text: title, style: { fontSize: '1rem' } }),
        note ? el('span', { class: 'micro subtle', text: note }) : null,
      ]),
      table ? toggle : null,
    ]),
    body,
  ]);
}

export async function insightsView({ query = {} } = {}) {
  const tab = query.tab === 'review' ? 'review' : 'trends';

  // Insights already exists to be looked at rather than acted on, so the
  // weekly reflection lives here rather than adding an eleventh nav item.
  const tabs = segmented(
    [
      { value: 'trends', label: 'Trends', icon: 'insights' },
      { value: 'review', label: 'Weekly review', icon: 'notes' },
    ],
    {
      value: tab,
      ariaLabel: 'Insights view',
      onChange: (value) =>
        navigate(`/insights${buildQuery({ tab: value === 'trends' ? undefined : value })}`, { replace: true }),
    }
  );

  if (tab === 'review') {
    return page({
      title: 'Insights',
      subtitle: 'A quiet look at how your attention has been spent.',
      wide: true,
      actions: [tabs],
      children: await reflectionView({ query }),
    });
  }

  const range = RANGES.some((r) => r.value === query.range) ? query.range : '30d';
  const data = await api.get('/insights', { range });
  const base = today();
  const head = data.headline;

  const dailyPoints = data.daily.map((point) => ({ ...point }));
  const weekdayRows = data.byWeekday.map((row) => ({ label: row.weekday, value: row.count }));
  const blockRows = data.byBlock.map((row) => ({ label: row.label, value: row.count }));
  const areaRows = data.byArea.map((row) => ({ label: row.label, value: row.completed + row.open, open: row.open, completed: row.completed }));
  const priorityRows = data.byPriority.map((row) => ({
    label: row.label[0].toUpperCase() + row.label.slice(1),
    value: row.open + row.completed,
    open: row.open,
    completed: row.completed,
    key: row.label,
  }));

  const hasActivity = head.completed > 0 || head.openNow > 0;

  const tiles = el('div', { class: 'grid grid-4', style: { marginBottom: '32px' } }, [
    statTile(head.completed, 'Completed', `in the last ${RANGES.find((r) => r.value === range).label}`),
    statTile(
      head.completionRate === null ? '—' : `${head.completionRate}%`,
      'Completion rate',
      head.completionRate === null
        ? 'nothing was due in this period'
        : `${head.settledInRange} of ${head.dueInRange} items due in this period`
    ),
    statTile(head.openNow, 'Open now', head.overdueNow ? `${head.overdueNow} overdue` : 'nothing overdue'),
    statTile(head.averagePerDay, 'Daily average', 'responsibilities completed'),
  ]);

  const rhythmNote = [
    data.reflection.busiestDay ? `Most of your completions land on ${data.reflection.busiestDay}.` : null,
    data.reflection.peakPeriod ? `Your steadiest period is the ${data.reflection.peakPeriod.toLowerCase()}.` : null,
  ].filter(Boolean).join(' ');

  const charts = el('div', { class: 'grid grid-2' }, [
    chartCard({
      title: 'Completion over time',
      note: `${head.completed} completed · ${head.created} created`,
      chart: barSeries(dailyPoints, { formatX: (p) => formatDate(p.date) }),
      table: tableView('Completions by day', ['Date', 'Completed'], dailyPoints.map((p) => [p.date, p.count])),
    }),
    chartCard({
      title: 'By area of life',
      note: 'open and completed together',
      chart: areaRows.length
        ? hbars(areaRows)
        : empty({ iconName: 'circle', title: 'Nothing assigned to an area yet.', body: 'Assign responsibilities to areas to see where your attention goes.' }),
      table: areaRows.length
        ? tableView('Responsibilities by area', ['Area', 'Open', 'Completed'], areaRows.map((r) => [r.label, r.open, r.completed]))
        : null,
    }),
    chartCard({
      title: 'By day of week',
      note: rhythmNote || 'when work tends to close',
      chart: hbars(weekdayRows),
      table: tableView('Completions by weekday', ['Day', 'Completed'], weekdayRows.map((r) => [r.label, r.value])),
    }),
    chartCard({
      title: 'By time of day',
      note: 'when you tend to finish things',
      chart: hbars(blockRows),
      table: tableView('Completions by period', ['Period', 'Completed'], blockRows.map((r) => [r.label, r.value])),
    }),
    chartCard({
      title: 'By priority',
      note: 'urgency is not the same as importance',
      chart: hbars(priorityRows, { colorFor: (row) => PRIORITY_COLOR[row.key] || 'var(--accent)' }),
      table: tableView('Responsibilities by priority', ['Priority', 'Open', 'Completed'],
        priorityRows.map((r) => [r.label, r.open, r.completed])),
    }),
    chartCard({
      title: 'Monthly trend',
      note: 'the last twelve months',
      chart: data.monthly.length
        ? hbars(data.monthly.map((m) => ({ label: formatDate(`${m.month}-01`, { month: 'long', year: 'numeric' }), value: m.count })))
        : empty({ iconName: 'insights', title: 'Not enough history yet.', body: 'A month or two of use will make this meaningful.' }),
      table: data.monthly.length
        ? tableView('Completions by month', ['Month', 'Completed'], data.monthly.map((m) => [m.month, m.count]))
        : null,
    }),
  ]);

  const projectSection = data.byProject.length
    ? el('section', { class: 'section' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-title' }, [el('h2', { text: 'Project progress', style: { fontSize: '1.125rem' } })]),
          el('a', { class: 'btn btn-ghost btn-sm', href: '#/projects' }, [el('span', { text: 'All projects' }), icon('arrowRight', { size: 14 })]),
        ]),
        el('div', { class: 'card' }, [
          el('div', { class: 'stack gap-4' },
            data.byProject.map((project) =>
              el('a', { class: 'stack gap-2', href: `#/projects/${project.id}` }, [
                el('div', { class: 'row gap-3' }, [
                  el('span', { class: 'small grow truncate', text: project.name }),
                  el('span', { class: 'micro subtle', text: `${project.done}/${project.total}` }),
                  el('span', { class: 'micro', style: { minWidth: '34px', textAlign: 'right' }, text: `${project.progress}%` }),
                ]),
                meter(project.progress),
                project.deadline
                  ? el('span', {
                      class: 'micro subtle',
                      text: project.daysLeft < 0 ? `${Math.abs(project.daysLeft)} days past deadline` : `${project.daysLeft} days remaining`,
                    })
                  : null,
              ])
            )
          ),
        ]),
      ])
    : null;

  const objectiveSection = data.objectives.length
    ? el('section', { class: 'section' }, [
        el('div', { class: 'section-head' }, [
          el('div', { class: 'section-title' }, [el('h2', { text: 'Objective progress', style: { fontSize: '1.125rem' } })]),
          el('a', { class: 'btn btn-ghost btn-sm', href: '#/objectives' }, [el('span', { text: 'All objectives' }), icon('arrowRight', { size: 14 })]),
        ]),
        el('div', { class: 'grid grid-2' },
          data.objectives.map((objective) =>
            el('a', { class: 'card', href: `#/objectives/${objective.id}` }, [
              el('div', { class: 'stack gap-2' }, [
                el('span', { class: 'eyebrow', text: objective.horizon }),
                el('h3', { text: objective.title, style: { fontSize: '1rem' } }),
                meter(objective.progress),
                el('span', {
                  class: 'micro subtle',
                  text: [
                    `${objective.progress}% complete`,
                    objective.deadline ? relativeDate(objective.deadline, base) : null,
                  ].filter(Boolean).join(' · '),
                }),
              ]),
            ])
          )
        ),
      ])
    : null;

  const reflection = el('div', { class: 'notice', style: { marginTop: '32px' } }, [
    el('p', { class: 'small' }, [
      el('span', {
        text: [
          rhythmNote,
          data.reflection.unassigned
            ? `${data.reflection.unassigned} open ${data.reflection.unassigned === 1 ? 'responsibility is' : 'responsibilities are'} not assigned to an area of life.`
            : null,
          head.overdueNow
            ? `${head.overdueNow} ${head.overdueNow === 1 ? 'item is' : 'items are'} past their date — worth deciding whether they still matter.`
            : 'Nothing is overdue.',
        ].filter(Boolean).join(' ') || 'Use TELOS for a while and patterns will appear here.',
      }),
    ]),
  ]);

  return page({
    title: 'Insights',
    subtitle: 'A quiet look at how your attention has been spent.',
    wide: true,
    actions: [
      tabs,
      segmented(RANGES, {
        value: range,
        ariaLabel: 'Time range',
        onChange: (v) => navigate(`/insights${buildQuery({ ...query, range: v })}`, { replace: true }),
      }),
    ],
    children: hasActivity
      ? [tiles, charts, projectSection, objectiveSection, reflection]
      : el('div', { class: 'card' }, [
          empty({
            iconName: 'insights',
            title: 'Nothing to reflect on yet.',
            body: 'Once you have completed a few responsibilities, TELOS will show you where your attention has been going.',
            action: el('a', { class: 'btn btn-sm', href: '#/tasks', style: { marginTop: '12px' } }, [el('span', { text: 'Open my tasks' })]),
          }),
        ]),
  });
}

export default insightsView;
