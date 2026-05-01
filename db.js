"use strict";

const Database = require("better-sqlite3");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH  = process.env.DB_PATH  || path.join(DATA_DIR, "gamebacklog.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Migrate existing databases that predate later-added columns
try { db.exec("ALTER TABLE games ADD COLUMN played_date TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN url TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN platform TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN input TEXT"); } catch {}
try { db.exec("ALTER TABLE games ADD COLUMN image_url TEXT"); } catch {}
try { db.exec("ALTER TABLE credentials ADD COLUMN recovery_codes TEXT"); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    rank        INTEGER,
    mode        TEXT,
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

  CREATE TABLE IF NOT EXISTS credentials (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    username        TEXT NOT NULL,
    hash            TEXT NOT NULL,
    salt            TEXT NOT NULL,
    totp_secret     TEXT NOT NULL,
    recovery_codes  TEXT
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

  CREATE TABLE IF NOT EXISTS passkey_credentials (
    credential_id TEXT PRIMARY KEY,
    public_key    TEXT NOT NULL,
    counter       INTEGER NOT NULL DEFAULT 0,
    device_name   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    challenge  TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS setup_state (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    username    TEXT,
    hash        TEXT,
    salt        TEXT,
    challenge   TEXT,
    created_at  INTEGER NOT NULL
  );
`);

// ─── Games ────────────────────────────────────────────────────────────────────

const ALL_CATS = ['inbox', 'queue', 'caveats', 'decompression', 'yourCall', 'played'];

function rowToGame(row) {
  const g = { id: row.id, title: row.title };
  if (row.rank        != null) g.rank       = row.rank;
  if (row.mode        != null) g.mode       = row.mode;
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
    rank: g.rank ?? null, mode: g.mode ?? null,
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
  INSERT INTO games (id, title, category, rank, mode, risk, hours, note, played_date, url, platform, input, image_url)
  VALUES (@id, @title, @category, @rank, @mode, @risk, @hours, @note, @played_date, @url, @platform, @input, @image_url)
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, category=excluded.category, rank=excluded.rank,
    mode=excluded.mode, risk=excluded.risk, hours=excluded.hours, note=excluded.note,
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

// ─── Credentials ──────────────────────────────────────────────────────────────

function readCredentials() {
  const row = db.prepare("SELECT * FROM credentials WHERE id = 1").get();
  if (!row) return null;
  return {
    username:      row.username,
    hash:          row.hash,
    salt:          row.salt,
    totpSecret:    row.totp_secret,
    recoveryCodes: row.recovery_codes ? JSON.parse(row.recovery_codes) : [],
  };
}

function writeCredentials(creds) {
  db.prepare(`
    INSERT INTO credentials (id, username, hash, salt, totp_secret, recovery_codes)
    VALUES (1, @username, @hash, @salt, @totp_secret, @recovery_codes)
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username, hash=excluded.hash,
      salt=excluded.salt, totp_secret=excluded.totp_secret,
      recovery_codes=excluded.recovery_codes
  `).run({
    username:       creds.username,
    hash:           creds.hash,
    salt:           creds.salt,
    totp_secret:    creds.totpSecret,
    recovery_codes: creds.recoveryCodes ? JSON.stringify(creds.recoveryCodes) : null,
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

// ─── Passkey credentials ──────────────────────────────────────────────────────

function readPasskeyCredentials() {
  return db.prepare("SELECT * FROM passkey_credentials").all().map(row => ({
    credentialId: row.credential_id,
    publicKey:    row.public_key,
    counter:      row.counter,
    deviceName:   row.device_name,
    createdAt:    row.created_at,
  }));
}

function writePasskeyCredential(cred) {
  db.prepare(`
    INSERT INTO passkey_credentials (credential_id, public_key, counter, device_name, created_at)
    VALUES (@credential_id, @public_key, @counter, @device_name, @created_at)
    ON CONFLICT(credential_id) DO UPDATE SET
      public_key=excluded.public_key, counter=excluded.counter,
      device_name=excluded.device_name
  `).run({
    credential_id: cred.credentialId,
    public_key:    cred.publicKey,
    counter:       cred.counter ?? 0,
    device_name:   cred.deviceName ?? null,
    created_at:    cred.createdAt ?? new Date().toISOString(),
  });
}

function deletePasskeyCredential(credentialId) {
  db.prepare("DELETE FROM passkey_credentials WHERE credential_id = ?").run(credentialId);
}

// ─── WebAuthn challenge (login / add-device) ──────────────────────────────────

function readWebAuthnChallenge() {
  const row = db.prepare("SELECT * FROM webauthn_challenges WHERE id = 1").get();
  if (!row) return null;
  return { challenge: row.challenge, createdAt: row.created_at };
}

function writeWebAuthnChallenge(obj) {
  if (obj === null) {
    db.prepare("DELETE FROM webauthn_challenges WHERE id = 1").run();
    return;
  }
  db.prepare(`
    INSERT INTO webauthn_challenges (id, challenge, created_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET challenge=excluded.challenge, created_at=excluded.created_at
  `).run(obj.challenge, obj.createdAt);
}

// ─── Setup state (in-progress first-run registration) ─────────────────────────

function readSetupState() {
  const row = db.prepare("SELECT * FROM setup_state WHERE id = 1").get();
  if (!row) return null;
  return { username: row.username, hash: row.hash, salt: row.salt, challenge: row.challenge, createdAt: row.created_at };
}

function writeSetupState(obj) {
  if (obj === null) {
    db.prepare("DELETE FROM setup_state WHERE id = 1").run();
    return;
  }
  db.prepare(`
    INSERT INTO setup_state (id, username, hash, salt, challenge, created_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username, hash=excluded.hash, salt=excluded.salt,
      challenge=excluded.challenge, created_at=excluded.created_at
  `).run(obj.username, obj.hash, obj.salt, obj.challenge, obj.createdAt);
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
      case "pending_setup.json":         return readPendingSetup();
      case "passkey_credentials.json":   return readPasskeyCredentials();
      case "webauthn_challenge.json":    return readWebAuthnChallenge();
      case "setup_state.json":           return readSetupState();
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
    case "pending_setup.json":        return writePendingSetup(data);
    case "webauthn_challenge.json":   return writeWebAuthnChallenge(data);
    case "setup_state.json":          return writeSetupState(data);
  }
}

module.exports = {
  db, readJSON, writeJSON,
  // Typed per-row API
  findGameById, insertGame, updateGame, deleteGameById,
  // Paskeys
  writePasskeyCredential, deletePasskeyCredential
};
