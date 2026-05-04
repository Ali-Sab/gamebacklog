"use strict";

const crypto  = require("crypto");
const express = require("express");
const router  = express.Router();
const { db, findGameById, insertGame, updateGame, deleteGameById } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const { validateGameFields } = require("../lib/validation");

function nextRankIn(category) {
  const rows = db.prepare("SELECT MAX(rank) as m FROM games WHERE category = ?").get(category);
  return (rows?.m ?? 0) + 1;
}

// Add a new game (manual user adds). New games always go to the inbox category.
router.post("/games", requireAuth, (req, res) => {
  const fields = req.body || {};
  const err = validateGameFields(fields);
  if (err) return res.status(400).json({ error: err });
  const id = "usr-" + crypto.randomBytes(4).toString("hex");
  const game = {
    id,
    title:    fields.title.trim(),
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
router.patch("/games/:id", requireAuth, (req, res) => {
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
router.post("/games/:id/move", requireAuth, (req, res) => {
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
router.post("/games/:id/played", requireAuth, (req, res) => {
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

router.delete("/games/:id", requireAuth, (req, res) => {
  const ok = deleteGameById(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

module.exports = router;
