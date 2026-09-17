import express from 'express';
import db, { newId, nowIso } from '../db.js';
import { HttpError, notFound, wrap } from '../middleware.js';
import { ownedReference, requireOwned } from '../ownership.js';
import { bool, dateOnly, ensureObject, requireId, str, timeOnly } from '../validate.js';
import { serializeEvent, serializeNote } from '../serialize.js';

/* ---------------------------------- Notes ---------------------------------- */

export const notesRouter = express.Router();

notesRouter.get(
  '/',
  wrap(async (req, res) => {
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (req.query.areaId) {
      where.push('area_id = ?');
      params.push(requireId(req.query.areaId, 'Area'));
    }
    if (req.query.projectId) {
      where.push('project_id = ?');
      params.push(requireId(req.query.projectId, 'Project'));
    }
    if (req.query.q) {
      const term = `%${str(req.query.q, 'Search', { max: 120 })}%`;
      where.push('(title LIKE ? OR body LIKE ?)');
      params.push(term, term);
    }
    const rows = db
      .prepare(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY pinned DESC, updated_at DESC LIMIT 400`)
      .all(...params);
    res.json({ notes: rows.map(serializeNote) });
  })
);

notesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Note');
    const row = db.prepare(`SELECT * FROM notes WHERE id = ? AND user_id = ?`).get(id, req.user.id);
    if (!row) throw notFound('Note not found.');
    res.json({ note: serializeNote(row) });
  })
);

function readNoteInput(body, userId, { partial = false } = {}) {
  const fields = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('title')) fields.title = str(body.title, 'Title', { max: 200 }) ?? '';
  if (has('body')) fields.body = str(body.body, 'Note', { max: 100000, trim: false }) ?? '';
  if (has('pinned')) fields.pinned = bool(body.pinned) ? 1 : 0;
  if (has('areaId')) fields.area_id = ownedReference(body.areaId, 'areas', userId, 'Area');
  if (has('projectId')) fields.project_id = ownedReference(body.projectId, 'projects', userId, 'Project');
  if (has('objectiveId')) fields.objective_id = ownedReference(body.objectiveId, 'objectives', userId, 'Objective');
  return fields;
}

notesRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = ensureObject(req.body);
    const fields = readNoteInput(body, req.user.id);
    if (!fields.title && !fields.body) throw new HttpError(400, 'A note needs a title or some content.');
    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO notes (id, user_id, area_id, project_id, objective_id, title, body, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, req.user.id, fields.area_id ?? null, fields.project_id ?? null, fields.objective_id ?? null,
      fields.title ?? '', fields.body ?? '', fields.pinned ?? 0, now, now
    );
    res.status(201).json({ note: serializeNote(db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id)) });
  })
);

notesRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Note');
    requireOwned('notes', id, req.user.id, 'Note');
    const fields = readNoteInput(ensureObject(req.body), req.user.id, { partial: true });
    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE notes SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }
    res.json({ note: serializeNote(db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id)) });
  })
);

notesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Note');
    requireOwned('notes', id, req.user.id, 'Note');
    db.prepare(`DELETE FROM notes WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);

/* --------------------------------- Events ---------------------------------- */

export const eventsRouter = express.Router();

eventsRouter.get(
  '/',
  wrap(async (req, res) => {
    const where = ['user_id = ?'];
    const params = [req.user.id];
    if (req.query.from) {
      where.push('start_date >= ?');
      params.push(dateOnly(req.query.from, 'From date'));
    }
    if (req.query.to) {
      where.push('start_date <= ?');
      params.push(dateOnly(req.query.to, 'To date'));
    }
    const rows = db
      .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY start_date ASC, start_time ASC LIMIT 500`)
      .all(...params);
    res.json({ events: rows.map(serializeEvent) });
  })
);

function readEventInput(body, userId, { partial = false } = {}) {
  const fields = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('title')) fields.title = str(body.title, 'Title', { min: 1, max: 200, required: !partial });
  if (has('description')) fields.description = str(body.description, 'Description', { max: 4000 }) ?? '';
  if (has('location')) fields.location = str(body.location, 'Location', { max: 200 }) ?? '';
  if (!partial || has('startDate')) {
    fields.start_date = dateOnly(body.startDate, 'Start date');
    if (!partial && !fields.start_date) throw new HttpError(400, 'An event needs a date.');
  }
  if (has('startTime')) fields.start_time = timeOnly(body.startTime, 'Start time');
  if (has('endDate')) fields.end_date = dateOnly(body.endDate, 'End date');
  if (has('endTime')) fields.end_time = timeOnly(body.endTime, 'End time');
  if (has('allDay')) fields.all_day = bool(body.allDay, true) ? 1 : 0;
  if (has('areaId')) fields.area_id = ownedReference(body.areaId, 'areas', userId, 'Area');
  if (fields.end_date && fields.start_date && fields.end_date < fields.start_date) {
    throw new HttpError(400, 'An event cannot end before it begins.');
  }
  return fields;
}

eventsRouter.post(
  '/',
  wrap(async (req, res) => {
    const fields = readEventInput(ensureObject(req.body), req.user.id);
    const now = nowIso();
    const id = newId();
    db.prepare(
      `INSERT INTO events (id, user_id, area_id, title, description, location, start_date, start_time,
                           end_date, end_time, all_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, req.user.id, fields.area_id ?? null, fields.title, fields.description ?? '', fields.location ?? '',
      fields.start_date, fields.start_time ?? null, fields.end_date ?? null, fields.end_time ?? null,
      fields.all_day ?? (fields.start_time ? 0 : 1), now, now
    );
    res.status(201).json({ event: serializeEvent(db.prepare(`SELECT * FROM events WHERE id = ?`).get(id)) });
  })
);

eventsRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Event');
    requireOwned('events', id, req.user.id, 'Event');
    const fields = readEventInput(ensureObject(req.body), req.user.id, { partial: true });
    if (Object.keys(fields).length) {
      fields.updated_at = nowIso();
      db.prepare(
        `UPDATE events SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ? AND user_id = ?`
      ).run(...Object.values(fields), id, req.user.id);
    }
    res.json({ event: serializeEvent(db.prepare(`SELECT * FROM events WHERE id = ?`).get(id)) });
  })
);

eventsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = requireId(req.params.id, 'Event');
    requireOwned('events', id, req.user.id, 'Event');
    db.prepare(`DELETE FROM events WHERE id = ? AND user_id = ?`).run(id, req.user.id);
    res.json({ ok: true });
  })
);
