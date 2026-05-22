"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, "..", "data");
const DB_PATH  = process.env.DB_PATH  || path.resolve(DATA_DIR, "gamebacklog.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Migrate existing databases that predate later-added columns
try { db.exec("ALTER TABLE games ADD COLUMN played_date TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN url TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN platform TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN input TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN image_url TEXT"); } catch {}
try { db.exec("ALTER TABLE games RENAME COLUMN mode TO genre"); } catch (e) {
  if (!e.message?.includes("no such column")) console.warn("[db] genre migration:", e.message);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    rank        INTEGER,
    genre       TEXT,
    risk        TEXT,
    hours       TEXT,
    note        TEXT,
    played_date TEXT,
    url         TEXT,
    platform    TEXT,
    input       TEXT,
    image_url   TEXT
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
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_games_category ON games(category);
  CREATE INDEX IF NOT EXISTS idx_pending_status ON pending(status);
  CREATE INDEX IF NOT EXISTS idx_pending_type ON pending(type);
`);

// ─── Games ────────────────────────────────────────────────────────────────────

const ALL_CATS = ['inbox', 'queue', 'caveats', 'decompression', 'yourCall', 'played', 'skip'];

function rowToGame(row) {
  const g = { id: row.id, title: row.title };
  if (row.rank        != null) g.rank       = row.rank;
  if (row.genre       != null) g.genre      = row.genre;
  if (row.risk        != null) g.risk       = row.risk;
  if (row.hours       != null) g.hours      = row.hours;
  if (row.note        != null) g.note       = row.note;
  if (row.played_date != null) g.playedDate = row.played_date;
  if (row.url         != null) g.url        = row.url;
  if (row.platform    != null) g.platform   = row.platform;
  if (row.input       != null) g.input      = row.input;
  if (row.image_url   != null) g.imageUrl   = row.image_url;
  return g;
}

function gameToRow(g, category) {
  return {
    id: g.id, title: g.title, category,
    rank: g.rank ?? null, genre: g.genre ?? g.mode ?? null,
    risk: g.risk ?? null, hours: g.hours ?? null, note: g.note ?? null,
    played_date: g.playedDate ?? null,
    url: g.url ?? null,
    platform: g.platform ?? null,
    input: g.input ?? null,
    image_url: g.imageUrl ?? null,
  };
}

function readGames() {
  const rows = db.prepare("SELECT * FROM games").all();
  if (rows.length === 0) return null;
  const result = Object.fromEntries(ALL_CATS.map(c => [c, []]));
  for (const row of rows) {
    if (!result[row.category]) result[row.category] = [];
    result[row.category].push(rowToGame(row));
  }
  return result;
}

const upsertGame = db.prepare(`
  INSERT INTO games (id, title, category, rank, genre, risk, hours, note, played_date, url, platform, input, image_url)
  VALUES (@id, @title, @category, @rank, @genre, @risk, @hours, @note, @played_date, @url, @platform, @input, @image_url)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, category=excluded.category, rank=excluded.rank,
    genre=excluded.genre, risk=excluded.risk, hours=excluded.hours, note=excluded.note,
    played_date=excluded.played_date, url=excluded.url,
    platform=excluded.platform, input=excluded.input, image_url=excluded.image_url
`);

const deleteGame = db.prepare("DELETE FROM games WHERE id = ?");
const deleteAllGames = db.prepare("DELETE FROM games");

function writeGames(gamesObj) {
  const replaceAll = db.transaction((obj) => {
    deleteAllGames.run();
    for (const [category, list] of Object.entries(obj)) {
      for (const g of (list || [])) upsertGame.run(gameToRow(g, category));
    }
  });
  replaceAll(gamesObj);
}

// ── Typed per-row API for games — preferred over the readJSON/writeJSON shim
// for endpoints that mutate a single game. Avoids full table rewrites.

function findGameById(id) {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(id);
  return row ? { ...rowToGame(row), category: row.category } : null;
}

function insertGame(game, category) {
  upsertGame.run(gameToRow(game, category));
}

function updateGame(id, patch) {
  const row = db.prepare("SELECT * FROM games WHERE id = ?").get(id);
  if (!row) return false;
  // Patch keys are camelCase (mirroring the API). Map back to columns.
  const next = { ...rowToGame(row), category: row.category, ...patch };
  upsertGame.run(gameToRow(next, patch.category ?? row.category));
  return true;
}

function deleteGameById(id) {
  return deleteGame.run(id).changes > 0;
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function migrateLegacyProfile(text) {
  const sections = [];
  const lines = (text || "").split("\n");
  let current = null;
  for (const line of lines) {
    if (/^[A-Z][A-Z\s\/\(\)&+,:'-]+$/.test(line.trim()) && line.trim().length > 0) {
      if (current) sections.push(current);
      current = { name: line.trim(), text: "" };
    } else if (current) {
      current.text += (current.text ? "\n" : "") + line;
    }
  }
  if (current) sections.push(current);
  sections.forEach(s => { s.text = s.text.trim(); });
  return sections.filter(s => s.name);
}

function readProfile() {
  const row = db.prepare("SELECT content FROM profile WHERE id = 1").get();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.content);
    if (Array.isArray(parsed)) return parsed;
    // Stored as a JSON string (legacy string wrapped in JSON)
    if (typeof parsed === "string") return migrateLegacyProfile(parsed);
  } catch {
    // Raw text stored without JSON encoding
    return migrateLegacyProfile(row.content);
  }
  return null;
}

function writeProfile(content) {
  const value = Array.isArray(content) ? JSON.stringify(content) : JSON.stringify(content ?? []);
  db.prepare(`
    INSERT INTO profile (id, content) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content
  `).run(value);
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

module.exports = {
  db,
  // Games
  readGames, writeGames, findGameById, insertGame, updateGame, deleteGameById,
  // Profile
  readProfile, writeProfile,
  // Pending
  readPending, writePending,
};
