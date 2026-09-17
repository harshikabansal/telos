import api from './api.js';

/**
 * A very small observable store. TELOS has no framework: views subscribe to
 * the slices they care about and re-render themselves when those change.
 */

const listeners = new Map();
let nextId = 1;

export const state = {
  user: null,
  areas: [],
  projects: [],
  objectives: [],
  ready: false,
  search: '',
};

export function subscribe(key, fn) {
  const id = nextId++;
  if (!listeners.has(key)) listeners.set(key, new Map());
  listeners.get(key).set(id, fn);
  return () => listeners.get(key)?.delete(id);
}

export function emit(key, payload) {
  for (const fn of listeners.get(key)?.values() ?? []) fn(payload);
  for (const fn of listeners.get('*')?.values() ?? []) fn(key, payload);
}

export function setUser(user) {
  state.user = user;
  applyAppearance(user);
  emit('user', user);
}

/** Theme, accent and density are user settings, applied to the document root. */
export function applyAppearance(user) {
  const root = document.documentElement;
  const theme = user?.theme || localStorage.getItem('telos.theme') || 'system';
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  root.dataset.theme = resolved;
  root.dataset.accent = user?.accent || 'clay';
  root.dataset.density = user?.density || 'comfortable';
  localStorage.setItem('telos.theme', theme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((state.user?.theme || localStorage.getItem('telos.theme')) === 'system') {
    applyAppearance(state.user);
  }
});

/** Reference data used across many views; refreshed after structural edits. */
export async function loadReference({ force = false } = {}) {
  if (state.ready && !force) return;
  const [areas, projects, objectives] = await Promise.all([
    api.get('/areas'),
    api.get('/projects'),
    api.get('/objectives', { includeMilestones: 'true' }),
  ]);
  state.areas = areas.areas;
  state.projects = projects.projects;
  state.objectives = objectives.objectives;
  state.ready = true;
  emit('reference', state);
}

export function invalidateReference() {
  state.ready = false;
}

export const areaById = (id) => state.areas.find((a) => a.id === id) || null;
export const projectById = (id) => state.projects.find((p) => p.id === id) || null;
export const objectiveById = (id) => state.objectives.find((o) => o.id === id) || null;
export function milestoneById(id) {
  for (const objective of state.objectives) {
    const found = objective.milestones?.find((m) => m.id === id);
    if (found) return found;
  }
  return null;
}
