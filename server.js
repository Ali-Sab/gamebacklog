"use strict";

// ─── Load env ───────────────────────────────────────────────────────────────
const path = require("path");
// dotenv is no-overwrite by default — tests can still inject env vars before require
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express     = require("express");
const crypto      = require("crypto");
const jwt         = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const rateLimit   = require("express-rate-limit");
const QRCode      = require("qrcode");
const { createMcpRouter } = require("./mcp-server");
const { db, readJSON, writeJSON, writePasskeyCredential, deletePasskeyCredential } = require("./db");
const { apply: applyPending } = require("./pendingTypes");

const app  = express();
app.set("trust proxy", 1); // trust first proxy (Nginx / Tailscale Funnel)
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const MCP_TOKEN  = process.env.MCP_TOKEN  || "";
const IS_PROD          = process.env.NODE_ENV === "production";
const WEBAUTHN_RP_ID   = process.env.WEBAUTHN_RP_ID   || "localhost";
const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || "Game Backlog";

// Lazy-loaded because @simplewebauthn/server is ESM-only
let _webauthn = null;
async function getWebAuthn() {
  if (!_webauthn) _webauthn = await import("@simplewebauthn/server");
  return _webauthn;
}

function getOrigin(req) {
  return req.headers.origin || `${req.protocol}://${req.get("host")}`;
}


// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// CORS — only needed if frontend is on a different origin
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Crypto helpers ──────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return new Promise((res, rej) =>
    crypto.pbkdf2(password, salt, 310000, 64, "sha512",
      (err, key) => err ? rej(err) : res(key.toString("hex")))
  );
}

function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const i = A.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function computeTOTP(secret, offset = 0) {
  const key = base32Decode(secret);
  const counter = BigInt(Math.floor(Date.now() / 30000) + offset);
  const buf = Buffer.alloc(8);
  let t = counter;
  for (let i = 7; i >= 0; i--) { buf[i] = Number(t & 0xffn); t >>= 8n; }
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0xf;
  const n = ((hmac[o] & 0x7f) << 24) | ((hmac[o+1] & 0xff) << 16) |
            ((hmac[o+2] & 0xff) << 8) | (hmac[o+3] & 0xff);
  return String(n % 1_000_000).padStart(6, "0");
}

function verifyTOTP(secret, code) {
  const c = code.replace(/\s/g, "");
  if (c.length !== 6) return false;
  for (const off of [-1, 0, 1]) {
    if (computeTOTP(secret, off) === c) return true;
  }
  return false;
}

function generateSecret() {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(crypto.randomBytes(16), b => A[b % 32]).join("");
}

// ─── JWT helpers ─────────────────────────────────────────────────────────────
function signAccess(username) {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: "1h" });
}

function verifyAccess(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });
  const payload = verifyAccess(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = payload.sub;
  next();
}

// ─── Refresh token store ──────────────────────────────────────────────────────
function saveRefreshToken(token) {
  const tokens = readJSON("refresh_tokens.json", {});
  tokens[token] = Date.now() + 30 * 24 * 60 * 60 * 1000;
  // purge expired
  for (const [k, exp] of Object.entries(tokens)) {
    if (exp < Date.now()) delete tokens[k];
  }
  writeJSON("refresh_tokens.json", tokens);
}

function validateRefreshToken(token) {
  const tokens = readJSON("refresh_tokens.json", {});
  return tokens[token] && tokens[token] > Date.now();
}

