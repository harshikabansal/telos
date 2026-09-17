/**
 * Hash routing. TELOS is a single document; the hash keeps deep links working
 * without the server needing to know about client routes.
 */

const routes = [];
let current = null;
let notFoundHandler = null;

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    `^${pattern
      .replace(/\//g, '\\/')
      .replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })}$`
  );
  routes.push({ regex, keys, handler });
}

export const setNotFound = (handler) => {
  notFoundHandler = handler;
};

export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return {
    path: path.startsWith('/') ? path : `/${path}`,
    query: Object.fromEntries(new URLSearchParams(search)),
  };
}

export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) {
    resolve();
    return;
  }
  if (replace) window.history.replaceState(null, '', target);
  else window.location.hash = target;
  if (replace) resolve();
}

export function currentRoute() {
  return current;
}

export function resolve() {
  const { path, query } = parseHash();
  for (const entry of routes) {
    const match = path.match(entry.regex);
    if (!match) continue;
    const params = Object.fromEntries(entry.keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
    current = { path, params, query };
    entry.handler({ params, query, path });
    return;
  }
  current = { path, params: {}, query };
  notFoundHandler?.({ path, query });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
