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

function setupAndLogin() {
  const accessToken = jwt.sign(
    { sub: "tester", aud: "gamebacklog", iss: getTestIssuer() },
    privateKey,
    { algorithm: "RS256", expiresIn: "1h" }
  );
  return { accessToken };
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
