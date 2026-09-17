import api from './api.js';
import { clear, debounce, el } from './dom.js';
import { icon } from './icons.js';
import { menu, notifyError, toast } from './ui.js';
import { buildQuery, navigate, parseHash } from './router.js';
import { applyAppearance, setUser, state } from './store.js';
import { openQuickAdd } from './components/quickAdd.js';
import { openTaskEditor } from './components/taskEditor.js';
import { isAssistantOpen, openAssistant, closeAssistant } from './components/assistant.js';

const NAV = [
  { path: '/', label: 'Overview', icon: 'overview' },
  { path: '/tasks', label: 'My Tasks', icon: 'tasks' },
  { path: '/calendar', label: 'Calendar', icon: 'calendar' },
  { path: '/important', label: 'Important', icon: 'important' },
  { path: '/recurring', label: 'Recurring', icon: 'recurring' },
  { path: '/projects', label: 'Projects', icon: 'projects' },
  { path: '/objectives', label: 'Objectives', icon: 'objectives' },
  { path: '/insights', label: 'Insights', icon: 'insights' },
  { path: '/notes', label: 'Notes', icon: 'notes' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

const MOBILE_NAV = [
  { path: '/', label: 'Overview', icon: 'overview' },
  { path: '/tasks', label: 'Tasks', icon: 'tasks' },
  { action: 'add', label: 'Add', icon: 'plus' },
  { path: '/calendar', label: 'Calendar', icon: 'calendar' },
  { action: 'more', label: 'More', icon: 'menu' },
];

let shellNode = null;
let contentNode = null;
let navCounts = { overdue: 0, today: 0, important: 0 };

const initials = (name) =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'T';

export async function signOut() {
  try {
    await api.logout();
  } catch { /* the cookie is cleared regardless */ }
  setUser(null);
  window.location.hash = '#/login';
  window.location.reload();
}

function accountMenu(anchor) {
  const theme = state.user?.theme || 'system';
  menu(anchor, [
    { label: state.user?.email },
    { separator: true },
    { label: 'Settings', icon: 'settings', onClick: () => navigate('/settings') },
    { label: 'Privacy & security', icon: 'shield', onClick: () => navigate(`/settings${buildQuery({ section: 'privacy' })}`) },
    { separator: true },
    { label: 'Appearance' },
    ...[
      { value: 'light', label: 'Light', icon: 'sun' },
      { value: 'dark', label: 'Dark', icon: 'moon' },
      { value: 'system', label: 'System', icon: 'monitor' },
    ].map((option) => ({
      label: option.label,
      icon: option.icon,
      checked: theme === option.value,
      onClick: async () => {
        try {
          const result = await api.patch('/account/me', { theme: option.value });
          setUser(result.user);
        } catch (error) {
          notifyError(error);
        }
      },
    })),
    { separator: true },
    { label: 'Sign out', icon: 'logout', danger: true, onClick: signOut },
  ]);
}

function moreMenu(anchor) {
  menu(anchor, [
    { label: 'Assistant', icon: 'sparkle', onClick: () => openAssistant() },
    { separator: true },
    ...NAV.slice(3).map((item) => ({
      label: item.label, icon: item.icon, onClick: () => navigate(item.path),
    })),
    { separator: true },
    { label: 'Sign out', icon: 'logout', danger: true, onClick: signOut },
  ]);
}

function sidebar() {
  const nav = el('nav', { class: 'nav', 'aria-label': 'Primary' });
  for (const item of NAV) {
    const link = el('a', {
      class: 'nav-item', href: `#${item.path}`, dataset: { navPath: item.path },
    }, [
      icon(item.icon, { size: 17 }),
      el('span', { class: 'grow', text: item.label }),
      el('span', { class: 'nav-count', dataset: { navCount: item.path } }),
    ]);
    nav.append(link);
  }

  return el('aside', { class: 'sidebar' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'brand-mark', text: 'TELOS' })]),
    el('button', {
      class: 'btn btn-primary', type: 'button', style: { marginBottom: '20px' },
      onClick: () => openQuickAdd({ onSaved: refreshCounts }),
    }, [icon('plus', { size: 16 }), el('span', { text: 'Quick add' })]),
    nav,
    el('div', { class: 'sidebar-foot' }, [
      el('button', {
        class: 'user-button', type: 'button', 'aria-haspopup': 'menu',
        onClick: (event) => accountMenu(event.currentTarget),
      }, [
        el('span', { class: 'avatar', text: initials(state.user?.name) }),
        el('span', { class: 'grow stack' }, [
          el('span', { class: 'small truncate', text: state.user?.name || '' }),
          el('span', { class: 'micro subtle truncate', text: state.user?.email || '' }),
        ]),
        icon('chevronUp', { size: 14 }),
      ]),
    ]),
  ]);
}