function revokeRefreshToken(token) {
  const tokens = readJSON("refresh_tokens.json", {});
  delete tokens[token];
  writeJSON("refresh_tokens.json", tokens);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Check if setup has been done
app.get("/api/setup/status", (req, res) => {
  const creds    = readJSON("credentials.json", null);
  const passkeys = readJSON("passkey_credentials.json", []);
  res.json({ configured: !!creds, hasPasskeys: passkeys.length > 0 });
});

// Get a fresh TOTP secret for setup
app.get("/api/setup/secret", async (req, res) => {
  const creds = readJSON("credentials.json", null);
  if (creds) return res.status(403).json({ error: "Already configured" });
  const secret = generateSecret();
  writeJSON("pending_setup.json", { secret, createdAt: Date.now() });
  const uri = `otpauth://totp/GameBacklog:setup?secret=${secret}&issuer=GameBacklog`;
  const qrDataUrl = await QRCode.toDataURL(uri);
  res.json({ secret, formatted: secret.match(/.{1,4}/g).join(" "), qrDataUrl });
});

// Complete setup
app.post("/api/setup", authLimiter, async (req, res) => {
  try {
    const creds = readJSON("credentials.json", null);
    if (creds) return res.status(403).json({ error: "Already configured" });
    const { username, password, totpCode } = req.body;
    if (!username || !password || !totpCode) return res.status(400).json({ error: "Missing fields" });
    if (password.length < 6) return res.status(400).json({ error: "Password too short" });
    const pending = readJSON("pending_setup.json", null);
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.status(400).json({ error: "Setup session expired, refresh the page" });
    }
    if (!verifyTOTP(pending.secret, totpCode)) {
      return res.status(400).json({ error: "Invalid TOTP code" });
    }
    const salt = crypto.randomBytes(32).toString("hex");
    const hash = await hashPassword(password, salt);
    writeJSON("credentials.json", { username: username.trim(), hash, salt, totpSecret: pending.secret });
    writeJSON("pending_setup.json", null);
    res.json({ ok: true });
  } catch (e) {
    console.error("Setup error:", e);
    res.status(500).json({ error: "Setup failed" });
  }
});

// Step 1: verify username + password
app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const creds = readJSON("credentials.json", null);
    if (!creds) return res.status(400).json({ error: "Not configured" });
    // Constant-time username check
    if (creds.username !== username?.trim()) {
      await hashPassword(password || "", creds.salt); // prevent timing attack
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const hash = await hashPassword(password || "", creds.salt);
    if (hash !== creds.hash) return res.status(401).json({ error: "Invalid credentials" });
    // Password OK — issue short-lived "mfa pending" token
    const mfaToken = jwt.sign({ sub: username, mfaPending: true }, JWT_SECRET, { expiresIn: "5m" });
    res.json({ mfaToken });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

// Step 2: verify TOTP, issue access + refresh tokens
app.post("/api/auth/mfa", authLimiter, (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const payload = jwt.verify(mfaToken, JWT_SECRET);
    if (!payload.mfaPending) return res.status(401).json({ error: "Invalid token" });
    const creds = readJSON("credentials.json", null);
    if (!verifyTOTP(creds.totpSecret, code)) {
      return res.status(401).json({ error: "Invalid MFA code" });
    }
    // Issue tokens
    const accessToken = signAccess(payload.sub);
    const refreshToken = crypto.randomBytes(48).toString("hex");
    saveRefreshToken(refreshToken);
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ accessToken });
  } catch (e) {
    res.status(401).json({ error: "MFA failed" });
  }
});

// Refresh access token using httpOnly cookie
app.post("/api/auth/refresh", (req, res) => {
  const rt = req.cookies?.refreshToken;
  if (!rt || !validateRefreshToken(rt)) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
  const creds = readJSON("credentials.json", null);
  if (!creds) return res.status(401).json({ error: "Not configured" });
  const accessToken = signAccess(creds.username);
  res.json({ accessToken });
});

// Logout — revoke refresh token
app.post("/api/auth/logout", (req, res) => {
  const rt = req.cookies?.refreshToken;
  if (rt) revokeRefreshToken(rt);
  res.clearCookie("refreshToken", { path: "/" });
  res.json({ ok: true });
});

// Change password
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password too short" });
    const creds = readJSON("credentials.json", null);
    const hash = await hashPassword(currentPassword || "", creds.salt);
    if (hash !== creds.hash) return res.status(401).json({ error: "Current password incorrect" });
    const salt = crypto.randomBytes(32).toString("hex");
    const newHash = await hashPassword(newPassword, salt);
    writeJSON("credentials.json", { ...creds, hash: newHash, salt });
    // revoke all refresh tokens
    writeJSON("refresh_tokens.json", {});
    res.clearCookie("refreshToken", { path: "/" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Password change failed" });
  }
});

// Get all app data (games + profile)
app.get("/api/data", requireAuth, (req, res) => {
  const games   = readJSON("games.json", null);
  const profile = readJSON("profile.json", null);
  res.json({ games, profile });
});

