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
const { generateSync: _otpGenerate, verifySync: _otpVerify, generateSecret: _otpSecret } = require("otplib");
const { doubleCsrf }    = require("csrf-csrf");
const { createMcpRouter } = require("./mcp-server");
const { db, readJSON, writeJSON, findGameById, insertGame, updateGame, deleteGameById } = require("./db");
const { apply: applyPending } = require("./pendingTypes");


const app  = express();
app.set("trust proxy", 1); // trust first proxy (Nginx / Tailscale Funnel)
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const MCP_TOKEN  = process.env.MCP_TOKEN  || "";
const IS_PROD  = process.env.NODE_ENV === "production";


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

// Rate limiting on auth endpoints (disabled in test to avoid hitting 20-req limit)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
});

// CSRF (double-submit cookie). Cookie-auth routes verify X-CSRF-Token matches
// the csrf cookie. Bearer-auth routes don't need it — the token isn't sent by the
// browser automatically. Test runs skip the check to keep fixtures simple.
const CSRF_SECRET = process.env.CSRF_SECRET || JWT_SECRET + ":csrf";
const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: () => "default", // single-user app
  cookieName: IS_PROD ? "__Host-csrf" : "csrf",
  cookieOptions: { sameSite: "strict", secure: IS_PROD, httpOnly: false, path: "/" },
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  skipCsrfProtection: () => process.env.NODE_ENV === "test",
});

// ─── Crypto helpers ──────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return new Promise((res, rej) =>
    crypto.pbkdf2(password, salt, 310000, 64, "sha512",
      (err, key) => err ? rej(err) : res(key.toString("hex")))
  );
}

// TOTP via otplib (RFC 6238). 30s step, ±1 window for clock drift.
function computeTOTP(secret, offset = 0) {
  const epoch = Math.floor(Date.now() / 1000) + offset * 30;
  return _otpGenerate({ secret, epoch });
}

function verifyTOTP(secret, code) {
  const c = (code || "").replace(/\s/g, "");
  if (c.length !== 6) return false;
  return _otpVerify({ secret, token: c, epochTolerance: 30 }).valid;
}

function generateSecret() {
  return _otpSecret(20); // 20 bytes → 32-char base32
}

// ── Recovery codes ───────────────────────────────────────────────────────────
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

// Returns true and removes the matching hash if a code matches; false otherwise.
async function consumeRecoveryCode(creds, code) {
  const c = (code || "").trim().toLowerCase();
  if (!c) return false;
  const candidate = await hashPassword(c, creds.salt);
  const idx = (creds.recoveryCodes || []).findIndex(h => h === candidate);
  if (idx === -1) return false;
  const remaining = [...creds.recoveryCodes];
  remaining.splice(idx, 1);
  writeJSON("credentials.json", { ...creds, recoveryCodes: remaining });
  return true;
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
  const creds = readJSON("credentials.json", null);
  res.json({ configured: !!creds });
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

// Complete setup. Returns recovery codes ONCE — the user must save them.
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
    const { plain, hashes } = await generateRecoveryCodes(salt);
    writeJSON("credentials.json", {
      username: username.trim(), hash, salt,
      totpSecret: pending.secret,
      recoveryCodes: hashes,
    });
    writeJSON("pending_setup.json", null);
    res.json({ ok: true, recoveryCodes: plain });
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

function issueSession(res, username) {
  const accessToken = signAccess(username);
  const refreshToken = crypto.randomBytes(48).toString("hex");
  saveRefreshToken(refreshToken);
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return accessToken;
}

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
    const accessToken = issueSession(res, payload.sub);
    const csrfToken = generateCsrfToken(req, res);
    res.json({ accessToken, csrfToken });
  } catch (e) {
    res.status(401).json({ error: "MFA failed" });
  }
});

// Alternate step 2: redeem a one-time recovery code instead of TOTP.
// Each code is consumed on use; user is told how many remain.
app.post("/api/auth/recovery", authLimiter, async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const payload = jwt.verify(mfaToken, JWT_SECRET);
    if (!payload.mfaPending) return res.status(401).json({ error: "Invalid token" });
    const creds = readJSON("credentials.json", null);
    if (!creds || !creds.recoveryCodes?.length) {
      return res.status(401).json({ error: "No recovery codes available — set them up in Settings after logging in" });
    }
    const ok = await consumeRecoveryCode(creds, code);
    if (!ok) return res.status(401).json({ error: "Invalid recovery code" });
    const remaining = readJSON("credentials.json", null).recoveryCodes.length;
    const accessToken = issueSession(res, payload.sub);
    const csrfToken = generateCsrfToken(req, res);
    res.json({ accessToken, csrfToken, remaining });
  } catch (e) {
    res.status(401).json({ error: "Recovery failed" });
  }
});

// Regenerate recovery codes (from Settings, requires auth). Invalidates all old codes.
app.post("/api/auth/recovery-codes/regenerate", requireAuth, async (req, res) => {
  const creds = readJSON("credentials.json", null);
  if (!creds) return res.status(400).json({ error: "Not configured" });
  const { plain, hashes } = await generateRecoveryCodes(creds.salt);
  writeJSON("credentials.json", { ...creds, recoveryCodes: hashes });
  res.json({ recoveryCodes: plain });
});

