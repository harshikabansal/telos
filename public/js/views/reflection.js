import api from '../api.js';
import { clear, debounce, el } from '../dom.js';
import { icon } from '../icons.js';
import { chip, confirmDialog, empty, meter, notifyError, toast } from '../ui.js';
import { addDays, formatDate, relativeDate, timeAgo, today } from '../dates.js';
import { buildQuery, navigate } from '../router.js';
import { page } from '../shell.js';

/**
 * The weekly reflection.
 *
 * TELOS supplies the week and the questions; the writing is the person's. The
 * figures are computed from the completion history rather than recalled, and
 * the tone is deliberately flat — a week where nothing moved is reported as
 * plainly as a week where everything did. There is no score here, and nothing
 * that would make someone feel judged for falling behind.
 */

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const periodLabel = (start, end) =>
  `${formatDate(start, { month: 'short', day: 'numeric' })} – ${formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;

/* ------------------------------------------------------------------ *
 * The week at a glance
 * ------------------------------------------------------------------ */

const BAR_MAX_PX = 60;

function weekBars(byDay, weekStart) {
  const max = Math.max(1, ...byDay.map((d) => d.count));
  // Rotate so the bars start on the account's own first day of the week.
  const firstDay = new Date(`${weekStart}T00:00:00Z`).getUTCDay();
  const ordered = Array.from({ length: 7 }, (_, i) => byDay[(firstDay + i) % 7]);

  return el('div', {
    class: 'week-chart',
    role: 'img',
    'aria-label': ordered.map((entry) => `${entry.day}: ${entry.count}`).join(', '),
  }, [
    el('div', { class: 'week-bars' },
      ordered.map((entry) =>
        el('i', {
          class: entry.count ? '' : 'empty',
          title: `${entry.day}: ${entry.count}`,
          style: { height: `${entry.count ? Math.max(6, Math.round((entry.count / max) * BAR_MAX_PX)) : 3}px` },
        })
      )
    ),
    el('div', { class: 'week-labels' },
      ordered.map((entry) => el('span', { text: entry.day.slice(0, 1) }))
    ),
  ]);
}

const card = (title, note, children) =>
  el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack' }, [
        el('h3', { text: title, style: { fontSize: '1rem' } }),
        note ? el('span', { class: 'micro subtle', text: note }) : null,
      ]),
    ]),
    ...(Array.isArray(children) ? children : [children]),
  ]);

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */

export async function reflectionView({ query = {} } = {}) {
  const week = /^\d{4}-\d{2}-\d{2}$/.test(query.week || '') ? query.week : undefined;
  const data = await api.get('/reflections/review', { week });
  const { review, prompts, headline } = data;
  const base = today();

  const go = (changes) => navigate(`/insights${buildQuery({ ...query, tab: 'review', ...changes })}`, { replace: true });

  /* ---------------------------- Navigation --------------------------- */

  const header = el('div', { class: 'review-head' }, [
    el('div', { class: 'stack gap-2' }, [
      el('div', { class: 'row gap-3' }, [
        el('span', { class: 'eyebrow', text: review.isCurrentWeek ? 'This week' : 'Week of' }),
        el('span', { class: 'small muted', text: periodLabel(review.periodStart, review.periodEnd) }),
        review.isCurrentWeek ? chip('In progress') : null,
      ]),
      el('p', { class: 'review-headline', text: headline }),
    ]),
    el('div', { class: 'row gap-2' }, [
      el('button', {
        class: 'btn-icon', type: 'button', 'aria-label': 'Previous week',
        onClick: () => go({ week: addDays(review.periodStart, -7) }),
      }, [icon('chevronLeft', { size: 18 })]),
      el('button', {
        class: 'btn btn-sm', type: 'button', text: 'This week',
        onClick: () => go({ week: undefined }),
      }),
      el('button', {
        class: 'btn-icon', type: 'button', 'aria-label': 'Next week',
        disabled: review.isCurrentWeek,
        onClick: () => go({ week: addDays(review.periodStart, 7) }),
      }, [icon('chevronRight', { size: 18 })]),
    ]),
  ]);

  /* ------------------------------ Writing ---------------------------- */

  const existing = data.reflection;
  const status = el('span', {
    class: 'micro subtle',
    text: existing ? `Saved ${timeAgo(existing.updatedAt)}` : 'Not saved yet',
  });

  const writing = el('textarea', {
    class: 'reflection-write',
    placeholder: 'What actually happened this week, and what do you want to carry into the next one?',
    'aria-label': 'Your reflection',
  }, existing?.body ?? '');

  const save = debounce(async (value) => {
    if (!value.trim()) return;
    try {
      status.textContent = 'Saving…';
      const result = await api.post('/reflections', { week: review.periodStart, body: value });
      status.textContent = `Saved ${timeAgo(result.reflection.updatedAt)}`;
    } catch (error) {
      status.textContent = 'Not saved';
      notifyError(error);
    }
  }, 900);
  writing.addEventListener('input', () => save(writing.value));

  /**
   * A prompt is a question, not a template. Choosing one drops it into the
   * writing space as a heading the person answers in their own words.
   */
  const promptList = el('div', {},
    prompts.map((prompt) =>
      el('button', {
        class: 'prompt-line', type: 'button',
        onClick: () => {
          const prefix = writing.value.trim() ? `${writing.value.replace(/\s+$/, '')}\n\n` : '';
          writing.value = `${prefix}${prompt}\n`;
          writing.focus();
          writing.setSelectionRange(writing.value.length, writing.value.length);
          save(writing.value);
        },
      }, [icon('chevronRight', { size: 14 }), el('span', { text: prompt })])
    )
  );

  const writingCard = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('div', { class: 'stack' }, [
        el('h3', { text: 'Your reflection', style: { fontSize: '1rem' } }),
        el('span', { class: 'micro subtle', text: 'Written by you, saved as you type. Nobody else sees it.' }),
      ]),
      status,
    ]),
    writing,
    el('div', { class: 'stack gap-1', style: { marginTop: '20px' } }, [
      el('span', { class: 'eyebrow', text: 'Questions worth answering' }),
      promptList,
    ]),
    existing
      ? el('div', { class: 'row', style: { marginTop: '16px' } }, [
          el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Delete this reflection',
            onClick: async () => {
              const ok = await confirmDialog({
                title: 'Delete this reflection?',
                message: 'What you wrote about this week will be removed. The week itself is unaffected.',
                confirmLabel: 'Delete', tone: 'danger',
              });
              if (!ok) return;
              try {
                await api.del(`/reflections/${existing.id}`);
                toast('Reflection deleted.');
                go({});
              } catch (error) {
                notifyError(error);
              }
            },
          }),
        ])
      : null,
  ]);

  /* ------------------------------ The week --------------------------- */

  const movedCard = card(
    'What moved',
    review.completed.previousCount
      ? `${plural(review.completed.count, 'completed', 'completed')}, against ${review.completed.previousCount} the week before`
      : plural(review.completed.count, 'completed', 'completed'),
    [
      weekBars(review.completed.byDay, review.periodStart),
      review.completed.items.length
        ? el('div', { class: 'review-list', style: { marginTop: '16px' } },
            review.completed.items.slice(0, 8).map((item) =>
              el('div', { class: 'review-item' }, [
                icon('check', { size: 13 }),
                el('span', { class: 'grow', text: item.title }),
                el('span', { class: 'when', text: formatDate(item.on, { weekday: 'short' }) }),
              ])
            )
          )
        : el('p', { class: 'hint', style: { marginTop: '12px' }, text: 'Nothing was completed in this week.' }),
      review.completed.items.length > 8
        ? el('p', { class: 'micro subtle', style: { marginTop: '8px' }, text: `and ${review.completed.items.length - 8} more` })
        : null,
    ]
  );

  const slippedCard = card(
    'Still open',
    review.slipped.length ? 'Due in this week, not yet done' : null,
    review.slipped.length
      ? el('div', {}, [
          el('div', { class: 'review-list' },
            review.slipped.slice(0, 8).map((item) =>
              el('div', { class: 'review-item' }, [
                el('span', { class: `prio ${item.priority}` }),
                el('span', { class: 'grow', text: item.title }),
                // The weekday within the week being reviewed, rather than a
                // distance from today — "Yesterday" means nothing on a week
                // being read six months later.
                el('span', { class: 'when', text: formatDate(item.dueDate, { weekday: 'short' }) }),
              ])
            )
          ),
          review.slipped.length > 8
            ? el('p', { class: 'micro subtle', style: { marginTop: '8px' }, text: `and ${review.slipped.length - 8} more` })
            : null,
        ])
      : el('p', { class: 'hint', text: 'Everything due in this week was done.' })
  );

  const laddersCard = (review.milestones.length || review.movedObjectives.length || review.movedProjects.length)
    ? card('What it added up to', 'Where the week landed against the bigger picture', [
        el('div', { class: 'stack gap-4' }, [
          review.milestones.length
            ? el('div', { class: 'stack gap-2' }, [
                el('span', { class: 'eyebrow', text: 'Milestones reached' }),
                ...review.milestones.map((m) =>
                  el('div', { class: 'review-item' }, [
                    icon('milestone', { size: 13 }),
                    el('span', { class: 'grow', text: m.title }),
                    m.objectiveTitle ? el('span', { class: 'when', text: m.objectiveTitle }) : null,
                  ])
                ),
              ])
            : null,
          review.movedObjectives.length
            ? el('div', { class: 'stack gap-2' }, [
                el('span', { class: 'eyebrow', text: 'Objectives that moved' }),
                ...review.movedObjectives.map((o) =>
                  el('div', { class: 'stack gap-1' }, [
                    el('div', { class: 'row gap-3' }, [
                      el('span', { class: 'small grow truncate', text: o.title }),
                      el('span', { class: 'micro subtle', text: `${o.progress}%` }),
                    ]),
                    meter(o.progress),
                  ])
                ),
              ])
            : null,
          review.movedProjects.length
            ? el('div', { class: 'stack gap-2' }, [
                el('span', { class: 'eyebrow', text: 'Projects that moved' }),
                ...review.movedProjects.map((p) =>
                  el('div', { class: 'review-item' }, [
                    icon('projects', { size: 13 }),
                    el('span', { class: 'grow', text: p.name }),
                    el('span', { class: 'when', text: `${p.done}/${p.total}` }),
                  ])
                ),
              ])
            : null,
        ].filter(Boolean)),
      ])
    : null;

  const activeAreas = review.byArea.filter((row) => row.count > 0);
  const attentionCard = card('Where your attention went', null, [
    activeAreas.length
      ? el('div', { class: 'stack gap-3' },
          activeAreas.map((row) => {
            const share = Math.round((row.count / Math.max(1, review.completed.count)) * 100);
            return el('div', { class: 'hbar-row' }, [
              el('span', { class: 'truncate', title: row.name, text: row.name }),
              el('div', { class: 'hbar' }, [el('i', { style: { width: `${share}%` } })]),
              el('span', { class: 'hbar-num', text: String(row.count) }),
            ]);
          })
        )
      : el('p', { class: 'hint', text: 'No completions to attribute this week.' }),
    review.wentQuiet.length
      ? el('p', { class: 'hint', style: { marginTop: '14px' } }, [
          el('span', { text: `${review.wentQuiet.slice(0, 3).join(', ')} had your attention last week and none this week.` }),
        ])
      : null,
  ]);

  const aheadCard = review.ahead.length
    ? card('The week ahead', `${plural(review.ahead.length, 'thing', 'things')} already dated`, [
        el('div', { class: 'review-list' },
          review.ahead.map((item) =>
            el('div', { class: 'review-item' }, [
              el('span', { class: `prio ${item.priority}` }),
              el('span', { class: 'grow', text: item.title }),
              el('span', { class: 'when', text: relativeDate(item.dueDate, base) }),
            ])
          )
        ),
      ])
    : null;

  const lingeringCard = review.lingering.length
    ? card('Open for a while', 'Not urgent — just quietly still here', [
        el('div', { class: 'review-list' },
          review.lingering.map((item) =>
            el('div', { class: 'review-item' }, [
              icon('clock', { size: 13 }),
              el('span', { class: 'grow', text: item.title }),
              el('span', { class: 'when', text: `${item.ageDays} days` }),
            ])
          )
        ),
      ])
    : null;

  return el('div', { class: 'stack gap-5' }, [
    header,
    writingCard,
    el('div', { class: 'review-grid' }, [movedCard, slippedCard, attentionCard, aheadCard, lingeringCard].filter(Boolean)),
    laddersCard,
    await pastReflections(review.periodStart),
  ].filter(Boolean));
}

/* ------------------------------------------------------------------ *
 * Looking back
 * ------------------------------------------------------------------ */

async function pastReflections(currentPeriod) {
  let reflections = [];
  try {
    reflections = (await api.get('/reflections')).reflections;
  } catch {
    return null;
  }
  const others = reflections.filter((entry) => entry.periodStart !== currentPeriod);
  if (!others.length) return null;

  return el('section', { class: 'section', style: { marginTop: '8px' } }, [
    el('div', { class: 'section-head' }, [
      el('div', { class: 'section-title' }, [
        el('h2', { text: 'Earlier reflections', style: { fontSize: '1.125rem' } }),
        el('span', { class: 'count-chip', text: String(others.length) }),
      ]),
    ]),
    el('div', { class: 'stack gap-5' },
      others.slice(0, 8).map((entry) =>
        el('div', { class: 'past-reflection' }, [
          el('button', {
            class: 'eyebrow', type: 'button', style: { textAlign: 'left' },
            onClick: () => navigate(`/insights${buildQuery({ tab: 'review', week: entry.periodStart })}`, { replace: true }),
            text: periodLabel(entry.periodStart, entry.periodEnd),
          }),
          entry.stats?.headline ? el('p', { class: 'micro subtle', text: entry.stats.headline }) : null,
          el('blockquote', { text: entry.body }),
        ])
      )
    ),
  ]);
}

export default reflectionView;
