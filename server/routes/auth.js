"use strict";

const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const QRCode  = require("qrcode");
const express = require("express");
const rateLimit = require("express-rate-limit");
const router  = express.Router();

const {
  JWT_SECRET, hashPassword, verifyTOTP, generateSecret,
  generateRecoveryCodes, signAccess,
} = require("../lib/crypto");
const { generateCsrfToken, doubleCsrfProtection } = require("../middleware/csrf");
const requireAuth = require("../middleware/requireAuth");
const {
  readCredentials, writeCredentials,
  readRefreshTokens, writeRefreshTokens,
  readPendingSetup, writePendingSetup,
  readPasskeyCredentials, writePasskeyCredential, deletePasskeyCredential,
  readWebAuthnChallenge, writeWebAuthnChallenge,
  readSetupState, writeSetupState,
  db,
} = require("../db");

const IS_PROD          = process.env.NODE_ENV === "production";
const WEBAUTHN_RP_ID   = process.env.WEBAUTHN_RP_ID   || "localhost";
const WEBAUTHN_RP_NAME = process.env.WEBAUTHN_RP_NAME || "Game Backlog";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many attempts, try again in 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
});

// Lazy-loaded because @simplewebauthn/server is ESM-only
let _webauthn = null;
async function getWebAuthn() {
  if (!_webauthn) _webauthn = await import("@simplewebauthn/server");
  return _webauthn;
}

function getOrigin(req) {
  return req.headers.origin || `${req.protocol}://${req.get("host")}`;
}

// ─── Refresh token helpers ────────────────────────────────────────────────────

function saveRefreshToken(token) {
  const tokens = readRefreshTokens();
  tokens[token] = Date.now() + 30 * 24 * 60 * 60 * 1000;
  for (const [k, exp] of Object.entries(tokens)) {
    if (exp < Date.now()) delete tokens[k];
  }
  writeRefreshTokens(tokens);
}

function validateRefreshToken(token) {
  const tokens = readRefreshTokens();
  return tokens[token] && tokens[token] > Date.now();
}

function revokeRefreshToken(token) {
  const tokens = readRefreshTokens();
  delete tokens[token];
  writeRefreshTokens(tokens);
}

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

