import api, { setUnauthorizedHandler } from './api.js';
import { clear, el } from './dom.js';
import { navigate, parseHash, resolve, route, setNotFound, startRouter } from './router.js';
import { applyAppearance, loadReference, setUser, state } from './store.js';
import { toast } from './ui.js';
import {
  installShortcuts, markActiveNav, mountShell, page, refreshCounts, setContent, unmountShell,
} from './shell.js';

import { forgotView, loginView, registerView, resetView, verifyView } from './views/auth.js';
import { onboardingView } from './views/onboarding.js';
import { overviewView } from './views/overview.js';
import { tasksView } from './views/tasks.js';
import { calendarView } from './views/calendar.js';
import { projectsView, projectDetailView } from './views/projects.js';
import { objectivesView, objectiveDetailView } from './views/objectives.js';
import { insightsView } from './views/insights.js';
import { notesView } from './views/notes.js';
import { settingsView } from './views/settings.js';
import { searchView } from './views/search.js';

const root = document.getElementById('root');

const PUBLIC_ROUTES = new Set(['/login', '/register', '/forgot', '/reset', '/verify']);

/* ------------------------------------------------------------------ *
 * Rendering modes
 * ------------------------------------------------------------------ */

function renderPublic(node) {
  unmountShell(root);
  root.classList.remove('app-loading');
  root.append(node);
}

/**
 * Signed-in views are rendered inside the shell. Each view returns either a
 * node or a promise of one, so data loading and layout stay in one place.
 */
function renderApp(builder, context) {
  const content = mountShell(root);
  markActiveNav(context.path);
  const placeholder = el('div', { class: 'page' }, [
    el('div', { class: 'empty' }, [el('p', { class: 'small muted', text: 'Loading' })]),
  ]);
  setContent(placeholder);

  Promise.resolve()
    .then(() => builder(context))
    .then((node) => {
      // A slower load must not overwrite a newer navigation.
      if (parseHash().path !== context.path) return;
      setContent(node);
    })
    .catch((error) => {
      console.error(error);
      setContent(
        page({
          title: 'Something went wrong',
          subtitle: error.message || 'This view could not be loaded.',
          children: el('button', { class: 'btn', type: 'button', text: 'Try again', onClick: () => resolve() }),
        })
      );
    });
  return content;
}

/** Wraps a signed-in route with the authentication and onboarding gates. */
const guarded = (builder) => (context) => {
  if (!state.user) {
    sessionStorage.setItem('telos.returnTo', context.path + (Object.keys(context.query).length ? `?${new URLSearchParams(context.query)}` : ''));
    navigate('/login', { replace: true });
    return;
  }
  if (!state.user.onboarded && context.path !== '/welcome') {
    navigate('/welcome', { replace: true });
    return;
  }
  renderApp(builder, context);
};

const publicOnly = (builder) => (context) => {
  if (state.user && !['/verify', '/reset'].includes(context.path)) {
    navigate(state.user.onboarded ? '/' : '/welcome', { replace: true });
    return;
  }
  renderPublic(builder(context));
};

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

route('/login', publicOnly(loginView));
route('/register', publicOnly(registerView));
route('/forgot', publicOnly(forgotView));
route('/reset', publicOnly(resetView));
route('/verify', publicOnly(verifyView));

route('/welcome', (context) => {
  if (!state.user) {
    navigate('/login', { replace: true });
    return;
  }
  if (state.user.onboarded) {
    navigate('/', { replace: true });
    return;
  }
  renderPublic(onboardingView());
});

route('/', guarded(overviewView));
route('/tasks', guarded(tasksView));
route('/important', guarded((ctx) => tasksView({ ...ctx, query: { ...ctx.query, view: 'important' } })));
route('/recurring', guarded((ctx) => tasksView({ ...ctx, query: { ...ctx.query, view: 'recurring' } })));
route('/calendar', guarded(calendarView));
route('/projects', guarded(projectsView));
route('/projects/:id', guarded(projectDetailView));
route('/objectives', guarded(objectivesView));
route('/objectives/:id', guarded(objectiveDetailView));
route('/insights', guarded(insightsView));
route('/notes', guarded(notesView));
route('/settings', guarded(settingsView));
route('/search', guarded(searchView));

setNotFound((context) => {
  if (!state.user) {
    navigate('/login', { replace: true });
    return;
  }
  renderApp(
    () =>
      page({
        title: 'Nothing here',
        subtitle: 'That page does not exist in TELOS.',
        children: el('a', { class: 'btn btn-primary', href: '#/', text: 'Return to Overview' }),
      }),
    context
  );
});

/* ------------------------------------------------------------------ *
 * Session handling
 * ------------------------------------------------------------------ */

let signedOutOnce = false;
setUnauthorizedHandler(() => {
  if (signedOutOnce || !state.user) return;
  signedOutOnce = true;
  setUser(null);
  toast('Your session has ended. Please sign in again.', { tone: 'danger' });
  navigate('/login', { replace: true });
  setTimeout(() => {
    signedOutOnce = false;
  }, 3000);
});

// Any change to a responsibility refreshes the sidebar counts.
document.addEventListener('telos:tasks-changed', () => refreshCounts());

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  applyAppearance(null);

  let session = { authenticated: false };
  try {
    session = await api.session();
  } catch {
    renderPublic(
      el('div', { class: 'auth' }, [
        el('main', { class: 'auth-main' }, [
          el('div', { class: 'auth-card center' }, [
            el('h1', { text: 'TELOS is unreachable' }),
            el('p', { class: 'muted small', style: { marginTop: '8px' }, text: 'The server is not responding. Check that it is running, then reload.' }),
            el('button', {
              class: 'btn btn-primary btn-lg', style: { marginTop: '24px' },
              type: 'button', text: 'Reload', onClick: () => window.location.reload(),
            }),
          ]),
        ]),
      ])
    );
    return;
  }

  if (session.authenticated) {
    setUser(session.user);
    try {
      await loadReference();
    } catch { /* views load their own data and will report failures */ }
  } else {
    applyAppearance(null);
  }

  installShortcuts();
  startRouter();

  // Deep link honoured after signing in.
  const { path } = parseHash();
  if (session.authenticated && PUBLIC_ROUTES.has(path)) {
    const returnTo = sessionStorage.getItem('telos.returnTo');
    sessionStorage.removeItem('telos.returnTo');
    navigate(returnTo || (session.user.onboarded ? '/' : '/welcome'), { replace: true });
  }
  if (!session.authenticated && !PUBLIC_ROUTES.has(path)) {
    sessionStorage.setItem('telos.returnTo', path);
    navigate('/login', { replace: true });
  }
}

boot();