// Export — downloads a JSON snapshot of games + profile
app.get("/api/export", requireAuth, (req, res) => {
  const games   = readJSON("games.json", null);
  const profile = readJSON("profile.json", null);
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gamebacklog-${ts}.json"`);
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), games, profile }, null, 2));
});

// Import — replaces all data with the contents of an export file.
// Same payload validation as POST /api/data, plus required fields.
app.post("/api/import", requireAuth, (req, res) => {
  const { games, profile } = req.body || {};
  if (!games || typeof games !== "object" || Array.isArray(games)) {
    return res.status(400).json({ error: "games must be an object keyed by category" });
  }
  for (const [cat, list] of Object.entries(games)) {
    if (!Array.isArray(list)) {
      return res.status(400).json({ error: `games.${cat} must be an array` });
    }
  }
  if (profile != null && !Array.isArray(profile)) {
    return res.status(400).json({ error: "profile must be an array or null" });
  }
  db.transaction(() => {
    writeJSON("games.json", games);
    writeJSON("profile.json", profile ?? []);
  })();
  res.json({ ok: true });
});

// Save all app data
app.post("/api/data", requireAuth, (req, res) => {
  const { games, profile } = req.body || {};
  // Validate before any writes — refuse partial/empty payloads that would wipe state
  if (games !== undefined) {
    if (!games || typeof games !== "object" || Array.isArray(games)) {
      return res.status(400).json({ error: "games must be an object keyed by category" });
    }
    for (const [cat, list] of Object.entries(games)) {
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: `games.${cat} must be an array` });
      }
    }
  }
  if (profile !== undefined && !Array.isArray(profile)) {
    return res.status(400).json({ error: "profile must be an array" });
  }
  db.transaction(() => {
    if (games   !== undefined) writeJSON("games.json", games);
    if (profile !== undefined) writeJSON("profile.json", profile);
  })();
  res.json({ ok: true });
});

// ─── Pending queue ────────────────────────────────────────────────────────────

app.get("/api/pending/history", requireAuth, (req, res) => {
  res.json(readJSON("pending.json", []));
});

app.get("/api/pending", requireAuth, (req, res) => {
  const pending = readJSON("pending.json", []);
  res.json(pending.filter(p => p.status === "pending"));
});

// Read full app state into a mutable ctx for applyPending().
function loadCtx() {
  return {
    games:   readJSON("games.json", {})   || {},
    profile: readJSON("profile.json", []) || []
  };
}

function persistCtx(ctx) {
  writeJSON("games.json", ctx.games);
  writeJSON("profile.json", ctx.profile);
}

app.post("/api/pending/:id/approve", requireAuth, (req, res) => {
  try {
    const result = db.transaction(() => {
      const pending = readJSON("pending.json", []) || [];
      const item = pending.find(p => p.id === req.params.id);
      if (!item) return { status: 404, error: "Not found" };
      if (item.status !== "pending") return { status: 400, error: "Not pending" };
      const ctx = loadCtx();
      applyPending(item, ctx);
      persistCtx(ctx);
      item.status = "approved";
      item.approvedAt = new Date().toISOString();
      writeJSON("pending.json", pending);
      return { status: 200, pending };
    })();
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(result.pending.filter(p => p.status === "pending"));
  } catch (e) {
    console.error("Approve error:", e);
    res.status(500).json({ error: "Failed to apply change" });
  }
});

app.post("/api/pending/approve-all", requireAuth, (req, res) => {
  try {
    const { approved, errors } = db.transaction(() => {
      const pending = readJSON("pending.json", []) || [];
      const toApprove = pending.filter(p => p.status === "pending");
      const ctx = loadCtx();
      const errs = [];
      let ok = 0;
      for (const item of toApprove) {
        try {
          applyPending(item, ctx);
          item.status = "approved";
          item.approvedAt = new Date().toISOString();
          ok++;
        } catch (e) {
          console.error("Approve-all error on", item.id, e);
          errs.push(item.id);
        }
      }
      persistCtx(ctx);
      writeJSON("pending.json", pending);
      return { approved: ok, errors: errs };
    })();
    res.json({ approved, errors });
  } catch (e) {
    console.error("Approve-all error:", e);
    res.status(500).json({ error: "Failed to apply changes" });
  }
});

