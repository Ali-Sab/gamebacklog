"use strict";

<<<<<<< Updated upstream
const crypto = require("crypto");
const jwt    = require("jsonwebtoken");
const { generateSync: _otpGenerate, verifySync: _otpVerify, generateSecret: _otpSecret } = require("otplib");
const { createGuardrails: _createGuardrails } = require("@otplib/core");

// Relax minimum secret length — existing secrets may be 10 bytes (pre-v13 default).
const _otpGuardrails = { ..._createGuardrails(), MIN_SECRET_BYTES: 0 };

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

if (process.env.NODE_ENV === "production" && JWT_SECRET === "dev-secret-change-in-production") {
  throw new Error("JWT_SECRET must be set in production — generate with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
}

function hashPassword(password, salt) {
  return new Promise((res, rej) =>
    crypto.pbkdf2(password, salt, 310000, 64, "sha512",
      (err, key) => err ? rej(err) : res(key.toString("hex")))
  );
}

// TOTP via otplib (RFC 6238). 30s step, ±1 window for clock drift.
function computeTOTP(secret, offset = 0) {
  const epoch = Math.floor(Date.now() / 1000) + offset * 30;
  return _otpGenerate({ secret, epoch, guardrails: _otpGuardrails });
}

function verifyTOTP(secret, code) {
  const c = (code || "").replace(/\s/g, "");
  if (c.length !== 6) return false;
  return _otpVerify({ secret, token: c, epochTolerance: 30, guardrails: _otpGuardrails }).valid;
}

function generateSecret() {
  return _otpSecret(20); // 20 bytes → 32-char base32
}

function newRecoveryCode() {
  // 10 hex chars, formatted like "a3f4-b2c1-9e" for readability
  const raw = crypto.randomBytes(5).toString("hex");
  return `${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,10)}`;
}

async function generateRecoveryCodes(salt, n = 8) {
  const plain = Array.from({ length: n }, newRecoveryCode);
  const hashes = await Promise.all(plain.map(c => hashPassword(c, salt)));
  return { plain, hashes };
}

function signAccess(username) {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "1h" });
}

function verifyAccess(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

module.exports = {
  JWT_SECRET,
  hashPassword, computeTOTP, verifyTOTP, generateSecret,
  newRecoveryCode, generateRecoveryCodes,
  signAccess, verifyAccess,
};
=======
const fs  = require("fs");
const jwt = require("jsonwebtoken");

let _publicKey = null;

// Fetches the RS256 public key from account-manager's JWKS endpoint and caches it.
// PUBLIC_KEY_PATH env var is an undocumented escape hatch used by tests (no live
// account-manager available in test environments).
async function preloadPublicKey() {
  if (_publicKey) return;

  if (process.env.PUBLIC_KEY_PATH) {
    _publicKey = fs.readFileSync(process.env.PUBLIC_KEY_PATH, "utf8");
    return;
  }

  const base = (process.env.ACCOUNT_MANAGER_URL || "http://localhost:3001").replace(/\/$/, "");
  const res = await fetch(`${base}/.well-known/jwks.json`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  const jwk = keys?.[0];
  if (!jwk) throw new Error("No keys in JWKS response");
  const keyObject = require("crypto").createPublicKey({ key: jwk, format: "jwk" });
  _publicKey = keyObject.export({ type: "spki", format: "pem" });
}

function loadKeySync() {
  if (!_publicKey && process.env.PUBLIC_KEY_PATH) {
    _publicKey = fs.readFileSync(process.env.PUBLIC_KEY_PATH, "utf8");
  }
}

function verifyAccess(token) {
  loadKeySync();
  if (!_publicKey) return null;
  try {
    return jwt.verify(token, _publicKey, { algorithms: ["RS256"], audience: "gamebacklog" });
  } catch { return null; }
}

function verifyMcpToken(token) {
  loadKeySync();
  if (!_publicKey) return null;
  try {
    return jwt.verify(token, _publicKey, { algorithms: ["RS256"], audience: "mcp" });
  } catch { return null; }
}

module.exports = { preloadPublicKey, verifyAccess, verifyMcpToken };
>>>>>>> Stashed changes