// Returns true and removes the matching hash if a code matches; false otherwise.
async function consumeRecoveryCode(creds, code) {
  const c = (code || "").trim().toLowerCase();
  if (!c) return false;
  const candidate = await hashPassword(c, creds.salt);
  const idx = (creds.recoveryCodes || []).findIndex(h => h === candidate);
  if (idx === -1) return false;
  const remaining = [...creds.recoveryCodes];
  remaining.splice(idx, 1);
  writeCredentials({ ...creds, recoveryCodes: remaining });
  return true;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

router.get("/setup/status", (req, res) => {
  const creds    = readCredentials();
  const passkeys = readPasskeyCredentials();
  res.json({ configured: !!creds, hasPasskeys: passkeys.length > 0 });
});

router.get("/setup/secret", async (req, res) => {
  const creds = readCredentials();
  if (creds) return res.status(403).json({ error: "Already configured" });
  const secret = generateSecret();
  writePendingSetup({ secret, createdAt: Date.now() });
  const uri = `otpauth://totp/GameBacklog:setup?secret=${secret}&issuer=GameBacklog`;
  const qrDataUrl = await QRCode.toDataURL(uri);
  res.json({ secret, formatted: secret.match(/.{1,4}/g).join(" "), qrDataUrl });
});

router.post("/setup", authLimiter, async (req, res) => {
  try {
    const creds = readCredentials();
    if (creds) return res.status(403).json({ error: "Already configured" });
    const { username, password, totpCode } = req.body;
    if (!username || !password || !totpCode) return res.status(400).json({ error: "Missing fields" });
    if (password.length < 6) return res.status(400).json({ error: "Password too short" });
    const pending = readPendingSetup();
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) {
      return res.status(400).json({ error: "Setup session expired, refresh the page" });
    }
    if (!verifyTOTP(pending.secret, totpCode)) {
      return res.status(400).json({ error: "Invalid TOTP code" });
    }
    const salt = crypto.randomBytes(32).toString("hex");
    const hash = await hashPassword(password, salt);
    const { plain, hashes } = await generateRecoveryCodes(salt);
    writeCredentials({
      username: username.trim(), hash, salt,
      totpSecret: pending.secret,
      recoveryCodes: hashes,
    });
    writePendingSetup(null);
    res.json({ ok: true, recoveryCodes: plain });
  } catch (e) {
    console.error("Setup error:", e);
    res.status(500).json({ error: "Setup failed" });
  }
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

router.post("/auth/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const creds = readCredentials();
    if (!creds) return res.status(400).json({ error: "Not configured" });
    if (creds.username !== username?.trim()) {
      await hashPassword(password || "", creds.salt); // prevent timing attack
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const hash = await hashPassword(password || "", creds.salt);
    if (hash !== creds.hash) return res.status(401).json({ error: "Invalid credentials" });
    const mfaToken = jwt.sign({ sub: username, mfaPending: true }, JWT_SECRET, { expiresIn: "5m" });
    res.json({ mfaToken });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/auth/mfa", authLimiter, (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const payload = jwt.verify(mfaToken, JWT_SECRET);
    if (!payload.mfaPending) return res.status(401).json({ error: "Invalid token" });
    const creds = readCredentials();
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

router.post("/auth/recovery", authLimiter, async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    const payload = jwt.verify(mfaToken, JWT_SECRET);
    if (!payload.mfaPending) return res.status(401).json({ error: "Invalid token" });
    const creds = readCredentials();
    if (!creds || !creds.recoveryCodes?.length) {
      return res.status(401).json({ error: "No recovery codes available — set them up in Settings after logging in" });
    }
    const ok = await consumeRecoveryCode(creds, code);
    if (!ok) return res.status(401).json({ error: "Invalid recovery code" });
    const remaining = readCredentials().recoveryCodes.length;
    const accessToken = issueSession(res, payload.sub);
    const csrfToken = generateCsrfToken(req, res);
    res.json({ accessToken, csrfToken, remaining });
  } catch (e) {
    res.status(401).json({ error: "Recovery failed" });
  }
});

router.post("/auth/recovery-codes/regenerate", requireAuth, async (req, res) => {
  const creds = readCredentials();
  if (!creds) return res.status(400).json({ error: "Not configured" });
  const { plain, hashes } = await generateRecoveryCodes(creds.salt);
  writeCredentials({ ...creds, recoveryCodes: hashes });
  res.json({ recoveryCodes: plain });
});

router.get("/auth/recovery-codes/count", requireAuth, (req, res) => {
  const creds = readCredentials();
  res.json({ remaining: creds?.recoveryCodes?.length ?? 0 });
});

router.get("/auth/csrf", (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
});

router.post("/auth/refresh", doubleCsrfProtection, (req, res) => {
  const rt = req.cookies?.refreshToken;
  if (!rt || !validateRefreshToken(rt)) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
  const creds = readCredentials();
  if (!creds) return res.status(401).json({ error: "Not configured" });
  const accessToken = signAccess(creds.username);
  res.json({ accessToken });
});

router.post("/auth/logout", doubleCsrfProtection, (req, res) => {
  const rt = req.cookies?.refreshToken;
  if (rt) revokeRefreshToken(rt);
  res.clearCookie("refreshToken", { path: "/" });
  res.json({ ok: true });
});

router.post("/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "New password too short" });
    const creds = readCredentials();
    const hash = await hashPassword(currentPassword || "", creds.salt);
    if (hash !== creds.hash) return res.status(401).json({ error: "Current password incorrect" });
    const salt = crypto.randomBytes(32).toString("hex");
    const newHash = await hashPassword(newPassword, salt);
    const { plain, hashes } = await generateRecoveryCodes(salt);
    writeCredentials({ ...creds, hash: newHash, salt, recoveryCodes: hashes });
    writeRefreshTokens({});
    res.clearCookie("refreshToken", { path: "/" });
    res.json({ ok: true, recoveryCodes: plain });
  } catch (e) {
    res.status(500).json({ error: "Password change failed" });
  }
});

