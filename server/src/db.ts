import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'

export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.cwd(), 'data')
export const ASSETS_DIR = join(DATA_DIR, 'assets')
mkdirSync(ASSETS_DIR, { recursive: true })

export const db = new Database(join(DATA_DIR, 'quorum.db'))
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  color         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  link_access TEXT NOT NULL DEFAULT 'none' CHECK (link_access IN ('none','viewer','editor')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  trashed_at  INTEGER
);
CREATE INDEX IF NOT EXISTS documents_owner ON documents(owner_id, updated_at);

-- Blobs live in their own tables so listing queries never touch them.
CREATE TABLE IF NOT EXISTS doc_state (
  doc_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  state  BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS doc_thumbs (
  doc_id  TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  png     BLOB
);

CREATE TABLE IF NOT EXISTS doc_members (
  doc_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  PRIMARY KEY (doc_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS doc_members_user ON doc_members(user_id);

-- Per-user state for a document: starred flag and when it was last opened.
CREATE TABLE IF NOT EXISTS doc_user (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  starred   INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER,
  PRIMARY KEY (user_id, doc_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS doc_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS doc_versions_doc ON doc_versions(doc_id, created_at);
`)

// ── Migrations for columns added after the first release ─────────────────────

function addColumn(table: string, column: string, definition: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (cols.some(c => c.name === column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}

db.transaction(() => {
  const addedRole = addColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user'))")
  addColumn('users', 'disabled_at', 'INTEGER')
  addColumn('users', 'last_login_at', 'INTEGER')
  // Servers created before roles existed: the earliest account becomes the administrator.
  if (addedRole) db.exec(`UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY created_at LIMIT 1)`)
})()

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  email      TEXT COLLATE NOCASE,
  role       TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
) WITHOUT ROWID;

-- Each user's personal reference library (document independent).
CREATE TABLE IF NOT EXISTS refs (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cite_key   TEXT NOT NULL,
  type       TEXT NOT NULL,
  fields     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, cite_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor_id   TEXT,
  actor_name TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);
`)

/** 128-bit URL-safe random identifier (22 chars). Unguessable, so safe to use in share links. */
export const newId = (): string => randomBytes(16).toString('base64url')
export const ID_RE = /^[A-Za-z0-9_-]{22}$/
