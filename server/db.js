'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Each entry is applied once, in order. Never edit an entry that has shipped;
// add a new one instead. SQLite's PRAGMA user_version tracks progress.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE oauth_identities (
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (provider, provider_user_id)
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  CREATE TABLE mods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Mod' CHECK (category IN ('Mod', 'Plugin')),
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    icon_file TEXT,
    file_stored TEXT,
    file_name TEXT,
    file_size INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );

  CREATE TABLE mod_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mod_id TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
    file TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  CREATE INDEX idx_screenshots_mod ON mod_screenshots(mod_id);

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    mod_id TEXT NOT NULL REFERENCES mods(id),
    amount_kobo INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'NGN',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    created_at INTEGER NOT NULL,
    paid_at INTEGER
  );
  CREATE INDEX idx_orders_user ON orders(user_id);
  CREATE INDEX idx_orders_mod ON orders(mod_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // 2: CurseForge-style project details. Columns are added (not rebuilt) so the
  // tables that point at mods stay untouched. The old Mod/Plugin column stays too.
  `
  ALTER TABLE mods ADD COLUMN summary TEXT NOT NULL DEFAULT '';
  ALTER TABLE mods ADD COLUMN class_name TEXT NOT NULL DEFAULT 'Mods';
  ALTER TABLE mods ADD COLUMN main_category TEXT NOT NULL DEFAULT 'Miscellaneous';
  ALTER TABLE mods ADD COLUMN extra_categories TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE mods ADD COLUMN unlisted INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE mods ADD COLUMN license TEXT NOT NULL DEFAULT 'All Rights Reserved';
  ALTER TABLE mods ADD COLUMN links TEXT NOT NULL DEFAULT '[]';

  UPDATE mods SET
    class_name = CASE category WHEN 'Plugin' THEN 'Plugins' ELSE 'Mods' END,
    summary = substr(trim(replace(replace(description, char(13), ' '), char(10), ' ')), 1, 200);
  `
];

function migrate(db) {
  let version = db.pragma('user_version', { simple: true });
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
    version += 1;
  }
}

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'site.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

module.exports = { openDb, migrate, MIGRATIONS };
