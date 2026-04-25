"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH  = process.env.DB_PATH  || path.join(DATA_DIR, "gamebacklog.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    category TEXT NOT NULL,
    rank     INTEGER,
    mode     TEXT,
    risk     TEXT,
    hours    TEXT,
    note     TEXT
  );

  CREATE TABLE IF NOT EXISTS profile (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS pending (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    reason      TEXT,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT,
    approved_at TEXT,
    rejected_at TEXT
  );

  CREATE TABLE IF NOT EXISTS credentials (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    username     TEXT NOT NULL,
    hash         TEXT NOT NULL,
    salt         TEXT NOT NULL,
    totp_secret  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token      TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_setup (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    secret     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// ─── Games ────────────────────────────────────────────────────────────────────

function readGames() {
  const rows = db.prepare("SELECT * FROM games").all();
  const result = {};
  for (const row of rows) {
    if (!result[row.category]) result[row.category] = [];
    result[row.category].push({
      id: row.id, title: row.title, rank: row.rank,
      mode: row.mode, risk: row.risk, hours: row.hours, note: row.note,
    });
  }
  return result;
}

const upsertGame = db.prepare(`
  INSERT INTO games (id, title, category, rank, mode, risk, hours, note)
  VALUES (@id, @title, @category, @rank, @mode, @risk, @hours, @note)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, category=excluded.category, rank=excluded.rank,
    mode=excluded.mode, risk=excluded.risk, hours=excluded.hours, note=excluded.note
`);

const deleteGame = db.prepare("DELETE FROM games WHERE id = ?");
const deleteAllGames = db.prepare("DELETE FROM games");

function writeGames(gamesObj) {
  const replaceAll = db.transaction((obj) => {
    deleteAllGames.run();
    for (const [category, list] of Object.entries(obj)) {
      for (const g of (list || [])) {
        upsertGame.run({
          id: g.id, title: g.title, category,
          rank: g.rank ?? null, mode: g.mode ?? null,
          risk: g.risk ?? null, hours: g.hours ?? null, note: g.note ?? null,
        });
      }
    }
  });
  replaceAll(gamesObj);
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function readProfile() {
  const row = db.prepare("SELECT content FROM profile WHERE id = 1").get();
  return row ? row.content : "";
}

function writeProfile(content) {
  db.prepare(`
    INSERT INTO profile (id, content) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content
  `).run(typeof content === "string" ? content : JSON.stringify(content));
}

// ─── Pending ──────────────────────────────────────────────────────────────────

function rowToPending(row) {
  return {
    id:         row.id,
    type:       row.type,
    status:     row.status,
    reason:     row.reason,
    data:       JSON.parse(row.data),
    createdAt:  row.created_at,
    updatedAt:  row.updated_at  || undefined,
    approvedAt: row.approved_at || undefined,
    rejectedAt: row.rejected_at || undefined,
  };
}

function readPending() {
  return db.prepare("SELECT * FROM pending ORDER BY created_at ASC").all().map(rowToPending);
}

function writePending(items) {
  const replace = db.transaction((arr) => {
    db.prepare("DELETE FROM pending").run();
    const ins = db.prepare(`
      INSERT INTO pending (id, type, status, reason, data, created_at, updated_at, approved_at, rejected_at)
      VALUES (@id, @type, @status, @reason, @data, @created_at, @updated_at, @approved_at, @rejected_at)
    `);
    for (const p of arr) {
      ins.run({
        id:          p.id,
        type:        p.type,
        status:      p.status,
        reason:      p.reason ?? null,
        data:        JSON.stringify(p.data),
        created_at:  p.createdAt,
        updated_at:  p.updatedAt  ?? null,
        approved_at: p.approvedAt ?? null,
        rejected_at: p.rejectedAt ?? null,
      });
    }
  });
  replace(items);
}

// ─── Credentials ──────────────────────────────────────────────────────────────

function readCredentials() {
  const row = db.prepare("SELECT * FROM credentials WHERE id = 1").get();
  if (!row) return null;
  return { username: row.username, hash: row.hash, salt: row.salt, totpSecret: row.totp_secret };
}

function writeCredentials(creds) {
  db.prepare(`
    INSERT INTO credentials (id, username, hash, salt, totp_secret)
    VALUES (1, @username, @hash, @salt, @totp_secret)
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username, hash=excluded.hash,
      salt=excluded.salt, totp_secret=excluded.totp_secret
  `).run({
    username: creds.username, hash: creds.hash,
    salt: creds.salt, totp_secret: creds.totpSecret,
  });
}

// ─── Refresh tokens ───────────────────────────────────────────────────────────

function readRefreshTokens() {
  const rows = db.prepare("SELECT token, expires_at FROM refresh_tokens").all();
  const result = {};
  for (const row of rows) result[row.token] = row.expires_at;
  return result;
}

function writeRefreshTokens(tokensObj) {
  const replace = db.transaction((obj) => {
    db.prepare("DELETE FROM refresh_tokens").run();
    const ins = db.prepare("INSERT INTO refresh_tokens (token, expires_at) VALUES (?, ?)");
    for (const [token, exp] of Object.entries(obj)) ins.run(token, exp);
  });
  replace(tokensObj);
}

// ─── Pending setup ────────────────────────────────────────────────────────────

function readPendingSetup() {
  const row = db.prepare("SELECT * FROM pending_setup WHERE id = 1").get();
  if (!row) return null;
  return { secret: row.secret, createdAt: row.created_at };
}

function writePendingSetup(obj) {
  if (obj === null) {
    db.prepare("DELETE FROM pending_setup WHERE id = 1").run();
    return;
  }
  db.prepare(`
    INSERT INTO pending_setup (id, secret, created_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET secret=excluded.secret, created_at=excluded.created_at
  `).run(obj.secret, obj.createdAt);
}

// ─── readJSON / writeJSON drop-in replacements ───────────────────────────────

function readJSON(file, def) {
  try {
    switch (file) {
      case "games.json":         return readGames();
      case "profile.json":       return readProfile();
      case "pending.json":       return readPending();
      case "credentials.json":   return readCredentials();
      case "refresh_tokens.json": return readRefreshTokens();
      case "pending_setup.json": return readPendingSetup();
      default: return def;
    }
  } catch {
    return def;
  }
}

function writeJSON(file, data) {
  switch (file) {
    case "games.json":          return writeGames(data);
    case "profile.json":        return writeProfile(data);
    case "pending.json":        return writePending(data);
    case "credentials.json":    return writeCredentials(data);
    case "refresh_tokens.json": return writeRefreshTokens(data);
    case "pending_setup.json":  return writePendingSetup(data);
  }
}

module.exports = { db, readJSON, writeJSON };