app.post("/api/pending/:id/reject", requireAuth, (req, res) => {
  const pending = readJSON("pending.json", []);
  const item = pending.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  item.status = "rejected";
  item.rejectedAt = new Date().toISOString();
  writeJSON("pending.json", pending);
  res.json(pending.filter(p => p.status === "pending"));
});

// ─── WebAuthn ─────────────────────────────────────────────────────────────────

// First-run: validate credentials + generate passkey registration challenge
app.post("/api/webauthn/register/start", authLimiter, async (req, res) => {
  try {
    const creds = readJSON("credentials.json", null);
    if (creds) return res.status(403).json({ error: "Already configured" });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing fields" });
    if (password.length < 6) return res.status(400).json({ error: "Password too short" });
    const salt = crypto.randomBytes(32).toString("hex");
    const hash = await hashPassword(password, salt);
    const { generateRegistrationOptions } = await getWebAuthn();
    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN_RP_NAME,
      rpID: WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(username.trim()),
      userName: username.trim(),
      attestationType: "none",
      authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
    });
    writeJSON("setup_state.json", { username: username.trim(), hash, salt, challenge: options.challenge, createdAt: Date.now() });
    res.json(options);
  } catch (e) {
    console.error("WebAuthn register/start error:", e);
    res.status(500).json({ error: "Registration start failed" });
  }
});

// First-run: verify passkey ceremony, save credentials + passkey atomically
app.post("/api/webauthn/register/finish", authLimiter, async (req, res) => {
  try {
    const creds = readJSON("credentials.json", null);
    if (creds) return res.status(403).json({ error: "Already configured" });
    const state = readJSON("setup_state.json", null);
    if (!state || Date.now() - state.createdAt > 10 * 60 * 1000) {
      return res.status(400).json({ error: "Registration session expired" });
    }
    const { verifyRegistrationResponse } = await getWebAuthn();
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: state.challenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: WEBAUTHN_RP_ID,
    });
    if (!verification.verified) return res.status(400).json({ error: "Verification failed" });
    const { credential } = verification.registrationInfo;
    db.transaction(() => {
      writeJSON("credentials.json", { username: state.username, hash: state.hash, salt: state.salt, totpSecret: "" });
      writeJSON("setup_state.json", null);
      writePasskeyCredential({
        credentialId: credential.id,
        publicKey:    Buffer.from(credential.publicKey).toString("base64"),
        counter:      credential.counter,
        deviceName:   req.body.deviceName || "Device 1",
        createdAt:    new Date().toISOString(),
      });
    })();
    res.json({ ok: true });
  } catch (e) {
    console.error("WebAuthn register/finish error:", e);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Add a new device (requires existing auth)
app.post("/api/webauthn/add-device/start", requireAuth, async (req, res) => {
  try {
    const creds    = readJSON("credentials.json", null);
    const existing = readJSON("passkey_credentials.json", []);
    const { generateRegistrationOptions } = await getWebAuthn();
    const options = await generateRegistrationOptions({
      rpName: WEBAUTHN_RP_NAME,
      rpID: WEBAUTHN_RP_ID,
      userID: new TextEncoder().encode(creds.username),
      userName: creds.username,
      attestationType: "none",
      excludeCredentials: existing.map(p => ({ id: p.credentialId, type: "public-key" })),
      authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
    });
    writeJSON("webauthn_challenge.json", { challenge: options.challenge, createdAt: Date.now() });
    res.json(options);
  } catch (e) {
    console.error("WebAuthn add-device/start error:", e);
    res.status(500).json({ error: "Failed to start" });
  }
});

app.post("/api/webauthn/add-device/finish", requireAuth, async (req, res) => {
  try {
    const state = readJSON("webauthn_challenge.json", null);
    if (!state || Date.now() - state.createdAt > 10 * 60 * 1000) {
      return res.status(400).json({ error: "Session expired" });
    }
    const { verifyRegistrationResponse } = await getWebAuthn();
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: state.challenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: WEBAUTHN_RP_ID,
    });
    if (!verification.verified) return res.status(400).json({ error: "Verification failed" });
    const { credential } = verification.registrationInfo;
    const existing = readJSON("passkey_credentials.json", []);
    writePasskeyCredential({
      credentialId: credential.id,
      publicKey:    Buffer.from(credential.publicKey).toString("base64"),
      counter:      credential.counter,
      deviceName:   req.body.deviceName || `Device ${existing.length + 1}`,
      createdAt:    new Date().toISOString(),
    });
    writeJSON("webauthn_challenge.json", null);
    res.json({ ok: true });
  } catch (e) {
    console.error("WebAuthn add-device/finish error:", e);
    res.status(500).json({ error: "Failed to register device" });
  }
});

