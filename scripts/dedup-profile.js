#!/usr/bin/env node
"use strict";

// One-time script to collapse duplicate sections in the taste profile.
// Keeps the LAST occurrence of each section (most recent Claude suggestion).
// Safe to re-run — idempotent.

const path = require("path");
const envPath = path.join(__dirname, "..", ".env");
const fs = require("fs");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const { readJSON, writeJSON } = require("../db");

const profile = readJSON("profile.json", "");
if (!profile.trim()) { console.log("Profile is empty — nothing to do."); process.exit(0); }

// Split into sections. A section header is a line of ALL CAPS (and spaces/punctuation).
const headerRe = /^[A-Z][A-Z\s\/\(\)&+,:'-]+$/;
const lines = profile.split("\n");

const sections = []; // [ { header: string|null, lines: string[] } ]
let current = { header: null, lines: [] };

for (const line of lines) {
  if (headerRe.test(line.trim()) && line.trim().length > 2) {
    if (current.header !== null || current.lines.some(l => l.trim())) {
      sections.push(current);
    }
    current = { header: line.trim(), lines: [] };
  } else {
    current.lines.push(line);
  }
}
if (current.header !== null || current.lines.some(l => l.trim())) {
  sections.push(current);
}

// Merge: for duplicate headers keep the last one
const seen = new Map(); // header → index in merged array
const merged = [];
for (const sec of sections) {
  const key = sec.header ?? "__preamble__";
  if (seen.has(key)) {
    merged[seen.get(key)] = sec; // overwrite with later version
  } else {
    seen.set(key, merged.length);
    merged.push(sec);
  }
}

// Reconstruct
const result = merged.map(sec => {
  const body = sec.lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return sec.header ? `${sec.header}\n${body}` : body;
}).join("\n\n").trim();

// Show diff summary
const beforeCount = sections.length;
const afterCount  = merged.length;
const dupes = beforeCount - afterCount;

if (dupes === 0) {
  console.log("No duplicate sections found — profile is already clean.");
  process.exit(0);
}

console.log(`\nFound ${dupes} duplicate section(s) — keeping last version of each:\n`);
const headerCounts = {};
for (const sec of sections) {
  const k = sec.header ?? "__preamble__";
  headerCounts[k] = (headerCounts[k] || 0) + 1;
}
for (const [k, count] of Object.entries(headerCounts)) {
  if (count > 1) console.log(`  ${k} — ${count} copies → kept last`);
}

writeJSON("profile.json", result);
console.log(`\nDone — profile updated (${beforeCount} sections → ${afterCount} sections).\n`);
