"use strict";

const express = require("express");
const router  = express.Router();
const { db, readGames, writeGames, readProfile, writeProfile } = require("../db");
const requireAuth = require("../middleware/requireAuth");

const ACCOUNT_MANAGER_URL  = process.env.ACCOUNT_MANAGER_URL  || "http://localhost:3001";
const OAUTH_CLIENT_ID      = process.env.OAUTH_CLIENT_ID      || process.env.GAMEBACKLOG_CLIENT_ID      || "";
const OAUTH_CLIENT_SECRET  = process.env.OAUTH_CLIENT_SECRET  || process.env.GAMEBACKLOG_CLIENT_SECRET  || "";
const OAUTH_REDIRECT_URI   = process.env.OAUTH_REDIRECT_URI   || process.env.GAMEBACKLOG_REDIRECT_URI   || "";

// MCP connection info for display in settings
router.get("/mcp-url", requireAuth, async (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"]  || req.get("host");

  let mcpClientId = "", mcpClientSecret = "";
  try {
    const r = await fetch(`${ACCOUNT_MANAGER_URL}/api/mcp-client`, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(`${OAUTH_CLIENT_ID}:${OAUTH_CLIENT_SECRET}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ redirect_uri: OAUTH_REDIRECT_URI }),
    });
    if (r.ok) {
      const data = await r.json();
      mcpClientId     = data.client_id     || "";
      mcpClientSecret = data.client_secret || "";
    } else {
      console.error("[mcp-url] /api/mcp-client failed:", r.status, await r.text().catch(() => ""));
    }
  } catch (e) {
    console.error("[mcp-url] /api/mcp-client request error:", e);
  }

  res.json({
    url:               `${proto}://${host}/mcp`,
    clientId:          mcpClientId,
    clientSecret:      mcpClientSecret,
    accountManagerUrl: ACCOUNT_MANAGER_URL,
  });
});

// Current authenticated user's identity
router.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.user });
});

// Get all app data (games + profile)
router.get("/data", requireAuth, (req, res) => {
  const games   = readGames(req.user);
  const profile = readProfile(req.user);
  res.json({ games, profile });
});

// Export — downloads a JSON snapshot of games + profile
router.get("/export", requireAuth, (req, res) => {
  const games   = readGames(req.user);
  const profile = readProfile(req.user);
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="gamebacklog-${ts}.json"`);
  res.send(JSON.stringify({ exportedAt: new Date().toISOString(), games, profile }, null, 2));
});

// Import — replaces all data with the contents of an export file.
router.post("/import", requireAuth, (req, res) => {
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
    writeGames(req.user, games);
    writeProfile(req.user, profile ?? []);
  })();
  res.json({ ok: true });
});

// Save all app data
router.post("/data", requireAuth, (req, res) => {
  const { games, profile } = req.body || {};
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
    if (games   !== undefined) writeGames(req.user, games);
    if (profile !== undefined) writeProfile(req.user, profile);
  })();
  res.json({ ok: true });
});

module.exports = router;
