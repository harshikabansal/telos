import db from './db.js';
import { notFound } from './middleware.js';
import { optionalId } from './validate.js';

/**
 * Authorization primitive.
 *
 * Every read and write is scoped by `user_id = ?` in SQL, so a record that
 * belongs to another account is indistinguishable from one that does not
 * exist. Nothing in the application relies on the client sending the right
 * identifiers; the predicate is applied at the database level on every query.
 */
export function ownedRow(table, id, userId) {
  if (!id) return null;
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId) || null;
}

export function requireOwned(table, id, userId, label = 'Record') {
  const row = ownedRow(table, id, userId);
  if (!row) throw notFound(`${label} not found.`);
  return row;
}

/**
 * Validates an optional foreign key supplied by the client and confirms the
 * referenced record belongs to the same user. Returns null when unset.
 */
export function ownedReference(value, table, userId, label) {
  const id = optionalId(value, label);
  if (!id) return null;
  const row = ownedRow(table, id, userId);
  if (!row) throw notFound(`${label} not found.`);
  return id;
}
