"use strict";

const crypto  = require("crypto");
const express = require("express");
const router  = express.Router();

const ACCOUNT_MANAGER_URL   = process.env.ACCOUNT_MANAGER_URL || "http://localhost:3001";
const ACCOUNT_MANAGER_TOKEN = `${ACCOUNT_MANAGER_URL}/token`;
// Accept OAUTH_* (infra convention) with GAMEBACKLOG_* as fallback (dev .env legacy)
const CLIENT_ID     = process.env.OAUTH_CLIENT_ID     || process.env.GAMEBACKLOG_CLIENT_ID     || "";
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || process.env.GAMEBACKLOG_CLIENT_SECRET || "";
const REDIRECT_URI  = process.env.OAUTH_REDIRECT_URI  || process.env.GAMEBACKLOG_REDIRECT_URI  || "http://localhost:3010/auth/callback";

// Derive our own login URL from REDIRECT_URI (same origin, /auth/login path).
let POST_LOGOUT_REDIRECT_URI = "http://localhost:3010/auth/login";
try {
  const u = new URL(REDIRECT_URI);
  POST_LOGOUT_REDIRECT_URI = `${u.origin}/auth/login`;
} catch { /* keep default */ }

// Fetch end_session_endpoint from account-manager's discovery document at startup.
// Falls back to the conventional path if discovery is unavailable.
let endSessionEndpoint = `${ACCOUNT_MANAGER_URL}/logout`;
fetch(`${ACCOUNT_MANAGER_URL}/.well-known/oauth-authorization-server`)
  .then(r => r.json())
  .then(data => {
    if (data.end_session_endpoint) {
      // Rewrite hostname/port to match ACCOUNT_MANAGER_URL so the browser can reach it.
      // The discovery doc may return a Docker-internal host (e.g. account-manager-test:3001)
      // while the browser needs the host-visible URL (e.g. localhost:3099).
      try {
        const discovered = new URL(data.end_session_endpoint);
        const amBase     = new URL(ACCOUNT_MANAGER_URL);
        discovered.protocol = amBase.protocol;
        discovered.hostname  = amBase.hostname;
        discovered.port      = amBase.port;
        endSessionEndpoint = discovered.toString();
      } catch {
        endSessionEndpoint = data.end_session_endpoint;
      }
    }
  })
  .catch(() => { /* keep fallback */ });

const IS_PROD = process.env.NODE_ENV === "production";

// ─── /auth/login — start PKCE flow, redirect to account-manager ──────────────

router.get("/auth/login", (req, res) => {
  const verifier  = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state     = crypto.randomBytes(16).toString("hex");

  // Persist verifier + state in a short-lived httpOnly cookie
  const pkce = JSON.stringify({ verifier, state });
  res.cookie("pkce", pkce, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: "lax",  // must survive the cross-origin redirect
    maxAge:   5 * 60 * 1000,
    path:     "/",
  });

  const params = new URLSearchParams({
    response_type:         "code",
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    code_challenge:        challenge,
    code_challenge_method: "S256",
    state,
  });

  res.redirect(`${ACCOUNT_MANAGER_URL}/authorize?${params}`);
});

// ─── /auth/callback — receive code from account-manager, exchange for token ──

router.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect("/?auth_error=" + encodeURIComponent(String(error)));

  let pkce;
  try {
    pkce = JSON.parse(req.cookies?.pkce || "{}");
  } catch {
    return res.redirect("/?auth_error=invalid_pkce");
  }

  res.clearCookie("pkce", { path: "/" });

  if (!pkce.state || pkce.state !== state) {
    return res.redirect("/?auth_error=state_mismatch");
  }

  if (!code || !pkce.verifier) return res.redirect("/?auth_error=missing_params");

  try {
    const tokenRes = await fetch(ACCOUNT_MANAGER_TOKEN, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type:    "authorization_code",
        code:          String(code),
        redirect_uri:  REDIRECT_URI,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: pkce.verifier,
      }),
    });

    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      console.error("[auth/callback] token exchange failed:", tokenRes.status, data);
      return res.redirect("/?auth_error=token_exchange_failed");
    }

    // Store the RS256 access token in an httpOnly cookie on the game backlog domain.
    // When it expires the React app gets a 401 and redirects back here.
    res.cookie("accessToken", data.access_token, {
      httpOnly: true,
      secure:   IS_PROD,
      sameSite: "strict",
      maxAge:   60 * 60 * 1000, // mirrors the 1h JWT expiry
      path:     "/",
    });

    // Redirect to the app root, derived from REDIRECT_URI so it works whether
    // the app is served at / or under a subpath like /gamebacklog/.
    let home = "/";
    try {
      const u = new URL(REDIRECT_URI);
      home = u.pathname.replace(/\/auth\/callback$/, "/") || "/";
    } catch { /* use "/" */ }
    res.redirect(home);
  } catch (e) {
    console.error("[auth/callback] token exchange error:", e);
    res.redirect("/?auth_error=server_error");
  }
});

// ─── /api/auth/session — return the access token from cookie to the React SPA ─

router.get("/auth/session", (req, res) => {
  const token = req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: "No session" });
  res.json({ accessToken: token });
});

// ─── /api/auth/logout — clear the access token cookie ────────────────────────

router.post("/auth/logout", (req, res) => {
  res.clearCookie("accessToken", { path: "/" });
  const params = new URLSearchParams({ post_logout_redirect_uri: POST_LOGOUT_REDIRECT_URI });
  res.json({ ok: true, endSessionUrl: `${endSessionEndpoint}?${params}` });
});

module.exports = router;
