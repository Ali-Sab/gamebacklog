"use strict";

const fs  = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");

// Public key used to verify RS256 tokens issued by account-manager.
// Either point PUBLIC_KEY_PATH at the PEM file, or set ACCOUNT_MANAGER_JWKS_URI
// for automatic fetching (requires a startup async init — see loadPublicKey).
let _publicKey = null;

function getPublicKey() {
  if (_publicKey) return _publicKey;
  const keyPath = process.env.PUBLIC_KEY_PATH ||
    process.env.ACCOUNT_MANAGER_PUBLIC_KEY_PATH ||
    path.resolve(__dirname, "..", "..", "account-manager", "data", "keys", "public.pem");
  if (!fs.existsSync(keyPath)) {
    throw new Error(`RS256 public key not found at ${keyPath}. Set PUBLIC_KEY_PATH or run account-manager setup.`);
  }
  _publicKey = fs.readFileSync(keyPath, "utf8");
  return _publicKey;
}

function getIssuer() {
  return process.env.ACCOUNT_MANAGER_ISSUER || process.env.JWT_ISSUER || "http://localhost:3001";
}

// In test mode (JWT_SECRET set), accept HS256 tokens so existing test helpers still work.
const TEST_SECRET = process.env.JWT_SECRET;

// Verifies an RS256 access token issued by account-manager for the 'gamebacklog' audience.
function verifyAccess(token) {
  if (TEST_SECRET) {
    try { return jwt.verify(token, TEST_SECRET); } catch { return null; }
  }
  try {
    return jwt.verify(token, getPublicKey(), {
      algorithms: ["RS256"],
      audience:   "gamebacklog",
      issuer:     getIssuer(),
    });
  } catch { return null; }
}

// Verifies an RS256 token issued by account-manager for the 'mcp' audience.
function verifyMcpToken(token) {
  if (TEST_SECRET) {
    try { return jwt.verify(token, TEST_SECRET); } catch { return null; }
  }
  try {
    return jwt.verify(token, getPublicKey(), {
      algorithms: ["RS256"],
      audience:   "mcp",
      issuer:     getIssuer(),
    });
  } catch { return null; }
}

// In test mode only: sign a token with HS256 for use by test helpers.
function signAccessForTest(username) {
  if (!TEST_SECRET) throw new Error("signAccessForTest only available in test mode (JWT_SECRET)");
  return jwt.sign({ sub: username }, TEST_SECRET, { expiresIn: "1h" });
}

module.exports = { verifyAccess, verifyMcpToken, signAccessForTest };