// Login: generate authentication challenge
app.post("/api/webauthn/login/start", authLimiter, async (req, res) => {
  try {
    const passkeys = readJSON("passkey_credentials.json", []);
    if (passkeys.length === 0) return res.status(400).json({ error: "No passkeys registered" });
    const { generateAuthenticationOptions } = await getWebAuthn();
    const options = await generateAuthenticationOptions({
      rpID: WEBAUTHN_RP_ID,
      allowCredentials: passkeys.map(p => ({ id: p.credentialId, type: "public-key" })),
      userVerification: "preferred",
    });
    writeJSON("webauthn_challenge.json", { challenge: options.challenge, createdAt: Date.now() });
    res.json(options);
  } catch (e) {
    console.error("WebAuthn login/start error:", e);
    res.status(500).json({ error: "Login start failed" });
  }
});

// Login: verify assertion, issue tokens
app.post("/api/webauthn/login/finish", authLimiter, async (req, res) => {
  try {
    const state = readJSON("webauthn_challenge.json", null);
    if (!state || Date.now() - state.createdAt > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Authentication session expired" });
    }
    const passkeys = readJSON("passkey_credentials.json", []);
    const passkey  = passkeys.find(p => p.credentialId === req.body.id);
    if (!passkey) return res.status(400).json({ error: "Unknown credential" });
    const { verifyAuthenticationResponse } = await getWebAuthn();
    const verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: state.challenge,
      expectedOrigin: getOrigin(req),
      expectedRPID: WEBAUTHN_RP_ID,
      credential: {
        id:        passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, "base64"),
        counter:   passkey.counter,
      },
    });
    if (!verification.verified) return res.status(401).json({ error: "Authentication failed" });
    writePasskeyCredential({ ...passkey, counter: verification.authenticationInfo.newCounter });
    writeJSON("webauthn_challenge.json", null);
    const creds = readJSON("credentials.json", null);
    const accessToken  = signAccess(creds.username);
    const refreshToken = crypto.randomBytes(48).toString("hex");
    saveRefreshToken(refreshToken);
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true, secure: IS_PROD, sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000, path: "/",
    });
    res.json({ accessToken });
  } catch (e) {
    console.error("WebAuthn login/finish error:", e);
    res.status(401).json({ error: "Authentication failed" });
  }
});

// List passkeys (settings)
app.get("/api/webauthn/credentials", requireAuth, (req, res) => {
  const passkeys = readJSON("passkey_credentials.json", []);
  res.json(passkeys.map(p => ({ credentialId: p.credentialId, deviceName: p.deviceName, createdAt: p.createdAt })));
});

// Remove a passkey (settings) — at least one must remain
app.delete("/api/webauthn/credentials/:id", requireAuth, (req, res) => {
  const passkeys = readJSON("passkey_credentials.json", []);
  if (passkeys.length <= 1) {
    return res.status(400).json({ error: "Cannot remove last passkey — register another device first" });
  }
  deletePasskeyCredential(decodeURIComponent(req.params.id));
  res.json({ ok: true });
});

// ─── MCP server ───────────────────────────────────────────────────────────────
// The MCP_TOKEN is embedded in the URL path — it IS the credential.
// Without the correct token, the route simply doesn't exist (404).
function mcpPath(sub = "") { return MCP_TOKEN ? `/mcp/${MCP_TOKEN}${sub}` : `/mcp${sub}`; }

// CORS preflight for /mcp — Claude.ai connects cross-origin
app.options(mcpPath(), (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.sendStatus(204);
});
app.use(mcpPath(), (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  next();
});
app.use(mcpPath(), createMcpRouter({ readJSON, writeJSON }));

// ─── SPA fallback (never matches /api or /mcp) ───────────────────────────────
app.get(/^(?!\/(api|mcp))/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Game Backlog running on http://localhost:${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}${mcpPath()}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

module.exports = { app, computeTOTP, hashPassword, verifyTOTP, generateSecret };
