import express from 'express';
import db, { newId, nowIso } from '../db.js';
import config from '../config.js';
import { hashPassword, passwordProblems, verifyPassword } from '../security.js';
import {
  HttpError,
  attachSessionCookie,
  createSession,
  destroySessionCookies,
  notFound,
  rateLimit,
  wrap,
} from '../middleware.js';
import {
  ACCENTS, ASSISTANT_MODES, DENSITIES, PRIORITIES, REMINDER_OFFSETS, THEMES,
  bool, ensureObject, enumValue, int, requireId, str, timezone as vTimezone,
} from '../validate.js';
import { publicUser, serializeSession } from '../serialize.js';
import { deliverMail } from '../mailer.js';

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Profile & preferences
 * ------------------------------------------------------------------ */

router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

router.patch(
  '/me',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const fields = {};

    if (body.name !== undefined) fields.name = str(body.name, 'Full name', { min: 1, max: 100 });
    if (body.timezone !== undefined) fields.timezone = vTimezone(body.timezone);
    if (body.weekStart !== undefined) fields.week_start = int(body.weekStart, 'Week start', { min: 0, max: 6 });
    if (body.workStart !== undefined) fields.work_start = str(body.workStart, 'Working hours', { max: 5 });
    if (body.workEnd !== undefined) fields.work_end = str(body.workEnd, 'Working hours', { max: 5 });
    if (body.theme !== undefined) fields.theme = enumValue(body.theme, THEMES, 'Theme');
    if (body.accent !== undefined) fields.accent = enumValue(body.accent, ACCENTS, 'Accent');
    if (body.density !== undefined) fields.density = enumValue(body.density, DENSITIES, 'Density');
    if (body.defaultPriority !== undefined) {
      fields.default_priority = enumValue(body.defaultPriority, PRIORITIES, 'Default priority');
    }
    if (body.defaultDuration !== undefined) {
      fields.default_duration = int(body.defaultDuration, 'Default duration', { min: 0, max: 1440 });
    }
    if (body.defaultReminder !== undefined) {
      fields.default_reminder = enumValue(body.defaultReminder, REMINDER_OFFSETS, 'Default reminder');
    }
    if (body.defaultView !== undefined) {
      fields.default_view = enumValue(body.defaultView, ['list', 'board', 'calendar', 'timeline'], 'Default view');
    }
    if (body.notifyPush !== undefined) fields.notify_push = bool(body.notifyPush) ? 1 : 0;
    if (body.notifyEmail !== undefined) fields.notify_email = bool(body.notifyEmail) ? 1 : 0;
    if (body.notifyDigest !== undefined) fields.notify_digest = bool(body.notifyDigest) ? 1 : 0;
    if (body.quietStart !== undefined) fields.quiet_start = str(body.quietStart, 'Quiet hours', { max: 5 }) || '';
    if (body.quietEnd !== undefined) fields.quiet_end = str(body.quietEnd, 'Quiet hours', { max: 5 }) || '';
    if (body.recurrenceCatchup !== undefined) {
      fields.recurrence_catchup = enumValue(
        body.recurrenceCatchup, ['skip', 'sequential'], 'Missed occurrence handling'
      );
    }
    if (body.assistantMode !== undefined) {
      fields.assistant_mode = enumValue(body.assistantMode, ASSISTANT_MODES, 'Assistant mode');
    }
    if (body.assistantSharePlan !== undefined) {
      fields.assistant_share_plan = bool(body.assistantSharePlan) ? 1 : 0;
    }
    if (body.assistantMayAct !== undefined) {
      fields.assistant_may_act = bool(body.assistantMayAct) ? 1 : 0;
    }
    if (body.onboarded !== undefined) fields.onboarded = bool(body.onboarded) ? 1 : 0;

    const keys = Object.keys(fields);
    if (keys.length) {
      fields.updated_at = nowIso();
      const assignments = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE users SET ${assignments} WHERE id = ?`).run(
        ...Object.values(fields),
        req.user.id
      );
    }
    const fresh = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
    res.json({ user: publicUser(fresh) });
  })
);

/* ------------------------------------------------------------------ *
 * Password change — requires the current password, and rotates sessions.
 * ------------------------------------------------------------------ */

router.post(
  '/password',
  rateLimit({ windowMs: 15 * 60_000, max: 10, key: 'password-change' }),
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const current = str(body.currentPassword, 'Current password', { min: 1, max: 200, required: true, trim: false });
    const next = str(body.newPassword, 'New password', { min: 1, max: 200, required: true, trim: false });
    const confirm = str(body.confirmPassword, 'Password confirmation', { max: 200, trim: false });

    if (confirm !== undefined && confirm !== next) {
      throw new HttpError(400, 'The two passwords do not match.');
    }
    if (!verifyPassword(current, req.user.password_hash)) {
      throw new HttpError(400, 'Your current password is not correct.');
    }
    if (current === next) throw new HttpError(400, 'Choose a password different from your current one.');

    const problems = passwordProblems(next, { email: req.user.email, name: req.user.name });
    if (problems.length) throw new HttpError(400, problems[0], { problems });

    const keepThisSession = bool(body.keepCurrentSession, true);

    db.transaction(() => {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
        hashPassword(next), nowIso(), req.user.id
      );
      db.prepare(
        `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL${keepThisSession ? ' AND id != ?' : ''}`
      ).run(...(keepThisSession ? [nowIso(), req.user.id, req.session.id] : [nowIso(), req.user.id]));
    })();

    if (!keepThisSession) {
      destroySessionCookies(res);
    } else {
      // Rotate the session token so a previously captured cookie is useless.
      db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), req.session.id);
      const { token, ttlMs } = createSession(req.user.id, req, { remember: Boolean(req.session.remember) });
      attachSessionCookie(res, token, ttlMs);
    }

    deliverMail({
      to: req.user.email,
      subject: 'Your TELOS password was changed',
      body: 'Your password was changed just now. Other signed-in devices were signed out. If this was not you, reset your password immediately.',
    });

    res.json({ ok: true, message: 'Password updated. Other devices have been signed out.' });
  })
);

/* ------------------------------------------------------------------ *
 * Active sessions
 * ------------------------------------------------------------------ */

router.get('/sessions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC`
    )
    .all(req.user.id, nowIso());
  res.json({ sessions: rows.map((row) => serializeSession(row, req.session.id)) });
});