function searchBox() {
  const input = el('input', {
    type: 'search', placeholder: 'Search everything', 'aria-label': 'Search',
    autocomplete: 'off', dataset: { globalSearch: '' },
  });
  const go = debounce((value) => {
    if (value.trim().length >= 2) navigate(`/search${buildQuery({ q: value.trim() })}`, { replace: true });
  }, 320);
  input.addEventListener('input', (event) => go(event.target.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      go.flush(event.target.value);
    }
    if (event.key === 'Escape') {
      event.target.value = '';
      event.target.blur();
    }
  });
  return el('div', { class: 'searchbox' }, [icon('search', { size: 16 }), input]);
}

function topbar() {
  return el('header', { class: 'topbar' }, [
    el('div', { class: 'grow row gap-3' }, [searchBox()]),
    el('button', {
      class: 'btn btn-sm', type: 'button', 'aria-label': 'Quick add',
      onClick: () => openQuickAdd({ onSaved: refreshCounts }),
    }, [icon('plus', { size: 15 }), el('span', { text: 'Add' })]),
    el('button', {
      class: 'btn-icon', type: 'button', 'aria-label': 'Assistant',
      title: 'Assistant',
      onClick: () => (isAssistantOpen() ? closeAssistant() : openAssistant()),
    }, [icon('sparkle', { size: 18 })]),
    el('button', {
      class: 'btn-icon', type: 'button', 'aria-label': 'Reminders',
      dataset: { remindersButton: '' },
      onClick: (event) => remindersMenu(event.currentTarget),
    }, [icon('bell', { size: 18 })]),
  ]);
}

function mobileHead() {
  return el('header', { class: 'mobile-head' }, [
    el('span', { class: 'brand-mark grow', text: 'TELOS' }),
    el('button', {
      class: 'btn-icon', type: 'button', 'aria-label': 'Search',
      onClick: () => navigate('/search'),
    }, [icon('search', { size: 18 })]),
    el('button', {
      class: 'btn-icon', type: 'button', 'aria-label': 'Account',
      onClick: (event) => accountMenu(event.currentTarget),
    }, [el('span', { class: 'avatar', text: initials(state.user?.name) })]),
  ]);
}

function mobileNav() {
  const nav = el('nav', { class: 'mobile-nav', 'aria-label': 'Primary' });
  for (const item of MOBILE_NAV) {
    if (item.action === 'add') {
      nav.append(
        el('button', {
          class: 'add', type: 'button', 'aria-label': 'Quick add',
          onClick: () => openQuickAdd({ onSaved: refreshCounts }),
        }, [icon('plus', { size: 20 })])
      );
      continue;
    }
    if (item.action === 'more') {
      nav.append(
        el('button', {
          type: 'button', 'aria-label': 'More', onClick: (event) => moreMenu(event.currentTarget),
        }, [icon(item.icon, { size: 19 }), el('span', { text: item.label })])
      );
      continue;
    }
    nav.append(
      el('a', { href: `#${item.path}`, dataset: { navPath: item.path } }, [
        icon(item.icon, { size: 19 }),
        el('span', { text: item.label }),
      ])
    );
  }
  return nav;
}

async function remindersMenu(anchor) {
  let reminders = [];
  try {
    const result = await api.get('/reminders/due');
    reminders = result.reminders;
  } catch { /* a quiet failure is better than an alarming one */ }

  if (!reminders.length) {
    menu(anchor, [{ label: 'Nothing needs your attention right now.' }]);
    return;
  }
  menu(anchor, [
    { label: 'Reminders' },
    ...reminders.map((reminder) => ({
      label: reminder.title,
      icon: 'bell',
      onClick: async () => {
        await api.post(`/reminders/${reminder.id}/acknowledge`, {}).catch(() => {});
        if (reminder.taskId) openTaskEditor({ taskId: reminder.taskId });
      },
    })),
  ]);
}

