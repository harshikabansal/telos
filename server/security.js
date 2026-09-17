import crypto from 'node:crypto';
import config from './config.js';

/* ------------------------------------------------------------------ *
 * Password hashing — scrypt (memory-hard, in Node core, no native deps)
 * Stored format: scrypt$N$r$p$saltB64$hashB64
 * ------------------------------------------------------------------ */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Constant-time-ish dummy verification, used when an account does not exist so
 * that login timing does not reveal whether an email is registered.
 */
const DUMMY_HASH = hashPassword(crypto.randomBytes(24).toString('hex'));
export function fakeVerify(password) {
  verifyPassword(String(password || ''), DUMMY_HASH);
}

/* ------------------------------------------------------------------ *
 * Opaque tokens. Only the HMAC of a token is persisted, so a database
 * disclosure cannot be replayed as a valid session or reset link.
 * ------------------------------------------------------------------ */

export const generateToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function hashToken(token) {
  return crypto.createHmac('sha256', config.secret).update(String(token)).digest('hex');
}

export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ *
 * Cookies
 * ------------------------------------------------------------------ */

export function parseCookies(header = '') {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure ?? config.secureCookies) parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookie = parts.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : [cookie]);
}

export function clearCookie(res, name, options = {}) {
  setCookie(res, name, '', { ...options, maxAge: 0 });
}

/* ------------------------------------------------------------------ *
 * Password strength
 * ------------------------------------------------------------------ */

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'letmein123', 'iloveyou1', 'admin12345', 'welcome123', 'abc12345',
  'passw0rd!', 'qwerty12345', 'monkey1234', 'sunshine123', 'princess123', 'football123',
  'telos12345', 'changeme123',
]);

export function passwordProblems(password, { email = '', name = '' } = {}) {
  const problems = [];
  const value = String(password || '');
  if (value.length < config.passwordMinLength) {
    problems.push(`Password must be at least ${config.passwordMinLength} characters.`);
  }
  if (value.length > 200) problems.push('Password must be 200 characters or fewer.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (classes < 3) {
    problems.push('Use at least three of: lowercase, uppercase, numbers, symbols.');
  }
  const lower = value.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) problems.push('That password is too common. Choose something less predictable.');
  const local = String(email).split('@')[0]?.toLowerCase();
  if (local && local.length > 2 && lower.includes(local)) {
    problems.push('Password must not contain your email address.');
  }
  for (const part of String(name).toLowerCase().split(/\s+/)) {
    if (part.length > 3 && lower.includes(part)) {
      problems.push('Password must not contain your name.');
      break;
    }
  }
  return problems;
}

/** 0–4 strength estimate used by the client meter (also computed server-side). */
export function passwordScore(password) {
  const value = String(password || '');
  if (!value) return 0;
  let score = 0;
  if (value.length >= 10) score += 1;
  if (value.length >= 14) score += 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;
  if (classes >= 3) score += 1;
  if (classes === 4 && value.length >= 12) score += 1;
  if (COMMON_PASSWORDS.has(value.toLowerCase())) score = 0;
  return Math.min(4, score);
}
