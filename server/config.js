import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/**
 * Minimal .env loader. Secrets never live in source control and are never
 * shipped to the client — the browser only ever receives data from /api.
 */
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = process.env.TELOS_DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * A stable server secret is required to derive session/token pepper values.
 * In production it must be supplied explicitly; in development we persist a
 * generated one so restarts do not invalidate every session.
 */
function resolveSecret() {
  if (process.env.TELOS_SECRET && process.env.TELOS_SECRET.length >= 32) {
    return process.env.TELOS_SECRET;
  }
  if (NODE_ENV === 'production') {
    throw new Error(
      'TELOS_SECRET must be set to a random value of at least 32 characters in production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
  const secretFile = path.join(DATA_DIR, '.dev-secret');
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  env: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  port: int(process.env.PORT, 4317),
  host: process.env.HOST || '127.0.0.1',
  dataDir: DATA_DIR,
  dbFile: process.env.TELOS_DB_FILE || path.join(DATA_DIR, 'telos.db'),
  secret: resolveSecret(),
  appUrl: process.env.TELOS_APP_URL || `http://localhost:${int(process.env.PORT, 4317)}`,

  // Sessions
  sessionCookie: 'telos_session',
  csrfCookie: 'telos_csrf',
  sessionTtlHours: int(process.env.TELOS_SESSION_TTL_HOURS, 12),
  rememberTtlDays: int(process.env.TELOS_REMEMBER_TTL_DAYS, 30),
  sessionIdleTimeoutMinutes: int(process.env.TELOS_SESSION_IDLE_MINUTES, 60 * 24 * 14),

  // Transport
  trustProxy: bool(process.env.TELOS_TRUST_PROXY, false),
  forceHttps: bool(process.env.TELOS_FORCE_HTTPS, NODE_ENV === 'production'),
  secureCookies: bool(process.env.TELOS_SECURE_COOKIES, NODE_ENV === 'production'),
  allowedOrigins: (process.env.TELOS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Credentials / abuse controls
  passwordMinLength: 10,
  maxLoginAttempts: int(process.env.TELOS_MAX_LOGIN_ATTEMPTS, 8),
  lockoutMinutes: int(process.env.TELOS_LOCKOUT_MINUTES, 15),
  resetTokenTtlMinutes: int(process.env.TELOS_RESET_TTL_MINUTES, 30),
  verifyTokenTtlHours: int(process.env.TELOS_VERIFY_TTL_HOURS, 48),

  // Delivery of reset / verification links. Without an SMTP transport the
  // tokens are written to the server log only — never returned to the browser
  // in production, so enumeration and interception remain impossible.
  emailTransport: process.env.TELOS_EMAIL_TRANSPORT || 'log',
  exposeDevTokens: bool(process.env.TELOS_EXPOSE_DEV_TOKENS, NODE_ENV !== 'production'),
};

export default config;