/** Sidebar counts: what is overdue, due today, and marked important. */
export async function refreshCounts() {
  try {
    const overview = await api.get('/overview');
    navCounts = {
      overdue: overview.summary.overdue,
      today: overview.summary.dueToday + overview.summary.overdue,
      important: overview.summary.important,
    };
    paintCounts();
  } catch { /* counts are decoration, never blocking */ }
}

function paintCounts() {
  const set = (path, value, alert = false) => {
    for (const node of document.querySelectorAll(`[data-nav-count="${path}"]`)) {
      node.textContent = value ? String(value) : '';
      node.classList.toggle('alert', Boolean(alert && value));
    }
  };
  set('/tasks', navCounts.today);
  set('/important', navCounts.important);
  set('/', navCounts.overdue, true);
}

export function markActiveNav(path) {
  for (const node of document.querySelectorAll('[data-nav-path]')) {
    const navPath = node.dataset.navPath;
    const active = navPath === '/' ? path === '/' : path.startsWith(navPath);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
}

/** Builds the shell once; subsequent navigations only replace the content. */
export function mountShell(root) {
  if (shellNode && root.contains(shellNode)) return contentNode;
  root.classList.remove('app-loading');
  clear(root);

  contentNode = el('div', { class: 'content', id: 'main' });
  shellNode = el('div', { class: 'shell' }, [
    sidebar(),
    el('div', { class: 'main' }, [mobileHead(), topbar(), contentNode]),
    mobileNav(),
  ]);
  root.append(shellNode);
  applyAppearance(state.user);
  refreshCounts();
  return contentNode;
}

export function unmountShell(root) {
  shellNode = null;
  contentNode = null;
  clear(root);
}

export function setContent(node) {
  if (!contentNode) return;
  clear(contentNode);
  contentNode.append(node);
  contentNode.scrollTop = 0;
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------------ *
 * Global keyboard shortcuts
 * ------------------------------------------------------------------ */

export function installShortcuts() {
  // A dialog or menu owns the keyboard while it is open: navigating the page
  // underneath it would discard whatever the user was in the middle of.
  const overlayOpen = () =>
    (document.getElementById('overlay-root')?.childElementCount ?? 0) > 0 ||
    document.querySelector('.menu') !== null;

  document.addEventListener('keydown', (event) => {
    if (overlayOpen()) return;
    const target = event.target;
    const typing = target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (event.key === '/' && !typing) {
      const search = document.querySelector('[data-global-search]');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
    if ((event.key === 'n' || event.key === 'N') && !typing && !event.metaKey && !event.ctrlKey) {
      if (!state.user) return;
      event.preventDefault();
      openQuickAdd({ onSaved: refreshCounts });
    }
    if ((event.key === 'a' || event.key === 'A') && !typing && !event.metaKey && !event.ctrlKey) {
      if (!state.user) return;
      event.preventDefault();
      if (isAssistantOpen()) closeAssistant();
      else openAssistant();
    }
    if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
      const search = document.querySelector('[data-global-search]');
      if (search) {
        event.preventDefault();
        search.focus();
      }
    }
    if (event.key === 'g' && !typing) {
      const onNext = (next) => {
        document.removeEventListener('keydown', onNext, true);
        const map = { o: '/', t: '/tasks', c: '/calendar', p: '/projects', i: '/insights', n: '/notes', s: '/settings' };
        if (map[next.key]) {
          next.preventDefault();
          navigate(map[next.key]);
        }
      };
      document.addEventListener('keydown', onNext, true);
      setTimeout(() => document.removeEventListener('keydown', onNext, true), 1400);
    }
  });
}

/** Page scaffold shared by every signed-in view. */
export function page({ title, subtitle, actions, children, wide = false }) {
  return el('div', { class: `page${wide ? ' page-wide' : ''}` }, [
    (title || actions)
      ? el('div', { class: 'page-head row gap-4', style: { justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap' } }, [
          el('div', {}, [
            title ? el('h1', { text: title }) : null,
            subtitle ? el('p', { class: 'page-sub', text: subtitle }) : null,
          ]),
          actions ? el('div', { class: 'row gap-2 wrap' }, actions) : null,
        ])
      : null,
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

export { openQuickAdd, toast, parseHash };
