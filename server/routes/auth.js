import express from 'express';
import config from '../config.js';
import db, { newId, nowIso } from '../db.js';
import {
  fakeVerify,
  generateToken,
  hashPassword,
  hashToken,
  passwordProblems,
  verifyPassword,
} from '../security.js';
import {
  HttpError,
  attachSessionCookie,
  clientIp,
  createSession,
  destroySessionCookies,
  issueCsrf,
  penalise,
  rateLimit,
  requireAuth,
  wrap,
} from '../middleware.js';
import { bool, email as vEmail, ensureObject, str, timezone as vTimezone, int, enumValue } from '../validate.js';
import { publicUser, seedDefaultAreas } from '../serialize.js';
import { deliverMail } from '../mailer.js';

const router = express.Router();

const LOGIN_WINDOW = 15 * 60_000;
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW,
  max: 12,
  key: 'login',
  message: 'Too many sign-in attempts. Please wait a few minutes before trying again.',
});
const signupLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 6,
  key: 'signup',
  message: 'Too many accounts created from this device. Please try again later.',
});
const resetLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 6,
  key: 'reset',
  message: 'Too many reset requests. Please try again later.',
});

/* ------------------------------------------------------------------ *
 * Session bootstrap — the SPA calls this on load.
 * ------------------------------------------------------------------ */

router.get('/session', (req, res) => {
  issueCsrf(res, req.cookies?.[config.csrfCookie] || undefined);
  if (!req.user) return res.json({ authenticated: false });
  res.json({ authenticated: true, user: publicUser(req.user) });
});

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

router.post(
  '/register',
  signupLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const name = str(body.name, 'Full name', { min: 1, max: 100, required: true });
    const email = vEmail(body.email);
    const password = str(body.password, 'Password', { min: 1, max: 200, required: true, trim: false });
    const confirm = str(body.confirmPassword, 'Password confirmation', { max: 200, trim: false });
    const accepted = bool(body.acceptedTerms);

    if (confirm !== undefined && confirm !== password) {
      throw new HttpError(400, 'The two passwords do not match.');
    }
    if (!accepted) {
      throw new HttpError(400, 'Please accept the terms and privacy notice to continue.');
    }
    const problems = passwordProblems(password, { email, name });
    if (problems.length) throw new HttpError(400, problems[0], { problems });

    const timezone = vTimezone(body.timezone || 'UTC');
    const weekStart = int(body.weekStart ?? 1, 'Week start', { min: 0, max: 6 });
    const workStart = str(body.workStart || '09:00', 'Working hours', { max: 5 });
    const workEnd = str(body.workEnd || '17:00', 'Working hours', { max: 5 });

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      // No enumeration: the message is identical in shape to a validation error
      // and does not confirm registration status beyond what signup requires.
      throw new HttpError(409, 'That email cannot be used to register. Try signing in instead.');
    }

    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, timezone, week_start, work_start, work_end,
                          default_reminder, notify_push, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      email,
      name,
      hashPassword(password),
      timezone,
      weekStart,
      workStart,
      workEnd,
      enumValue(body.defaultReminder, ['none', 'at_time', '15m', '30m', '1h', '1d'], 'Reminder preference', 'none'),
      bool(body.notifyPush, true) ? 1 : 0,
      now,
      now
    );

    seedDefaultAreas(id);

    // Email verification token (delivered out-of-band; never returned in prod).
    const verifyToken = generateToken(32);
    db.prepare(
      `INSERT INTO email_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(
      newId(),
      id,
      hashToken(verifyToken),
      new Date(Date.now() + config.verifyTokenTtlHours * 3600e3).toISOString(),
      now
    );
    const verifyUrl = `${config.appUrl}/#/verify?token=${verifyToken}`;
    deliverMail({
      to: email,
      subject: 'Confirm your TELOS account',
      body: `Welcome to TELOS.\n\nConfirm this address to secure your account:\n${verifyUrl}\n\nThis link expires in ${config.verifyTokenTtlHours} hours.`,
    });

    const { token, ttlMs } = createSession(id, req, { remember: bool(body.remember, false) });
    attachSessionCookie(res, token, ttlMs);

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    res.status(201).json({
      user: publicUser(user),
      ...(config.exposeDevTokens ? { devVerifyUrl: verifyUrl } : {}),
    });
  })
);

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const email = vEmail(body.email);
    const password = str(body.password, 'Password', { min: 1, max: 200, required: true, trim: false });
    const remember = bool(body.remember, false);

    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

    // Identical failure surface whether or not the account exists.
    const invalid = () => {
      penalise(req, 'login', LOGIN_WINDOW, 12);
      return new HttpError(401, 'That email and password combination is not correct.');
    };

    if (!user) {
      fakeVerify(password);
      throw invalid();
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutes = Math.max(
        1,
        Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000)
      );
      throw new HttpError(
        429,
        `This account is temporarily locked after repeated failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
      );
    }

    if (!verifyPassword(password, user.password_hash)) {
      const attempts = (user.failed_attempts || 0) + 1;
      const lockedUntil =
        attempts >= config.maxLoginAttempts
          ? new Date(Date.now() + config.lockoutMinutes * 60_000).toISOString()
          : null;
      db.prepare(`UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?`).run(
        lockedUntil ? 0 : attempts,
        lockedUntil,
        user.id
      );
      throw invalid();
    }

    db.prepare(
      `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?`
    ).run(nowIso(), user.id);

    const { token, ttlMs } = createSession(user.id, req, { remember });
    attachSessionCookie(res, token, ttlMs);

    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    res.json({ user: publicUser(fresh) });
  })
);

/* ------------------------------------------------------------------ *
 * Sign out
 * ------------------------------------------------------------------ */

router.post('/logout', (req, res) => {
  if (req.session) {
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), req.session.id);
  }
  destroySessionCookies(res);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

router.post(
  '/forgot-password',
  resetLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const email = vEmail(body.email);
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

    let devUrl;
    if (user) {
      // One live reset token per account.
      db.prepare(`DELETE FROM password_resets WHERE user_id = ?`).run(user.id);
      const token = generateToken(32);
      db.prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(
        newId(),
        user.id,
        hashToken(token),
        new Date(Date.now() + config.resetTokenTtlMinutes * 60_000).toISOString(),
        nowIso()
      );
      const url = `${config.appUrl}/#/reset?token=${token}`;
      deliverMail({
        to: email,
        subject: 'Reset your TELOS password',
        body: `A password reset was requested for your TELOS account.\n\n${url}\n\nThis link expires in ${config.resetTokenTtlMinutes} minutes and can be used once. If this was not you, no action is needed.`,
      });
      if (config.exposeDevTokens) devUrl = url;
    }

    // Always the same response, regardless of whether the account exists.
    res.json({
      ok: true,
      message: 'If an account exists for that address, a reset link is on its way.',
      ...(devUrl ? { devResetUrl: devUrl } : {}),
    });
  })
);

