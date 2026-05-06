"use strict";

const crypto  = require("crypto");
const express = require("express");
const router  = express.Router();

const { verifyAccess } = require("../lib/crypto");
const {
  getOAuthClient, upsertOAuthClient,
  saveOAuthAuthCode, getAndConsumeOAuthAuthCode,
  saveOAuthToken, getOAuthToken,
  saveOAuthRefreshToken, getAndRotateOAuthRefreshToken,
} = require("../db");

// ─── Seed the pre-registered client from env ─────────────────────────────────

const CLIENT_ID     = process.env.OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn("[oauth] OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET not set — OAuth for MCP will not work");
} else {
  const secretHash = crypto.createHash("sha256").update(CLIENT_SECRET).digest("hex");
  upsertOAuthClient({
    clientId:          CLIENT_ID,
    clientSecretHash:  secretHash,
    redirectUris:      ["https://claude.ai/api/mcp/auth_callback"],
    name:              "Claude",
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function getIssuer(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"]  || req.get("host");
  return `${proto}://${host}`;
}

// ─── Authorization Server Metadata ───────────────────────────────────────────

router.get("/.well-known/oauth-authorization-server", (req, res) => {
  const issuer = getIssuer(req);
  res.json({
    issuer,
    authorization_endpoint:            `${issuer}/oauth/authorize`,
    token_endpoint:                    `${issuer}/oauth/token`,
    response_types_supported:          ["code"],
    grant_types_supported:             ["authorization_code", "refresh_token"],
    code_challenge_methods_supported:  ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

// ─── Authorization endpoint ───────────────────────────────────────────────────

router.get("/oauth/authorize", (req, res) => {
  const { client_id, redirect_uri, response_type, state, code_challenge, code_challenge_method } = req.query;

  // Validate required params
  if (response_type !== "code") {
    return res.status(400).send("unsupported_response_type");
  }
  const client = getOAuthClient(client_id);
  if (!client) {
    return res.status(400).send("unknown_client");
  }
  if (!client.redirectUris.includes(redirect_uri)) {
    return res.status(400).send("invalid_redirect_uri");
  }
  if (!code_challenge || code_challenge_method !== "S256") {
    return res.status(400).send("pkce_required");
  }

  // Require the user to be logged in via their existing JWT (cookie or Authorization header)
  const cookieToken = req.cookies?.access_token;
  const bearerToken = (req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const jwtToken = cookieToken || bearerToken;
  const user = jwtToken ? verifyAccess(jwtToken) : null;

  if (!user) {
    // Redirect to login, then back here
    const returnTo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?returnTo=${returnTo}`);
  }

  // Show consent page
  const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize — Game Backlog</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { font-size: 1.3rem; margin-bottom: 0.5rem; }
    p  { color: #555; margin-bottom: 2rem; }
    .actions { display: flex; gap: 12px; }
    button { padding: 10px 24px; border-radius: 6px; border: none; font-size: 1rem; cursor: pointer; }
    .allow  { background: #2563eb; color: #fff; }
    .allow:hover { background: #1d4ed8; }
    .deny   { background: #f3f4f6; color: #374151; }
    .deny:hover { background: #e5e7eb; }
  </style>
</head>
<body>
  <h1>Authorize <strong>${client.name || client_id}</strong>?</h1>
  <p>This will allow <strong>${client.name || client_id}</strong> to access your Game Backlog on your behalf.</p>
  <form method="POST" action="/oauth/authorize" class="actions">
    <input type="hidden" name="client_id"              value="${client_id}">
    <input type="hidden" name="redirect_uri"           value="${encodeURIComponent(redirect_uri)}">
    <input type="hidden" name="code_challenge"         value="${code_challenge}">
    <input type="hidden" name="code_challenge_method"  value="${code_challenge_method}">
    <input type="hidden" name="state"                  value="${state || ""}">
    <button type="submit" name="decision" value="allow" class="allow">Allow</button>
    <button type="submit" name="decision" value="deny"  class="deny">Deny</button>
  </form>
</body>
</html>`);
});

router.post("/oauth/authorize", express.urlencoded({ extended: false }), (req, res) => {
  const { client_id, redirect_uri: encodedRedirectUri, code_challenge, code_challenge_method, state, decision } = req.body;
  const redirect_uri = decodeURIComponent(encodedRedirectUri || "");

  const client = getOAuthClient(client_id);
  if (!client || !client.redirectUris.includes(redirect_uri)) {
    return res.status(400).send("invalid_request");
  }

  const stateParam = state ? `&state=${encodeURIComponent(state)}` : "";

  if (decision !== "allow") {
    return res.redirect(`${redirect_uri}?error=access_denied${stateParam}`);
  }

  // Verify user is still logged in
  const cookieToken = req.cookies?.access_token;
  const bearerToken = (req.headers.authorization || "").startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  const jwtToken = cookieToken || bearerToken;
  const user = jwtToken ? verifyAccess(jwtToken) : null;
  if (!user) {
    return res.redirect(`${redirect_uri}?error=login_required${stateParam}`);
  }

  const code      = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  saveOAuthAuthCode(code, client_id, redirect_uri, code_challenge, code_challenge_method, expiresAt);

  res.redirect(`${redirect_uri}?code=${code}${stateParam}`);
});

// ─── Token endpoint ───────────────────────────────────────────────────────────

router.post("/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
  const { grant_type, client_id, client_secret, code, redirect_uri, code_verifier, refresh_token } = req.body;

  const client = getOAuthClient(client_id);
  if (!client) {
    return res.status(401).json({ error: "invalid_client" });
  }
  if (!timingSafeEqual(sha256(client_secret || ""), client.clientSecretHash)) {
    return res.status(401).json({ error: "invalid_client" });
  }

  if (grant_type === "authorization_code") {
    if (!code || !redirect_uri || !code_verifier) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const record = getAndConsumeOAuthAuthCode(code);
    if (!record || record.clientId !== client_id || record.expiresAt < Date.now()) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    if (record.redirectUri !== redirect_uri) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    // PKCE verification
    const challenge = crypto.createHash("sha256").update(code_verifier).digest("base64url");
    if (challenge !== record.codeChallenge) {
      return res.status(400).json({ error: "invalid_grant" });
    }

    return issueTokens(res, client_id);
  }

  if (grant_type === "refresh_token") {
    if (!refresh_token) {
      return res.status(400).json({ error: "invalid_request" });
    }
    const record = getAndRotateOAuthRefreshToken(sha256(refresh_token));
    if (!record || record.clientId !== client_id) {
      return res.status(400).json({ error: "invalid_grant" });
    }
    return issueTokens(res, client_id);
  }

  return res.status(400).json({ error: "unsupported_grant_type" });
});

function issueTokens(res, clientId) {
  const accessToken  = crypto.randomBytes(32).toString("hex");
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const accessExpiry  = Date.now() + 30 * 24 * 60 * 60 * 1000;  // 30 days
  const refreshExpiry = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year

  saveOAuthToken(sha256(accessToken), clientId, accessExpiry);
  saveOAuthRefreshToken(sha256(refreshToken), clientId, refreshExpiry);

  return res.json({
    access_token:  accessToken,
    token_type:    "bearer",
    expires_in:    30 * 24 * 60 * 60,
    refresh_token: refreshToken,
  });
}

module.exports = router;
