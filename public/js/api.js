/**
 * API client.
 *
 * The session lives in an HttpOnly cookie the script cannot read, so nothing
 * sensitive is ever held in JavaScript. The CSRF token is read from its own
 * readable cookie and echoed in a header on every state-changing request.
 */

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const readCookie = (name) =>
  document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, path, body, options = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method)) {
    const token = readCookie('telos_csrf');
    if (token) headers['X-CSRF-Token'] = decodeURIComponent(token);
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach TELOS. Check your connection and try again.');
  }

  if (response.status === 204) return null;

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401 && !options.allowUnauthorized && onUnauthorized) onUnauthorized();
    throw new ApiError(
      response.status,
      payload?.error || 'That request could not be completed.',
      payload?.details
    );
  }
  return payload;
}

const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  get: (path, params, options) => request('GET', `/api${path}${query(params)}`, undefined, options),
  post: (path, body, options) => request('POST', `/api${path}`, body ?? {}, options),
  patch: (path, body, options) => request('PATCH', `/api${path}`, body ?? {}, options),
  del: (path, params, options) => request('DELETE', `/api${path}${query(params)}`, undefined, options),

  // Auth
  session: () => request('GET', '/api/auth/session', undefined, { allowUnauthorized: true }),
  register: (body) => request('POST', '/api/auth/register', body, { allowUnauthorized: true }),
  login: (body) => request('POST', '/api/auth/login', body, { allowUnauthorized: true }),
  logout: () => request('POST', '/api/auth/logout', {}, { allowUnauthorized: true }),
  forgotPassword: (body) => request('POST', '/api/auth/forgot-password', body, { allowUnauthorized: true }),
  resetPassword: (body) => request('POST', '/api/auth/reset-password', body, { allowUnauthorized: true }),
  verifyEmail: (token) => request('POST', '/api/auth/verify-email', { token }, { allowUnauthorized: true }),
  providers: () => request('GET', '/api/auth/providers', undefined, { allowUnauthorized: true }),
};

/** Triggers a file download of the account export without exposing a token. */
export function downloadExport() {
  const link = document.createElement('a');
  link.href = '/api/account/export';
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

export default api;
