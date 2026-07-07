"use strict";

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
