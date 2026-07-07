"use strict";

const os     = require("os");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const jwt    = require("jsonwebtoken");

// Generate an ephemeral RSA-2048 keypair for this test process.
// PUBLIC_KEY_PATH must be set before any request reaches verifyAccess(),
// which is lazy — so setting it here (at module load) is early enough.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding:  { type: "spki",  format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const _pubKeyFile = path.join(os.tmpdir(), `gamebacklog-test-pubkey-${process.pid}.pem`);
fs.writeFileSync(_pubKeyFile, publicKey);
process.env.PUBLIC_KEY_PATH = _pubKeyFile;

// Must be evaluated after app.js has loaded .env via dotenv
function getTestIssuer() {
  return process.env.ACCOUNT_MANAGER_ISSUER || process.env.JWT_ISSUER || "http://localhost:3001";
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
}

<<<<<<< Updated upstream
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
=======
function setupAndLogin() {
  const accessToken = jwt.sign(
    { sub: "tester", aud: "gamebacklog", iss: getTestIssuer() },
    privateKey,
    { algorithm: "RS256", expiresIn: "1h" }
  );
  return { accessToken };
>>>>>>> Stashed changes
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
