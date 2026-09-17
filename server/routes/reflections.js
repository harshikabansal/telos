import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { HttpError, notFound, wrap } from '../middleware.js';
import { requireOwned } from '../ownership.js';
import { dateOnly, ensureObject, requireId, str } from '../validate.js';
import { buildWeekReview, reflectionPrompts, reviewHeadline, weekBounds } from '../services/review.js';

const router = express.Router();

/**
 * Weekly reflections.
 *
 * A reflection is something the person writes; TELOS supplies the week and the
 * questions. The computed figures are stored alongside the writing when it is
 * saved, so a reflection read months later still shows the week it was
 * actually about, rather than a recalculation against data that has since
 * moved on.
 */

const serialize = (row) => ({
  id: row.id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  body: row.body,
  stats: (() => {
    try {
      return JSON.parse(row.stats);
    } catch {
      return {};
    }
  })(),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The review for a week, computed fresh. Nothing is written. */
router.get(
  '/review',
  wrap(async (req, res) => {
    const anchor = req.query.week ? dateOnly(req.query.week, 'Week') : null;
    const review = buildWeekReview(req.user, anchor);
    const existing = db
      .prepare(`SELECT * FROM reflections WHERE user_id = ? AND period_start = ?`)
      .get(req.user.id, review.periodStart);

    res.json({
      review,
      headline: reviewHeadline(review),
      prompts: reflectionPrompts(review),
      reflection: existing ? serialize(existing) : null,
    });
  })
);

router.get(
  '/',
  wrap(async (req, res) => {
    const rows = db
      .prepare(`SELECT * FROM reflections WHERE user_id = ? ORDER BY period_start DESC LIMIT 60`)
      .all(req.user.id);
    res.json({ reflections: rows.map(serialize) });
  })
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Reflection');
    const row = db.prepare(`SELECT * FROM reflections WHERE id = ? AND user_id = ?`).get(id, req.user.id);
    if (!row) throw notFound('Reflection not found.');
    res.json({ reflection: serialize(row) });
  })
);

/**
 * Saving is an upsert on the week: writing twice about the same week updates
 * the same reflection rather than accumulating duplicates.
 */
router.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const anchor = body.week ? dateOnly(body.week, 'Week') : null;
    const text = str(body.body, 'Reflection', { max: 20000, trim: false }) ?? '';
    if (!text.trim()) throw new HttpError(400, 'Write something before saving.');

    const review = buildWeekReview(req.user, anchor);
    const { periodStart, periodEnd } = review;

    // Only the summary figures are kept, not the full listing — a reflection
    // should not become a second copy of the plan.
    const stats = JSON.stringify({
      completed: review.completed.count,
      previousCompleted: review.completed.previousCount,
      slipped: review.slipped.length,
      milestones: review.milestones.length,
      busiestDay: review.completed.busiestDay,
      byArea: review.byArea.filter((row) => row.count > 0),
      untouched: review.untouched,
      headline: reviewHeadline(review),
    });

    const now = nowIso();
    const existing = db
      .prepare(`SELECT id FROM reflections WHERE user_id = ? AND period_start = ?`)
      .get(req.user.id, periodStart);

    if (existing) {
      db.prepare(`UPDATE reflections SET body = ?, stats = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(text, stats, now, existing.id, req.user.id);
      const row = db.prepare(`SELECT * FROM reflections WHERE id = ?`).get(existing.id);
      return res.json({ reflection: serialize(row) });
    }

    const id = newId();
    db.prepare(
      `INSERT INTO reflections (id, user_id, period_start, period_end, body, stats, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.user.id, periodStart, periodEnd, text, stats, now, now);
    const row = db.prepare(`SELECT * FROM reflections WHERE id = ?`).get(id);
    res.status(201).json({ reflection: serialize(row) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Reflection');
    requireOwned('reflections', id, req.user.id, 'Reflection');
    const text = str(ensureObject(req.body).body, 'Reflection', { max: 20000, trim: false });
    if (text === undefined) throw new HttpError(400, 'Nothing to update.');

    db.prepare(`UPDATE reflections SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(text, nowIso(), id, req.user.id);
    res.json({ reflection: serialize(db.prepare(`SELECT * FROM reflections WHERE id = ?`).get(id)) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Reflection');
    requireOwned('reflections', id, req.user.id, 'Reflection');
    db.prepare(`DELETE FROM reflections WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

export default router;
