#!/usr/bin/env node
"use strict";

// Reads the existing JSON files in data/ and imports them into the SQLite DB.
// Safe to re-run — uses upserts / full replaces, won't duplicate data.
// The JSON files are left untouched.

const fs   = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");

// Load env so DB_PATH / DATA_DIR overrides work the same as the main server
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const { readJSON: dbRead, writeJSON: dbWrite } = require("../db");

function loadJSON(file, def) {
  const fp = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); }
  catch { return def; }
}

let migrated = 0;

function migrate(label, file, def) {
  const data = loadJSON(file, null);
  if (data === null) {
    console.log(`  skip  ${file} — not found`);
    return;
  }
  dbWrite(file, data);
  migrated++;

  // Quick sanity: read back and compare counts
  const back = dbRead(file, def);
  let count;
  if (Array.isArray(back))        count = `${back.length} rows`;
  else if (typeof back === "object" && back !== null) {
    const keys = Object.keys(back);
    count = Array.isArray(back[keys[0]])
      ? `${keys.length} categories, ${keys.reduce((n, k) => n + (back[k]?.length || 0), 0)} rows`
      : `${keys.length} entries`;
  } else count = `${String(back).length} chars`;

  console.log(`  ok    ${file} — ${count}`);
}

console.log(`\nMigrating JSON → SQLite (${process.env.DB_PATH || path.join(DATA_DIR, "gamebacklog.db")})\n`);

migrate("games",          "games.json",          {});
migrate("profile",        "profile.json",         "");
migrate("pending",        "pending.json",         []);
migrate("credentials",    "credentials.json",     null);
migrate("refresh_tokens", "refresh_tokens.json",  {});

console.log(`\nDone — ${migrated} file(s) migrated.\n`);