router.delete(
  '/sessions/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Session');
    // Scoped by user_id: another account's session id simply does not exist here.
    const row = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(id, req.user.id);
    if (!row) throw notFound('That session was not found.');
    db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(nowIso(), row.id);
    if (row.id === req.session.id) destroySessionCookies(res);
    res.json({ ok: true, signedOutCurrent: row.id === req.session.id });
  })
);

router.post(
  '/sessions/revoke-others',
  wrap(async (req, res) => {
    const result = db
      .prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL`)
      .run(nowIso(), req.user.id, req.session.id);
    res.json({ ok: true, revoked: result.changes });
  })
);

/* ------------------------------------------------------------------ *
 * Connected accounts
 * ------------------------------------------------------------------ */

router.get('/connections', (req, res) => {
  res.json({
    connections: [],
    available: [
      ...(process.env.TELOS_GOOGLE_CLIENT_ID ? [{ id: 'google', label: 'Google' }] : []),
      ...(process.env.TELOS_APPLE_CLIENT_ID ? [{ id: 'apple', label: 'Apple' }] : []),
    ],
  });
});

/* ------------------------------------------------------------------ *
 * Data export — everything the account holds, in one JSON document.
 * ------------------------------------------------------------------ */

const EXPORT_TABLES = [
  'areas', 'objectives', 'milestones', 'projects', 'tasks', 'subtasks',
  'events', 'notes', 'reminders', 'task_completions', 'notifications',
];

export function buildExport(userId) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
  const out = {
    exportedAt: nowIso(),
    format: 'telos.export.v1',
    account: publicUser(user),
  };
  for (const table of EXPORT_TABLES) {
    out[table] = db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(userId);
  }
  return out;
}

router.get('/export', (req, res) => {
  const payload = buildExport(req.user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="telos-export-${stamp}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

/* ------------------------------------------------------------------ *
 * Selective and total data deletion
 * ------------------------------------------------------------------ */

const DELETABLE = {
  tasks: [`DELETE FROM subtasks WHERE user_id = ?`, `DELETE FROM tasks WHERE user_id = ?`],
  projects: [`DELETE FROM projects WHERE user_id = ?`],
  objectives: [`DELETE FROM milestones WHERE user_id = ?`, `DELETE FROM objectives WHERE user_id = ?`],
  notes: [`DELETE FROM notes WHERE user_id = ?`],
  events: [`DELETE FROM events WHERE user_id = ?`],
  history: [`DELETE FROM task_completions WHERE user_id = ?`],
  notifications: [`DELETE FROM notifications WHERE user_id = ?`, `DELETE FROM reminders WHERE user_id = ?`],
  areas: [`DELETE FROM areas WHERE user_id = ?`],
};

router.post(
  '/data/delete',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const scopes = Array.isArray(body.scopes) ? body.scopes : [];
    if (!scopes.length) throw new HttpError(400, 'Select at least one kind of data to delete.');
    if (str(body.confirm, 'Confirmation', { max: 40 }) !== 'DELETE') {
      throw new HttpError(400, 'Type DELETE to confirm this irreversible action.');
    }
    const unknown = scopes.filter((s) => !DELETABLE[s]);
    if (unknown.length) throw new HttpError(400, `Unknown data selection: ${unknown[0]}`);

    db.transaction(() => {
      for (const scope of scopes) {
        for (const sql of DELETABLE[scope]) db.prepare(sql).run(req.user.id);
      }
    })();
    res.json({ ok: true, deleted: scopes });
  })
);

router.post(
  '/data/delete-all',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    if (str(body.confirm, 'Confirmation', { max: 40 }) !== 'DELETE EVERYTHING') {
      throw new HttpError(400, 'Type DELETE EVERYTHING to confirm.');
    }
    if (!verifyPassword(str(body.password, 'Password', { max: 200, required: true, trim: false }), req.user.password_hash)) {
      throw new HttpError(400, 'Your password is not correct.');
    }
    db.transaction(() => {
      for (const scopes of Object.values(DELETABLE)) {
        for (const sql of scopes) db.prepare(sql).run(req.user.id);
      }
    })();
    res.json({ ok: true, message: 'All planning data has been removed. Your account remains active.' });
  })
);

/* ------------------------------------------------------------------ *
 * Account deletion — irreversible, password-confirmed, cascades.
 * ------------------------------------------------------------------ */

router.post(
  '/delete',
  rateLimit({ windowMs: 60 * 60_000, max: 5, key: 'account-delete' }),
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const password = str(body.password, 'Password', { min: 1, max: 200, required: true, trim: false });
    if (str(body.confirm, 'Confirmation', { max: 60 }) !== 'DELETE MY ACCOUNT') {
      throw new HttpError(400, 'Type DELETE MY ACCOUNT to confirm.');
    }
    if (!verifyPassword(password, req.user.password_hash)) {
      throw new HttpError(400, 'Your password is not correct.');
    }
    const email = req.user.email;
    // Every user-owned table declares ON DELETE CASCADE, so this is complete.
    db.prepare(`DELETE FROM users WHERE id = ?`).run(req.user.id);
    destroySessionCookies(res);
    deliverMail({
      to: email,
      subject: 'Your TELOS account has been deleted',
      body: 'Your account and all associated data have been permanently removed. Nothing is retained.',
    });
    res.json({ ok: true, message: 'Your account and all of its data have been permanently deleted.' });
  })
);

/* ------------------------------------------------------------------ *
 * Import — restores a previous export into the signed-in account.
 * Identifiers are regenerated so an import can never overwrite or
 * reference another account's records.
 * ------------------------------------------------------------------ */

router.post(
  '/import',
  rateLimit({ windowMs: 60 * 60_000, max: 10, key: 'import' }),
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const payload = ensureObject(body.data, 'Import file');
    if (payload.format !== 'telos.export.v1') {
      throw new HttpError(400, 'That file is not a TELOS export.');
    }
    const replace = bool(body.replace, false);
    const userId = req.user.id;
    const idMap = new Map();
    const remap = (old) => (old == null ? null : idMap.get(old) ?? null);

    const counts = {};
    const ORDER = ['areas', 'objectives', 'milestones', 'projects', 'tasks', 'subtasks', 'events', 'notes'];
    const MAX_ROWS = 20000;
    let total = 0;
    for (const table of ORDER) total += Array.isArray(payload[table]) ? payload[table].length : 0;
    if (total > MAX_ROWS) throw new HttpError(413, 'That export is too large to import.');

    const columnsFor = (table) =>
      db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

    const FK = {
      objectives: { area_id: 1 },
      milestones: { objective_id: 1 },
      projects: { objective_id: 1, milestone_id: 1, area_id: 1 },
      tasks: { project_id: 1, milestone_id: 1, objective_id: 1, area_id: 1 },
      subtasks: { task_id: 1 },
      events: { area_id: 1 },
      notes: { area_id: 1, project_id: 1, objective_id: 1 },
    };

    db.transaction(() => {
      if (replace) {
        for (const scopes of Object.values(DELETABLE)) {
          for (const sql of scopes) db.prepare(sql).run(userId);
        }
      }
      for (const table of ORDER) {
        const rows = Array.isArray(payload[table]) ? payload[table] : [];
        if (!rows.length) continue;
        const cols = columnsFor(table);
        const insertCols = cols.filter((c) => c !== 'id' && c !== 'user_id');
        const stmt = db.prepare(
          `INSERT INTO ${table} (id, user_id, ${insertCols.join(', ')})
           VALUES (?, ?, ${insertCols.map(() => '?').join(', ')})`
        );
        let inserted = 0;
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const id = newId();
          if (row.id) idMap.set(row.id, id);
          const values = insertCols.map((col) => {
            let value = row[col];
            if (FK[table]?.[col]) value = remap(value);
            if (value === undefined) value = null;
            if (typeof value === 'object' && value !== null) value = JSON.stringify(value);
            return value;
          });
          // subtasks require a parent that survived remapping
          if (table === 'subtasks' && !values[insertCols.indexOf('task_id')]) continue;
          try {
            stmt.run(id, userId, ...values);
            inserted += 1;
          } catch {
            /* skip malformed rows rather than abort the whole import */
          }
        }
        counts[table] = inserted;
      }
    })();

    res.json({ ok: true, imported: counts });
  })
);

/* ------------------------------------------------------------------ *
 * Privacy summary shown in Settings.
 * ------------------------------------------------------------------ */

router.get('/privacy-summary', (req, res) => {
  const count = (table) =>
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(req.user.id).n;
  res.json({
    storage: {
      tasks: count('tasks'),
      projects: count('projects'),
      objectives: count('objectives'),
      milestones: count('milestones'),
      notes: count('notes'),
      events: count('events'),
      areas: count('areas'),
      completions: count('task_completions'),
    },
    sessions: db
      .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`)
      .get(req.user.id, nowIso()).n,
    emailVerified: Boolean(req.user.email_verified),
    encryptionAtRest: config.isProduction ? 'managed by host volume' : 'local disk',
    dataResidency: 'Stored only on the server you control. No third-party analytics.',
  });
});

export default router;
