"use strict";

// ─── Load env ───────────────────────────────────────────────────────────────
const fs   = require("fs");
const path = require("path");
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    // Don't overwrite vars already set in the environment (lets tests inject their own values)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const express     = require("express");
const crypto      = require("crypto");
const jwt         = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const rateLimit   = require("express-rate-limit");
const QRCode      = require("qrcode");
const { createMcpRouter } = require("./mcp-server");
const { readJSON, writeJSON } = require("./db");

const app  = express();
app.set("trust proxy", 1); // trust first proxy (Nginx / Tailscale Funnel)
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const MCP_TOKEN  = process.env.MCP_TOKEN  || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
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

// Rate limiting on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Assign a rank to a game being added to a list.
// If a target rank is given, shift existing games to make room.
// If omitted, place at the end.
function assignRank(list, targetRank) {
  if (targetRank == null) {
    const max = list.reduce((m, g) => Math.max(m, g.rank ?? 0), 0);
    return max + 1;
  }
  list.forEach(g => { if ((g.rank ?? Infinity) >= targetRank) g.rank = (g.rank ?? targetRank) + 1; });
  return targetRank;
}

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

// Save all app data
app.post("/api/data", requireAuth, (req, res) => {
  const { games, profile } = req.body;
  if (games)   writeJSON("games.json", games);
  if (profile) writeJSON("profile.json", profile);
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

app.post("/api/pending/:id/approve", requireAuth, (req, res) => {
  const pending = readJSON("pending.json", []);
  const item = pending.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (item.status !== "pending") return res.status(400).json({ error: "Not pending" });
  try {
    if (item.type === "game_move") {
      const { title, fromCategory, toCategory, rank } = item.data;
      const games = readJSON("games.json", {});
      const fromList = games[fromCategory] || [];
      const idx = fromList.findIndex(g => g.title.toLowerCase() === title.toLowerCase());
      if (idx !== -1) {
        const [game] = fromList.splice(idx, 1);
        games[fromCategory] = fromList;
        const toList = games[toCategory] || [];
        game.rank = assignRank(toList, rank);
        games[toCategory] = [...toList, game];
        writeJSON("games.json", games);
      }
    } else if (item.type === "profile_update") {
      const { section, change } = item.data;
      const profile = readJSON("profile.json", "");
      const header = section.toUpperCase();
      // Split into chunks at every all-caps section header
      const sectionRe = /^([A-Z][A-Z\s\/\(\)&+,:'-]+)$/m;
      const parts = profile.split(/(?=^[A-Z][A-Z\s\/\(\)&+,:'-]+$)/m);
      const idx = parts.findIndex(p => p.trimStart().startsWith(header));
      let updated;
      if (idx !== -1) {
        // Replace the body of the existing section, keep the header
        parts[idx] = `${header}\n${change}`;
        updated = parts.join('').trim();
      } else {
        // Section not found — append
        updated = profile.trim() + `\n\n${header}\n${change}`;
      }
      writeJSON("profile.json", updated);
    } else if (item.type === "new_game") {
      const { title, category, mode, risk, hours, note, rank } = item.data;
      const games = readJSON("games.json", {});
      const id = "mcp-" + crypto.randomBytes(4).toString("hex");
      const list = games[category] || [];
      const newRank = assignRank(list, rank);
      games[category] = [...list, { id, title, mode, risk, hours, note, rank: newRank }];
      writeJSON("games.json", games);
    } else if (item.type === "reorder") {
      const { category, rankedTitles } = item.data;
      const games = readJSON("games.json", {});
      const list = games[category] || [];
      // Assign ranks per the proposed order
      rankedTitles.forEach((title, i) => {
        const game = list.find(g => g.title.toLowerCase() === title.toLowerCase());
        if (game) game.rank = i + 1;
      });
      // Games not in the list sink to the bottom, preserving relative order
      const included = new Set(rankedTitles.map(t => t.toLowerCase()));
      const unranked = list.filter(g => !included.has(g.title.toLowerCase()))
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
      unranked.forEach((g, i) => { g.rank = rankedTitles.length + i + 1; });
      games[category] = list;
      writeJSON("games.json", games);
    }
  } catch (e) {
    console.error("Approve error:", e);
    return res.status(500).json({ error: "Failed to apply change" });
  }
  item.status = "approved";
  item.approvedAt = new Date().toISOString();
  writeJSON("pending.json", pending);
  res.json(pending.filter(p => p.status === "pending"));
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
