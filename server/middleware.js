import config from './config.js';
import db, { newId, nowIso } from './db.js';
import {
  clearCookie,
  generateToken,
  hashToken,
  parseCookies,
  safeEqual,
  setCookie,
} from './security.js';

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Authentication required.') => new HttpError(401, msg);
export const forbidden = (msg = 'You do not have access to that.') => new HttpError(403, msg);
/**
 * Records belonging to another user are reported as "not found" rather than
 * "forbidden" so that object IDs cannot be probed for existence.
 */
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);

/* ------------------------------------------------------------------ *
 * Security headers
 * ------------------------------------------------------------------ */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()'
  );
  res.removeHeader('X-Powered-By');

  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (config.forceHttps) {
    if (!isSecure) {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    }
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // API responses must never be cached by a shared cache.
  if (req.path.startsWith('/api')) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

/**
 * CORS: TELOS is same-origin by default. Cross-origin credentialed requests are
 * only honoured for explicitly allow-listed origins; everything else is
 * answered without CORS headers, which the browser then blocks.
 */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

/* ------------------------------------------------------------------ *
 * Rate limiting (in-process fixed window; sufficient for a single node,
 * and keyed so that credential endpoints are throttled independently)
 * ------------------------------------------------------------------ */

const buckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) if (entry.resetAt <= now) buckets.delete(key);
}, 60_000).unref();

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs, max, key = 'global', message } = {}) {
  return (req, res, next) => {
    const bucketKey = `${key}:${clientIp(req)}`;
    const now = Date.now();
    let entry = buckets.get(bucketKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return next(
        new HttpError(429, message || 'Too many requests. Please wait a moment and try again.', {
          retryAfter: retry,
        })
      );
    }
    next();
  };
}

/** Consume an extra unit of quota — used to penalise failed credential attempts. */
export function penalise(req, key, windowMs, max) {
  const bucketKey = `${key}:${clientIp(req)}`;
  const now = Date.now();
  let entry = buckets.get(bucketKey);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, entry);
  }
  entry.count = Math.min(entry.count + 1, max + 50);
}

export function resetRateLimits() {
  buckets.clear();
}

/* ------------------------------------------------------------------ *
 * Cookies + CSRF
 * ------------------------------------------------------------------ */

export function cookies(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie || '');
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrf(res, token = generateToken(24)) {
  setCookie(res, config.csrfCookie, token, {
    httpOnly: false, // the SPA must read it to echo it back in a header
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 30,
  });
  return token;
}

/**
 * Double-submit CSRF protection, reinforced by an Origin/Referer check.
 * SameSite=Lax on the session cookie already blocks cross-site POSTs in modern
 * browsers; this is the defence-in-depth layer behind it.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (origin) {
    const allowed = [config.appUrl, ...config.allowedOrigins];
    const host = req.headers.host;
    const sameHost = (() => {
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    })();
    if (!sameHost && !allowed.includes(origin)) {
      return next(new HttpError(403, 'Request origin is not allowed.'));
    }
  }

  const cookieToken = req.cookies?.[config.csrfCookie];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new HttpError(403, 'Your session token has expired. Refresh the page and try again.'));
  }
  next();
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

const selectSession = db.prepare(`
  SELECT s.*, u.id AS u_id FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.revoked_at IS NULL
`);
const touchSession = db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`);
const selectUser = db.prepare(`SELECT * FROM users WHERE id = ?`);

export function createSession(userId, req, { remember = false } = {}) {
  const token = generateToken(32);
  const ttlMs = remember
    ? config.rememberTtlDays * 864e5
    : config.sessionTtlHours * 3600e3;
  const now = nowIso();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ip, user_agent, remember)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId(),
    userId,
    hashToken(token),
    now,
    now,
    new Date(Date.now() + ttlMs).toISOString(),
    clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 300),
    remember ? 1 : 0
  );
  return { token, ttlMs };
}

export function attachSessionCookie(res, token, ttlMs) {
  setCookie(res, config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: Math.floor(ttlMs / 1000),
  });
  issueCsrf(res);
}

/**
 * Ends a session. The CSRF token is rotated rather than removed: the sign-in
 * form that follows still needs one, and a fresh value ensures a token minted
 * under the old session cannot be replayed against the next.
 */
export function destroySessionCookies(res) {
  clearCookie(res, config.sessionCookie, { httpOnly: true, sameSite: 'Lax' });
  issueCsrf(res);
}

/**
 * Resolves the current session, if any. A session is rejected when it is
 * expired, revoked, or idle beyond the configured window; the cookie is then
 * cleared so a stale credential cannot linger in the browser.
 */
export function loadSession(req, res, next) {
  req.user = null;
  req.session = null;
  const token = req.cookies?.[config.sessionCookie];
  if (!token) return next();

  const row = selectSession.get(hashToken(token));
  if (!row) {
    destroySessionCookies(res);
    return next();
  }

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(row.id);
    destroySessionCookies(res);
    return next();
  }
  const idleLimit = config.sessionIdleTimeoutMinutes * 60_000;
  if (now - new Date(row.last_seen_at).getTime() > idleLimit) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), row.id);
    destroySessionCookies(res);
    return next();
  }

  // Throttle writes: only refresh last_seen once a minute.
  if (now - new Date(row.last_seen_at).getTime() > 60_000) {
    touchSession.run(nowIso(), row.id);
  }

  req.session = row;
  req.user = selectUser.get(row.user_id) || null;
  if (!req.user) {
    destroySessionCookies(res);
    req.session = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/* ------------------------------------------------------------------ *
 * Errors → JSON
 * ------------------------------------------------------------------ */

export function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api')) return next(notFound('That endpoint does not exist.'));
  next();
}

export function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : err.status || 500;

  if (status >= 500) {
    // Full detail to the operator, nothing revealing to the client.
    console.error(`[telos] ${req.method} ${req.originalUrl}`, err);
  }

  const payload = {
    error:
      status >= 500
        ? 'Something went wrong on our end. Please try again.'
        : err.message || 'Request could not be completed.',
  };
  if (err.details && status < 500) payload.details = err.details;

  if (!res.headersSent) res.status(status).json(payload);
}

/** Wraps an async handler so rejections reach the error middleware. */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
