"use strict";

const os   = require("os");
const path = require("path");

module.exports = {
  PORT:            4321,
  DATA_DIR:        path.join(os.tmpdir(), "gamebacklog-e2e"),
  AUTH_STATE_FILE: path.join(__dirname, ".auth-state.json"),

  // Account Manager test service — set via E2E_* env vars (populated by homelab-infra's
  // make test-e2e-gamebacklog, which sources env/test-credentials.env before running).
  ACCOUNT_MANAGER_URL:    process.env.E2E_ACCOUNT_MANAGER_URL    || "http://localhost:3099",
  USERNAME:               process.env.E2E_ADMIN_USERNAME         || "alice",
  PASSWORD:               process.env.E2E_ADMIN_PASSWORD         || "password1234",
  TOTP_SECRET:            process.env.E2E_TOTP_SECRET            || "",

  OAUTH_CLIENT_ID:        "gamebacklog-web",
  OAUTH_CLIENT_SECRET:    process.env.E2E_GAMEBACKLOG_CLIENT_SECRET || "test-gamebacklog-secret",
  OAUTH_REDIRECT_URI:     "http://localhost:4321/auth/callback",
};
