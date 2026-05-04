"use strict";

const express = require("express");
const router  = express.Router();
const { db, readGames, writeGames, readProfile, writeProfile } = require("../db");
const requireAuth = require("../middleware/requireAuth");

// Get all app data (games + profile)
router.get("/data", requireAuth, (req, res) => {
  const games   = readGames();
  const profile = readProfile();
  res.json({ games, profile });
});

// Export — downloads a JSON snapshot of games + profile
router.get("/export", requireAuth, (req, res) => {
  const games   = readGames();
  const profile = readProfile();
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
    writeGames(games);
    writeProfile(profile ?? []);
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
    if (games   !== undefined) writeGames(games);
    if (profile !== undefined) writeProfile(profile);
  })();
  res.json({ ok: true });
});

module.exports = router;