// Number of recovery codes remaining (for the Settings UI to show a warning).
app.get("/api/auth/recovery-codes/count", requireAuth, (req, res) => {
  const creds = readJSON("credentials.json", null);
  res.json({ remaining: creds?.recoveryCodes?.length ?? 0 });
});

// Get a fresh CSRF token (GET — no protection needed, sets the cookie)
app.get("/api/auth/csrf", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});

// Refresh access token using httpOnly cookie
app.post("/api/auth/refresh", doubleCsrfProtection, (req, res) => {
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
app.post("/api/auth/logout", doubleCsrfProtection, (req, res) => {
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
    // Recovery codes are salted with the credential salt — must be regenerated.
    const { plain, hashes } = await generateRecoveryCodes(salt);
    writeJSON("credentials.json", { ...creds, hash: newHash, salt, recoveryCodes: hashes });
    // revoke all refresh tokens
    writeJSON("refresh_tokens.json", {});
    res.clearCookie("refreshToken", { path: "/" });
    res.json({ ok: true, recoveryCodes: plain });
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

// ─── Per-row games API ────────────────────────────────────────────────────────
// Validation helpers shared by POST/PATCH.
const PLATFORMS = ["pc", "ps5"];
const INPUTS    = ["kbm", "ps5-controller", "xbox-controller"];

function validateGameFields(fields, { partial = false } = {}) {
  if (!partial) {
    if (!fields.title || typeof fields.title !== "string" || !fields.title.trim()) {
      return "title is required";
    }
  } else if (fields.title !== undefined && (typeof fields.title !== "string" || !fields.title.trim())) {
    return "title must be a non-empty string";
  }
  if (fields.platform != null && !PLATFORMS.includes(fields.platform)) {
    return `platform must be one of: ${PLATFORMS.join(", ")}`;
  }
  if (fields.input != null && !INPUTS.includes(fields.input)) {
    return `input must be one of: ${INPUTS.join(", ")}`;
  }
  if (fields.url != null && typeof fields.url !== "string") return "url must be a string";
  if (fields.imageUrl != null && typeof fields.imageUrl !== "string") return "imageUrl must be a string";
  return null;
}

function nextRankIn(category) {
  const rows = db.prepare("SELECT MAX(rank) as m FROM games WHERE category = ?").get(category);
  return (rows?.m ?? 0) + 1;
}

// Add a new game (manual user adds). New games always go to the inbox category.
app.post("/api/games", requireAuth, (req, res) => {
  const fields = req.body || {};
  const err = validateGameFields(fields);
  if (err) return res.status(400).json({ error: err });
  const id = "usr-" + crypto.randomBytes(4).toString("hex");
  const game = {
    id,
    title: fields.title.trim(),
    mode:     fields.mode     || null,
    risk:     fields.risk     || null,
    hours:    fields.hours    || null,
    note:     fields.note     || null,
    url:      fields.url      || null,
    platform: fields.platform || null,
    input:    fields.input    || null,
    imageUrl: fields.imageUrl || null,
  };
  insertGame(game, "inbox");
  res.json({ ok: true, game: { ...game, category: "inbox" } });
});

// Patch fields on an existing game. Only the supplied keys are touched.
app.patch("/api/games/:id", requireAuth, (req, res) => {
  const existing = findGameById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const patch = req.body || {};
  const err = validateGameFields(patch, { partial: true });
  if (err) return res.status(400).json({ error: err });
  // Forbid changing category/rank through this endpoint — those go through dedicated paths
  delete patch.category;
  delete patch.rank;
  if (patch.title) patch.title = patch.title.trim();
  updateGame(req.params.id, patch);
  res.json({ ok: true, game: findGameById(req.params.id) });
});

// Move a game to a different category. Always lands at the end (rank = max+1).
app.post("/api/games/:id/move", requireAuth, (req, res) => {
  const existing = findGameById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const { category } = req.body || {};
  if (typeof category !== "string") return res.status(400).json({ error: "category is required" });
  db.transaction(() => {
    updateGame(req.params.id, { category, rank: nextRankIn(category) });
  })();
  res.json({ ok: true, game: findGameById(req.params.id) });
});

// Mark a game as played — moves to the played category and stamps the played date.
app.post("/api/games/:id/played", requireAuth, (req, res) => {
  const existing = findGameById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  db.transaction(() => {
    updateGame(req.params.id, {
      category:   "played",
      rank:       nextRankIn("played"),
      playedDate: new Date().toLocaleDateString(),
    });
  })();
  res.json({ ok: true, game: findGameById(req.params.id) });
});

app.delete("/api/games/:id", requireAuth, (req, res) => {
  const ok = deleteGameById(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
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
  if (profile != null && typeof profile !== "string") {
    return res.status(400).json({ error: "profile must be a string or null" });
  }
  db.transaction(() => {
    writeJSON("games.json", games);
    writeJSON("profile.json", profile ?? "");
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
  if (profile !== undefined && typeof profile !== "string") {
    return res.status(400).json({ error: "profile must be a string" });
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
    profile: readJSON("profile.json", "") || ""
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
