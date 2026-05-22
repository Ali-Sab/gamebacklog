"use strict";

const os   = require("os");
const fs   = require("fs");
const path = require("path");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
}

// In tests (JWT_SECRET set), get an access token directly without the auth flow.
// Auth routes (login/setup/MFA) now live in account-manager, not game backlog.
function setupAndLogin() {
  const { signAccessForTest } = require("../server/lib/crypto");
  return { accessToken: signAccessForTest("tester") };
}

// In-memory readJSON / writeJSON for MCP unit tests
function makeStore(files = {}) {
  const store = {};
  for (const [k, v] of Object.entries(files)) store[k] = JSON.parse(JSON.stringify(v));
  const readJSON = (file, def) => (file in store ? JSON.parse(JSON.stringify(store[file])) : def);
  const writeJSON = (file, data) => { store[file] = JSON.parse(JSON.stringify(data)); };
  return { readJSON, writeJSON, store };
}

module.exports = { tmpDir, setupAndLogin, makeStore };