// ─── WebAuthn ─────────────────────────────────────────────────────────────────

router.post("/webauthn/register/start", authLimiter, async (req, res) => {
  try {
    const creds = readCredentials();
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
    writeSetupState({ username: username.trim(), hash, salt, challenge: options.challenge, createdAt: Date.now() });
    res.json(options);
  } catch (e) {
    console.error("WebAuthn register/start error:", e);
    res.status(500).json({ error: "Registration start failed" });
  }
});

router.post("/webauthn/register/finish", authLimiter, async (req, res) => {
  try {
    const creds = readCredentials();
    if (creds) return res.status(403).json({ error: "Already configured" });
    const state = readSetupState();
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
      writeCredentials({ username: state.username, hash: state.hash, salt: state.salt, totpSecret: "" });
      writeSetupState(null);
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

router.post("/webauthn/add-device/start", requireAuth, async (req, res) => {
  try {
    const creds    = readCredentials();
    const existing = readPasskeyCredentials();
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
    writeWebAuthnChallenge({ challenge: options.challenge, createdAt: Date.now() });
    res.json(options);
  } catch (e) {
    console.error("WebAuthn add-device/start error:", e);
    res.status(500).json({ error: "Failed to start" });
  }
});

router.post("/webauthn/add-device/finish", requireAuth, async (req, res) => {
  try {
    const state = readWebAuthnChallenge();
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
    const existing = readPasskeyCredentials();
    writePasskeyCredential({
      credentialId: credential.id,
      publicKey:    Buffer.from(credential.publicKey).toString("base64"),
      counter:      credential.counter,
      deviceName:   req.body.deviceName || `Device ${existing.length + 1}`,
      createdAt:    new Date().toISOString(),
    });
    writeWebAuthnChallenge(null);
    res.json({ ok: true });
  } catch (e) {
    console.error("WebAuthn add-device/finish error:", e);
    res.status(500).json({ error: "Failed to register device" });
  }
});

router.post("/webauthn/login/start", authLimiter, async (req, res) => {
  try {
    const passkeys = readPasskeyCredentials();
    if (passkeys.length === 0) return res.status(400).json({ error: "No passkeys registered" });
    const { generateAuthenticationOptions } = await getWebAuthn();
    const options = await generateAuthenticationOptions({
      rpID: WEBAUTHN_RP_ID,
      allowCredentials: passkeys.map(p => ({ id: p.credentialId, type: "public-key" })),
      userVerification: "preferred",
    });
    writeWebAuthnChallenge({ challenge: options.challenge, createdAt: Date.now() });
    res.json(options);
  } catch (e) {
    console.error("WebAuthn login/start error:", e);
    res.status(500).json({ error: "Login start failed" });
  }
});

router.post("/webauthn/login/finish", authLimiter, async (req, res) => {
  try {
    const state = readWebAuthnChallenge();
    if (!state || Date.now() - state.createdAt > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Authentication session expired" });
    }
    const passkeys = readPasskeyCredentials();
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
    writeWebAuthnChallenge(null);
    const creds = readCredentials();
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

router.get("/webauthn/credentials", requireAuth, (req, res) => {
  const passkeys = readPasskeyCredentials();
  res.json(passkeys.map(p => ({ credentialId: p.credentialId, deviceName: p.deviceName, createdAt: p.createdAt })));
});

router.delete("/webauthn/credentials/:id", requireAuth, (req, res) => {
  const passkeys = readPasskeyCredentials();
  if (passkeys.length <= 1) {
    return res.status(400).json({ error: "Cannot remove last passkey — register another device first" });
  }
  deletePasskeyCredential(decodeURIComponent(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
