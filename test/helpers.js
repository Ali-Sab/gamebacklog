"use strict";

const os   = require("os");
const fs   = require("fs");
const path = require("path");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
}

// Complete setup flow — returns { secret, recoveryCodes }
async function setupUser(request, app, computeTOTP, { username = "tester", password = "password123" } = {}) {
  const { body } = await request(app).get("/api/setup/secret").expect(200);
  const { secret } = body;
  const res = await request(app)
    .post("/api/setup")
    .send({ username, password, totpCode: computeTOTP(secret) })
    .expect(200);
  return { secret, recoveryCodes: res.body.recoveryCodes || [] };
}

// Login with username + password + TOTP; returns { accessToken, cookie, csrfToken }
async function login(request, app, secret, computeTOTP, { username = "tester", password = "password123" } = {}) {
  const step1 = await request(app)
    .post("/api/auth/login")
    .send({ username, password })
    .expect(200);
  const step2 = await request(app)
    .post("/api/auth/mfa")
    .send({ mfaToken: step1.body.mfaToken, code: computeTOTP(secret) })
    .expect(200);
  return {
    accessToken: step2.body.accessToken,
    csrfToken:   step2.body.csrfToken,
    cookie:      step2.headers["set-cookie"],
  };
}

// Shorthand: setup + login in one call
async function setupAndLogin(request, app, computeTOTP, opts = {}) {
  const { secret } = await setupUser(request, app, computeTOTP, opts);
  return login(request, app, secret, computeTOTP, opts);
}

// In-memory readJSON / writeJSON for MCP unit tests
function makeStore(files = {}) {
  const store = {};
  for (const [k, v] of Object.entries(files)) store[k] = JSON.parse(JSON.stringify(v));
  const readJSON = (file, def) => (file in store ? JSON.parse(JSON.stringify(store[file])) : def);
  const writeJSON = (file, data) => { store[file] = JSON.parse(JSON.stringify(data)); };
  return { readJSON, writeJSON, store };
}

module.exports = { tmpDir, setupUser, login, setupAndLogin, makeStore };
