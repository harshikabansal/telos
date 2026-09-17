import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { HttpError, notFound, wrap } from '../middleware.js';
import { ownedReference, requireOwned } from '../ownership.js';
import { REMINDER_OFFSETS, ensureObject, enumValue, isoDateTime, requireId, str } from '../validate.js';
import { serializeReminder } from '../serialize.js';
import { zonedToUtc } from '../domain.js';

const router = express.Router();

const OFFSET_MINUTES = {
  at_time: 0, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120,
  '1d': 1440, '2d': 2880, '1w': 10080,
};

/**
 * Keeps a task's reminder row in step with its schedule. Called after any
 * change to a responsibility, so a reminder can never point at a date the
 * task no longer has.
 */
export function syncTaskReminder(user, taskId) {
  const task = db.prepare(`SELECT * FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, user.id);
  db.prepare(`DELETE FROM reminders WHERE task_id = ? AND user_id = ?`).run(taskId, user.id);
  if (!task) return null;

  const offset = OFFSET_MINUTES[task.reminder];
  if (task.reminder === 'none' || offset === undefined) return null;
  if (!task.due_date || task.status === 'completed' || task.status === 'cancelled') return null;

  const base = zonedToUtc(task.due_date, task.due_time || '09:00', user.timezone);
  const remindAt = new Date(base.getTime() - offset * 60_000).toISOString();

  const id = newId();
  db.prepare(
    `INSERT INTO reminders (id, user_id, task_id, title, remind_at, offset_key, delivered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(id, user.id, taskId, task.title, remindAt, task.reminder, nowIso());
  return remindAt;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*, t.title AS task_title FROM reminders r
         LEFT JOIN tasks t ON t.id = r.task_id
         WHERE r.user_id = ? ORDER BY r.remind_at ASC LIMIT 300`
      )
      .all(req.user.id);
    res.json({
      reminders: rows.map((row) => ({
        ...serializeReminder(row),
        title: row.title || row.task_title || 'Reminder',
      })),
    });
  })
);

/** Reminders that have come due and have not yet been shown. */
router.get(
  '/due',
  wrap(async (req, res) => {
    if (!req.user.notify_push) return res.json({ reminders: [] });
    const rows = db
      .prepare(
        `SELECT r.*, t.title AS task_title FROM reminders r
         LEFT JOIN tasks t ON t.id = r.task_id
         WHERE r.user_id = ? AND r.delivered = 0 AND r.remind_at <= ?
         ORDER BY r.remind_at ASC LIMIT 20`
      )
      .all(req.user.id, nowIso());
    res.json({
      reminders: rows.map((row) => ({
        ...serializeReminder(row),
        title: row.title || row.task_title || 'Reminder',
      })),
    });
  })
);

router.post(
  '/:id/acknowledge',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Reminder');
    requireOwned('reminders', id, req.user.id, 'Reminder');
    db.prepare(`UPDATE reminders SET delivered = 1 WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const taskId = ownedReference(body.taskId, 'tasks', req.user.id, 'Responsibility');
    const title = str(body.title, 'Reminder', { max: 200 }) ?? '';
    if (!taskId && !title) throw new HttpError(400, 'Give the reminder a name.');

    let remindAt = isoDateTime(body.remindAt, 'Reminder time');
    if (!remindAt && body.date) {
      remindAt = zonedToUtc(
        str(body.date, 'Date', { max: 10, required: true }),
        str(body.time, 'Time', { max: 5 }) || '09:00',
        req.user.timezone
      ).toISOString();
    }
    if (!remindAt) throw new HttpError(400, 'Choose when this reminder should reach you.');

    const id = newId();
    db.prepare(
      `INSERT INTO reminders (id, user_id, task_id, title, remind_at, offset_key, delivered, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id, req.user.id, taskId, title, remindAt,
      enumValue(body.offsetKey, REMINDER_OFFSETS, 'Reminder offset', 'at_time'),
      nowIso()
    );
    res.status(201).json({ reminder: serializeReminder(db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id)) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Reminder');
    const row = db.prepare(`SELECT id FROM reminders WHERE id = ? AND user_id = ?`).get(id, req.user.id);
    if (!row) throw notFound('Reminder not found.');
    db.prepare(`DELETE FROM reminders WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ *
 * Notification feed — a quiet record of what TELOS has surfaced.
 * ------------------------------------------------------------------ */

export const notificationsRouter = express.Router();

notificationsRouter.get(
  '/',
  wrap(async (req, res) => {
    const rows = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`)
      .all(req.user.id);
    res.json({
      notifications: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        entityType: row.entity_type,
        entityId: row.entity_id,
        readAt: row.read_at,
        createdAt: row.created_at,
      })),
      unread: rows.filter((r) => !r.read_at).length,
    });
  })
);

notificationsRouter.post(
  '/read',
  wrap(async (req, res) => {
    const body = ensureObject(req.body ?? {});
    if (Array.isArray(body.ids) && body.ids.length) {
      const stmt = db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?`);
      const now = nowIso();
      db.transaction(() => {
        body.ids.forEach((raw) => stmt.run(now, requireId(raw, 'Notification'), req.user.id));
      })();
    } else {
      db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
        .run(nowIso(), req.user.id);
    }
    res.json({ ok: true });
  })
);

notificationsRouter.delete(
  '/',
  wrap(async (req, res) => {
    db.prepare(`DELETE FROM notifications WHERE user_id = ?`).run(req.user.id);
    res.json({ ok: true });
  })
);

export default router;
