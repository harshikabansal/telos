import api from '../api.js';
import { clear, el } from '../dom.js';
import { icon } from '../icons.js';
import { field, notifyError, select } from '../ui.js';
import { navigate } from '../router.js';
import { loadReference, setUser, state } from '../store.js';
import { addDays, addMonths, today } from '../dates.js';

/**
 * Four short steps. Onboarding introduces the ladder TELOS is built on —
 * objective, milestone, project, responsibility — by having the user walk down
 * it once, then gets out of the way.
 */
export function onboardingView() {
  const container = el('div', { class: 'onboard' });
  const card = el('div', { class: 'onboard-card' });
  container.append(card);

  const answers = {
    areas: new Set(),
    objectiveTitle: '',
    objectiveHorizon: 'year',
    objectiveDeadline: '',
    milestone: '',
    project: '',
    task: '',
    taskDue: today(),
  };

  let step = 0;
  const TOTAL = 4;

  const steps = () =>
    el('div', { class: 'onboard-steps', 'aria-label': `Step ${step + 1} of ${TOTAL}` },
      Array.from({ length: TOTAL }, (_, i) => el('i', { class: i <= step ? 'active' : '' }))
    );

  const footer = (backLabel, nextLabel, onNext, { skip = null } = {}) =>
    el('div', { class: 'row gap-3', style: { marginTop: '32px', justifyContent: 'space-between' } }, [
      step > 0
        ? el('button', { class: 'btn btn-ghost', type: 'button', text: backLabel, onClick: () => { step -= 1; render(); } })
        : el('span'),
      el('div', { class: 'row gap-3' }, [
        skip ? el('button', { class: 'btn btn-ghost', type: 'button', text: 'Skip', onClick: skip }) : null,
        el('button', { class: 'btn btn-primary', type: 'button', text: nextLabel, onClick: onNext }),
      ]),
    ]);

  /* ----------------------------- Step 1 ------------------------------- */

  function stepAreas() {
    const grid = el('div', { class: 'choice-grid' });
    for (const area of state.areas) {
      const active = answers.areas.has(area.id);
      grid.append(
        el('button', {
          class: 'choice', type: 'button', 'aria-pressed': String(active),
          onClick: (event) => {
            if (answers.areas.has(area.id)) answers.areas.delete(area.id);
            else answers.areas.add(area.id);
            event.currentTarget.setAttribute('aria-pressed', String(answers.areas.has(area.id)));
          },
        }, [icon(area.icon, { size: 16 }), el('span', { text: area.name })])
      );
    }

    return el('div', {}, [
      steps(),
      el('p', { class: 'eyebrow', text: 'Step one' }),
      el('h1', { style: { margin: '8px 0 10px' }, text: 'What matters?' }),
      el('p', { class: 'muted small', style: { maxWidth: '46ch' }, text: 'Choose the areas of life you want TELOS to hold. You can add, rename or remove these at any time.' }),
      el('div', { style: { marginTop: '28px' } }, [grid]),
      footer('Back', 'Continue', () => { step = 1; render(); }),
    ]);
  }

  /* ----------------------------- Step 2 ------------------------------- */

  function stepObjective() {
    const titleInput = el('input', {
      class: 'input', value: answers.objectiveTitle, dataset: { autofocus: '' },
      placeholder: 'Build a strong professional portfolio',
      onInput: (e) => { answers.objectiveTitle = e.target.value; },
    });
    const horizon = select(
      [
        { value: 'year', label: 'This year' },
        { value: 'quarter', label: 'This quarter' },
        { value: 'month', label: 'This month' },
        { value: 'life', label: 'A longer horizon' },
      ],
      {
        value: answers.objectiveHorizon,
        onChange: (v) => {
          answers.objectiveHorizon = v;
          deadlineInput.value =
            v === 'month' ? addMonths(today(), 1)
            : v === 'quarter' ? addMonths(today(), 3)
            : v === 'year' ? `${new Date().getFullYear()}-12-31`
            : '';
          answers.objectiveDeadline = deadlineInput.value;
        },
      }
    );
    const deadlineInput = el('input', {
      class: 'input', type: 'date', value: answers.objectiveDeadline || `${new Date().getFullYear()}-12-31`,
      onChange: (e) => { answers.objectiveDeadline = e.target.value; },
    });
    answers.objectiveDeadline = deadlineInput.value;

    return el('div', {}, [
      steps(),
      el('p', { class: 'eyebrow', text: 'Step two' }),
      el('h1', { style: { margin: '8px 0 10px' }, text: 'What are you moving toward?' }),
      el('p', { class: 'muted small', style: { maxWidth: '46ch' }, text: 'An objective is an outcome you want to reach, not another item to check off.' }),
      el('div', { class: 'stack gap-4', style: { marginTop: '28px' } }, [
        field('Objective', titleInput),
        el('div', { class: 'grid grid-2' }, [
          field('Horizon', horizon),
          field('Target date', deadlineInput),
        ]),
      ]),
      footer('Back', 'Continue', () => {
        if (!answers.objectiveTitle.trim()) {
          titleInput.setAttribute('aria-invalid', 'true');
          titleInput.focus();
          return;
        }
        step = 2;
        render();
      }, { skip: () => finish({ skipStructure: true }) }),
    ]);
  }

  /* ----------------------------- Step 3 ------------------------------- */

  function stepLadder() {
    const milestoneInput = el('input', {
      class: 'input', value: answers.milestone, dataset: { autofocus: '' },
      placeholder: 'Complete three portfolio projects',
      onInput: (e) => { answers.milestone = e.target.value; },
    });
    const projectInput = el('input', {
      class: 'input', value: answers.project, placeholder: 'Build portfolio website',
      onInput: (e) => { answers.project = e.target.value; },
    });
    const taskInput = el('input', {
      class: 'input', value: answers.task, placeholder: 'Draft the homepage structure',
      onInput: (e) => { answers.task = e.target.value; },
    });
    const dueInput = el('input', {
      class: 'input', type: 'date', value: answers.taskDue,
      onChange: (e) => { answers.taskDue = e.target.value; },
    });

    const ladder = el('div', { class: 'stack gap-3', style: { marginTop: '28px' } }, [
      el('div', { class: 'notice' }, [
        el('span', { class: 'small', text: `Objective · ${answers.objectiveTitle}` }),
      ]),
      field('Milestone', milestoneInput, 'A meaningful marker on the way there.'),
      field('Project', projectInput, 'Where several responsibilities move toward one outcome.'),
      el('div', { class: 'grid grid-2' }, [
        field('First responsibility', taskInput),
        field('When', dueInput),
      ]),
    ]);

    return el('div', {}, [
      steps(),
      el('p', { class: 'eyebrow', text: 'Step three' }),
      el('h1', { style: { margin: '8px 0 10px' }, text: 'What comes next?' }),
      el('p', { class: 'muted small', style: { maxWidth: '48ch' }, text: 'Break the objective down until it reaches something you could start today.' }),
      ladder,
      footer('Back', 'Continue', () => { step = 3; render(); }, { skip: () => finish({ skipStructure: true }) }),
    ]);
  }

  /* ----------------------------- Step 4 ------------------------------- */

  function stepBegin() {
    const summary = el('div', { class: 'stack gap-2', style: { marginTop: '24px' } });
    const line = (label, value) =>
      value
        ? el('div', { class: 'row gap-3' }, [
            el('span', { class: 'eyebrow', style: { minWidth: '104px' }, text: label }),
            el('span', { class: 'small', text: value }),
          ])
        : null;
    summary.append(
      line('Areas', `${answers.areas.size || state.areas.length} selected`),
      line('Objective', answers.objectiveTitle),
      line('Milestone', answers.milestone),
      line('Project', answers.project),
      line('Today', answers.task)
    );

    const button = el('button', { class: 'btn btn-primary btn-lg', type: 'button', text: 'Enter TELOS' });
    button.addEventListener('click', () => finish({}));

    return el('div', {}, [
      steps(),
      el('p', { class: 'eyebrow', text: 'Step four' }),
      el('h1', { style: { margin: '8px 0 10px' }, text: 'Your direction is clear.' }),
      el('p', { class: 'muted', style: { maxWidth: '44ch' }, text: 'Now decide what deserves your attention today.' }),
      summary,
      el('div', { class: 'row gap-3', style: { marginTop: '32px', justifyContent: 'space-between' } }, [
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Back', onClick: () => { step = 2; render(); } }),
        button,
      ]),
    ]);
  }

  /* ------------------------------ Commit ------------------------------- */

  async function finish({ skipStructure = false }) {
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      // Areas the user did not choose are archived rather than deleted, so
      // nothing is lost if they change their mind.
      if (answers.areas.size) {
        await Promise.all(
          state.areas
            .filter((area) => !answers.areas.has(area.id))
            .map((area) => api.patch(`/areas/${area.id}`, { archived: true }).catch(() => {}))
        );
      }

      if (!skipStructure && answers.objectiveTitle.trim()) {
        const objectiveResult = await api.post('/objectives', {
          title: answers.objectiveTitle.trim(),
          horizon: answers.objectiveHorizon,
          deadline: answers.objectiveDeadline || null,
          areaId: [...answers.areas][0] || null,
          milestones: answers.milestone.trim() ? [answers.milestone.trim()] : [],
        });
        const objective = objectiveResult.objective;
        const milestoneId = objective.milestones?.[0]?.id || null;

        let projectId = null;
        if (answers.project.trim()) {
          const projectResult = await api.post('/projects', {
            name: answers.project.trim(),
            objectiveId: objective.id,
            milestoneId,
            areaId: [...answers.areas][0] || null,
          });
          projectId = projectResult.project.id;
        }

        if (answers.task.trim()) {
          await api.post('/tasks', {
            title: answers.task.trim(),
            dueDate: answers.taskDue || today(),
            projectId,
            milestoneId,
            objectiveId: objective.id,
            areaId: [...answers.areas][0] || null,
            priority: 'high',
          });
        }
      }

      const result = await api.patch('/account/me', { onboarded: true });
      setUser(result.user);
      await loadReference({ force: true });
      navigate('/', { replace: true });
    } catch (error) {
      notifyError(error);
      card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  }

  function render() {
    clear(card);
    const view = [stepAreas, stepObjective, stepLadder, stepBegin][step]();
    card.append(view);
    const autofocus = card.querySelector('[data-autofocus]');
    if (autofocus) requestAnimationFrame(() => autofocus.focus());
  }

  loadReference()
    .then(render)
    .catch((error) => {
      notifyError(error);
      render();
    });

  return container;
}

export default onboardingView;
