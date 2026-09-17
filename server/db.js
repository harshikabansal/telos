import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import config from './config.js';

export const db = new Database(config.dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

/**
 * Schema. Every user-owned table carries a user_id foreign key with
 * ON DELETE CASCADE so account deletion is complete, and so that every
 * authorization check can be expressed as a `user_id = ?` predicate at the
 * database level rather than in application logic alone.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  email_verified      INTEGER NOT NULL DEFAULT 0,
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  week_start          INTEGER NOT NULL DEFAULT 1,
  work_start          TEXT NOT NULL DEFAULT '09:00',
  work_end            TEXT NOT NULL DEFAULT '17:00',
  theme               TEXT NOT NULL DEFAULT 'system',
  accent              TEXT NOT NULL DEFAULT 'clay',
  density             TEXT NOT NULL DEFAULT 'comfortable',
  default_priority    TEXT NOT NULL DEFAULT 'medium',
  default_duration    INTEGER NOT NULL DEFAULT 30,
  default_reminder    TEXT NOT NULL DEFAULT 'none',
  default_view        TEXT NOT NULL DEFAULT 'list',
  notify_push         INTEGER NOT NULL DEFAULT 1,
  notify_email        INTEGER NOT NULL DEFAULT 0,
  notify_digest       INTEGER NOT NULL DEFAULT 0,
  quiet_start         TEXT NOT NULL DEFAULT '',
  quiet_end           TEXT NOT NULL DEFAULT '',
  recurrence_catchup  TEXT NOT NULL DEFAULT 'skip',
  assistant_mode      TEXT NOT NULL DEFAULT 'local',
  assistant_share_plan INTEGER NOT NULL DEFAULT 0,
  assistant_may_act   INTEGER NOT NULL DEFAULT 0,
  onboarded           INTEGER NOT NULL DEFAULT 0,
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  ip            TEXT NOT NULL DEFAULT '',
  user_agent    TEXT NOT NULL DEFAULT '',
  remember      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS email_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'circle',
  color       TEXT NOT NULL DEFAULT 'slate',
  position    INTEGER NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_areas_user ON areas(user_id, position);

CREATE TABLE IF NOT EXISTS objectives (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id         TEXT REFERENCES areas(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  horizon         TEXT NOT NULL DEFAULT 'year',
  start_date      TEXT,
  deadline        TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  priority        TEXT NOT NULL DEFAULT 'medium',
  progress_mode   TEXT NOT NULL DEFAULT 'auto',
  progress_manual INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_objectives_user ON objectives(user_id, status);

CREATE TABLE IF NOT EXISTS milestones (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id  TEXT REFERENCES objectives(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  target_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_milestones_user ON milestones(user_id, objective_id, position);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objective_id  TEXT REFERENCES objectives(id) ON DELETE SET NULL,
  milestone_id  TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  area_id       TEXT REFERENCES areas(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  deadline      TEXT,
  priority      TEXT NOT NULL DEFAULT 'medium',
  status        TEXT NOT NULL DEFAULT 'active',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, status);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
  milestone_id      TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  objective_id      TEXT REFERENCES objectives(id) ON DELETE SET NULL,
  area_id           TEXT REFERENCES areas(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  start_date        TEXT,
  due_date          TEXT,
  due_time          TEXT,
  priority          TEXT NOT NULL DEFAULT 'medium',
  important         INTEGER NOT NULL DEFAULT 0,
  meaningful        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'not_started',
  tags              TEXT NOT NULL DEFAULT '[]',
  links             TEXT NOT NULL DEFAULT '[]',
  recurrence        TEXT,
  recurrence_end    TEXT,
  reminder          TEXT NOT NULL DEFAULT 'none',
  estimated_minutes INTEGER,
  actual_minutes    INTEGER,
  position          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  completed_at      TEXT,
  cancelled_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_due ON tasks(user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);

CREATE TABLE IF NOT EXISTS subtasks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  done          INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position);

CREATE TABLE IF NOT EXISTS task_completions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '',
  area_id         TEXT,
  project_id      TEXT,
  priority        TEXT NOT NULL DEFAULT 'medium',
  occurrence_date TEXT,
  completed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_completions_user ON task_completions(user_id, completed_at);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id     TEXT REFERENCES areas(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  start_date  TEXT NOT NULL,
  start_time  TEXT,
  end_date    TEXT,
  end_time    TEXT,
  all_day     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, start_date);

CREATE TABLE IF NOT EXISTS notes (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  area_id       TEXT REFERENCES areas(id) ON DELETE SET NULL,
  project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
  objective_id  TEXT REFERENCES objectives(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  pinned        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at);

CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  remind_at   TEXT NOT NULL,
  offset_key  TEXT NOT NULL DEFAULT 'at_time',
  delivered   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id, remind_at);

CREATE TABLE IF NOT EXISTS reflections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start  TEXT NOT NULL,
  period_end    TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  stats         TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reflections_period ON reflections(user_id, period_start);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'reminder',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
`;

db.exec(SCHEMA);

/**
 * Columns introduced after a database was first created. `CREATE TABLE IF NOT
 * EXISTS` leaves existing tables untouched, so new fields are added here for
 * databases that predate them.
 */
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'assistant_mode', `TEXT NOT NULL DEFAULT 'local'`);
ensureColumn('users', 'assistant_share_plan', `INTEGER NOT NULL DEFAULT 0`);
ensureColumn('users', 'assistant_may_act', `INTEGER NOT NULL DEFAULT 0`);

/** Remove expired or long-revoked sessions and single-use tokens. */
export function pruneExpired() {
  const now = nowIso();
  db.prepare(`DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`)
    .run(now, new Date(Date.now() - 7 * 864e5).toISOString());
  db.prepare(`DELETE FROM password_resets WHERE expires_at < ? OR used_at IS NOT NULL`).run(now);
  db.prepare(`DELETE FROM email_tokens WHERE expires_at < ?`).run(now);
}

pruneExpired();
setInterval(pruneExpired, 60 * 60 * 1000).unref();

export default db;