router.post(
  '/reset-password',
  resetLimiter,
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const token = str(body.token, 'Reset token', { min: 10, max: 200, required: true });
    const password = str(body.password, 'Password', { min: 1, max: 200, required: true, trim: false });
    const confirm = str(body.confirmPassword, 'Password confirmation', { max: 200, trim: false });
    if (confirm !== undefined && confirm !== password) {
      throw new HttpError(400, 'The two passwords do not match.');
    }

    const row = db
      .prepare(`SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL`)
      .get(hashToken(token));
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new HttpError(400, 'This reset link is no longer valid. Request a new one.');
    }

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.user_id);
    if (!user) throw new HttpError(400, 'This reset link is no longer valid. Request a new one.');

    const problems = passwordProblems(password, { email: user.email, name: user.name });
    if (problems.length) throw new HttpError(400, problems[0], { problems });

    db.transaction(() => {
      db.prepare(
        `UPDATE users SET password_hash = ?, updated_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?`
      ).run(hashPassword(password), nowIso(), user.id);
      db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).run(nowIso(), row.id);
      // Changing a password invalidates every existing session everywhere.
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(
        nowIso(),
        user.id
      );
    })();

    destroySessionCookies(res);
    deliverMail({
      to: user.email,
      subject: 'Your TELOS password was changed',
      body: 'Your password was changed and all active sessions were signed out. If this was not you, reset your password immediately.',
    });

    res.json({ ok: true, message: 'Your password has been changed. Sign in with your new password.' });
  })
);

/* ------------------------------------------------------------------ *
 * Email verification
 * ------------------------------------------------------------------ */

router.post(
  '/verify-email',
  wrap(async (req, res) => {
    const token = str(ensureObject(req.body).token, 'Token', { min: 10, max: 200, required: true });
    const row = db
      .prepare(`SELECT * FROM email_tokens WHERE token_hash = ? AND used_at IS NULL`)
      .get(hashToken(token));
    if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new HttpError(400, 'This confirmation link is no longer valid.');
    }
    db.transaction(() => {
      db.prepare(`UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`).run(
        nowIso(),
        row.user_id
      );
      db.prepare(`UPDATE email_tokens SET used_at = ? WHERE id = ?`).run(nowIso(), row.id);
    })();
    res.json({ ok: true, message: 'Your email address is confirmed.' });
  })
);

router.post(
  '/resend-verification',
  requireAuth,
  rateLimit({ windowMs: 60 * 60_000, max: 5, key: 'verify' }),
  wrap(async (req, res) => {
    if (req.user.email_verified) return res.json({ ok: true, message: 'Already confirmed.' });
    db.prepare(`DELETE FROM email_tokens WHERE user_id = ?`).run(req.user.id);
    const token = generateToken(32);
    db.prepare(
      `INSERT INTO email_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(
      newId(),
      req.user.id,
      hashToken(token),
      new Date(Date.now() + config.verifyTokenTtlHours * 3600e3).toISOString(),
      nowIso()
    );
    const url = `${config.appUrl}/#/verify?token=${token}`;
    deliverMail({ to: req.user.email, subject: 'Confirm your TELOS account', body: url });
    res.json({ ok: true, message: 'Confirmation sent.', ...(config.exposeDevTokens ? { devVerifyUrl: url } : {}) });
  })
);

/* ------------------------------------------------------------------ *
 * OAuth providers
 *
 * Providers are only advertised when credentials are configured. Without
 * them the endpoint states plainly that the option is unavailable rather
 * than presenting a control that cannot work.
 * ------------------------------------------------------------------ */

router.get('/providers', (req, res) => {
  const providers = [];
  if (process.env.TELOS_GOOGLE_CLIENT_ID) providers.push({ id: 'google', label: 'Continue with Google' });
  if (process.env.TELOS_APPLE_CLIENT_ID) providers.push({ id: 'apple', label: 'Continue with Apple' });
  res.json({ providers });
});

export default router;
