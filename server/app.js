"use strict";

// ─── Load env ───────────────────────────────────────────────────────────────
const path = require("path");
// dotenv is no-overwrite by default — tests can still inject env vars before require
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express      = require("express");
const cookieParser = require("cookie-parser");
const { createMcpRouter } = require("./mcp-server");

const app  = express();
app.set("trust proxy", 1); // trust first proxy (Nginx / Tailscale Funnel)
const SERVE_STATIC = process.env.NODE_ENV !== "development";

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const BASE_PATH = "/gamebacklog";

if (SERVE_STATIC) {
  // Serve at both paths: /gamebacklog/... for direct access, / for when nginx strips the prefix
  app.use(BASE_PATH, express.static(path.join(__dirname, "..", "dist")));
  app.use("/", express.static(path.join(__dirname, "..", "dist")));
}

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

// ─── Auth flow routes (login redirect + OAuth callback, at root paths) ───────
const authRouter = require("./routes/auth");
app.use("/", authRouter);
app.use(`${BASE_PATH}`, authRouter);

// ─── API routes ───────────────────────────────────────────────────────────────
// Mounted at both paths: /api (nginx-stripped) and /gamebacklog/api (direct access)
for (const prefix of ["/api", `${BASE_PATH}/api`]) {
  app.use(prefix, authRouter);
  app.use(prefix, require("./routes/games"));
  app.use(prefix, require("./routes/pending"));
  app.use(prefix, require("./routes/data"));
}

// ─── MCP server ───────────────────────────────────────────────────────────────
// RFC 9728 protected-resource metadata. MCP clients fetch this (its URL is
// advertised in the WWW-Authenticate header on a 401 from /mcp, see
// requireMcpToken in mcp-server.js) to learn which authorization server to
// use before starting the OAuth flow.
app.get("/.well-known/oauth-protected-resource/mcp", (req, res) => {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"]  || req.get("host");
  const accountManagerUrl = process.env.ACCOUNT_MANAGER_URL || "http://localhost:3001";
  res.setHeader("Cache-Control", "no-store");
  res.json({
    resource: `${proto}://${host}/mcp`,
    authorization_servers: [accountManagerUrl],
  });
});

app.options("/mcp", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.sendStatus(204);
});
app.use("/mcp", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  next();
});
app.use("/mcp", createMcpRouter());

// ─── SPA fallback ────────────────────────────────────────────────────────────
if (SERVE_STATIC) {
  app.get(new RegExp(`^(${BASE_PATH})?(/(?!(api|mcp)).*)?$`), (req, res) => {
    res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
  });
}

module.exports = { app };
