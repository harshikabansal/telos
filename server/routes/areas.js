import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { HttpError, wrap } from '../middleware.js';
import { requireOwned } from '../ownership.js';
import { AREA_COLORS, AREA_ICONS, bool, ensureObject, enumValue, ensureObject as obj, int, requireId, str } from '../validate.js';
import { serializeArea } from '../serialize.js';

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM areas WHERE user_id = ? ORDER BY position ASC, name ASC`)
    .all(req.user.id);
  const counts = db
    .prepare(
      `SELECT area_id, COUNT(*) AS total,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done
       FROM tasks WHERE user_id = ? AND area_id IS NOT NULL GROUP BY area_id`
    )
    .all(req.user.id);
  const byArea = new Map(counts.map((c) => [c.area_id, c]));
  res.json({
    areas: rows.map((row) => ({
      ...serializeArea(row),
      taskCount: byArea.get(row.id)?.total ?? 0,
      taskDone: byArea.get(row.id)?.done ?? 0,
    })),
  });
});

router.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const name = str(body.name, 'Area name', { min: 1, max: 60, required: true });
    const count = db.prepare(`SELECT COUNT(*) AS n FROM areas WHERE user_id = ?`).get(req.user.id).n;
    if (count >= 40) throw new HttpError(400, 'You can keep up to 40 areas. Remove one before adding another.');

    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO areas (id, user_id, name, icon, color, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user.id,
      name,
      enumValue(body.icon, AREA_ICONS, 'Icon', 'circle'),
      enumValue(body.color, AREA_COLORS, 'Colour', 'slate'),
      int(body.position ?? count, 'Position', { min: 0, max: 999 }),
      now,
      now
    );
    res.status(201).json({ area: serializeArea(db.prepare(`SELECT * FROM areas WHERE id = ?`).get(id)) });
  })
);

router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Area');
    requireOwned('areas', id, req.user.id, 'Area');
    const body = ensureObject(req.body);
    const fields = {};
    if (body.name !== undefined) fields.name = str(body.name, 'Area name', { min: 1, max: 60 });
    if (body.icon !== undefined) fields.icon = enumValue(body.icon, AREA_ICONS, 'Icon');
    if (body.color !== undefined) fields.color = enumValue(body.color, AREA_COLORS, 'Colour');
    if (body.position !== undefined) fields.position = int(body.position, 'Position', { min: 0, max: 999 });
    if (body.archived !== undefined) fields.archived = bool(body.archived) ? 1 : 0;

    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE areas SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }
    res.json({ area: serializeArea(db.prepare(`SELECT * FROM areas WHERE id = ?`).get(id)) });
  })
);

router.post(
  '/reorder',
  wrap(async (req, res) => {
    const ids = obj(req.body).order;
    if (!Array.isArray(ids)) throw new HttpError(400, 'Provide the new order as a list of area ids.');
    const stmt = db.prepare(`UPDATE areas SET position = ?, updated_at = ? WHERE id = ? AND user_id = ?`);
    const now = nowIso();
    db.transaction(() => {
      ids.forEach((rawId, index) => {
        const id = requireId(rawId, 'Area');
        stmt.run(index, now, id, req.user.id);
      });
    })();
    const rows = db
      .prepare(`SELECT * FROM areas WHERE user_id = ? ORDER BY position ASC`)
      .all(req.user.id);
    res.json({ areas: rows.map(serializeArea) });
  })
);

router.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Area');
    requireOwned('areas', id, req.user.id, 'Area');
    // Foreign keys are ON DELETE SET NULL: the responsibilities survive, they
    // simply become unassigned rather than disappearing with the area.
    db.prepare(`DELETE FROM areas WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

export default router;
