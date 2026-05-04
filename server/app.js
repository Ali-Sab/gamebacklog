"use strict";

// ─── Load env ───────────────────────────────────────────────────────────────
const path = require("path");
// dotenv is no-overwrite by default — tests can still inject env vars before require
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express      = require("express");
const cookieParser = require("cookie-parser");
const { createMcpRouter } = require("./mcp-server");
const { computeTOTP, hashPassword, verifyTOTP, generateSecret } = require("./lib/crypto");

const app  = express();
app.set("trust proxy", 1); // trust first proxy (Nginx / Tailscale Funnel)
const MCP_TOKEN    = process.env.MCP_TOKEN || "";
const SERVE_STATIC = process.env.NODE_ENV !== "development";

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

if (SERVE_STATIC) {
  app.use(express.static(path.join(__dirname, "..", "dist")));
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/games"));
app.use("/api", require("./routes/pending"));
app.use("/api", require("./routes/data"));

// ─── MCP server ───────────────────────────────────────────────────────────────
function mcpPath(sub = "") { return MCP_TOKEN ? `/mcp/${MCP_TOKEN}${sub}` : `/mcp${sub}`; }

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
app.use(mcpPath(), createMcpRouter());

// ─── SPA fallback (never matches /api or /mcp) ───────────────────────────────
if (SERVE_STATIC) {
  app.get(/^(?!\/(api|mcp))/, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
  });
}

module.exports = { app, mcpPath, computeTOTP, hashPassword, verifyTOTP, generateSecret };
