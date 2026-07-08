"use strict";

const express = require("express");
const router  = express.Router();
const { db, readGames, writeGames, readProfile, writeProfile, readPending, writePending } = require("../db");
const requireAuth = require("../middleware/requireAuth");
const { apply: applyPending } = require("../pendingTypes");

function loadCtx(username) {
  return {
    games:   readGames(username)   || {},
    profile: readProfile(username) || []
  };
}

function persistCtx(username, ctx) {
  writeGames(username, ctx.games);
  writeProfile(username, ctx.profile);
}

router.get("/pending/history", requireAuth, (req, res) => {
  res.json(readPending(req.user));
});

router.get("/pending", requireAuth, (req, res) => {
  const pending = readPending(req.user);
  res.json(pending.filter(p => p.status === "pending"));
});

router.post("/pending/:id/approve", requireAuth, (req, res) => {
  try {
    const result = db.transaction(() => {
      const pending = readPending(req.user);
      const item = pending.find(p => p.id === req.params.id);
      if (!item) return { status: 404, error: "Not found" };
      if (item.status !== "pending") return { status: 400, error: "Not pending" };
      const ctx = loadCtx(req.user);
      applyPending(item, ctx);
      persistCtx(req.user, ctx);
      item.status = "approved";
      item.approvedAt = new Date().toISOString();
      writePending(req.user, pending);
      return { status: 200, pending };
    })();
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(result.pending.filter(p => p.status === "pending"));
  } catch (e) {
    console.error("Approve error:", e);
    res.status(500).json({ error: "Failed to apply change" });
  }
});

router.post("/pending/approve-all", requireAuth, (req, res) => {
  try {
    const { approved, errors } = db.transaction(() => {
      const pending = readPending(req.user);
      const toApprove = pending.filter(p => p.status === "pending");
      const ctx = loadCtx(req.user);
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
      persistCtx(req.user, ctx);
      writePending(req.user, pending);
      return { approved: ok, errors: errs };
    })();
    res.json({ approved, errors });
  } catch (e) {
    console.error("Approve-all error:", e);
    res.status(500).json({ error: "Failed to apply changes" });
  }
});

router.post("/pending/:id/reject", requireAuth, (req, res) => {
  const pending = readPending(req.user);
  const item = pending.find(p => p.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  item.status = "rejected";
  item.rejectedAt = new Date().toISOString();
  writePending(req.user, pending);
  res.json(pending.filter(p => p.status === "pending"));
});

module.exports = router;
