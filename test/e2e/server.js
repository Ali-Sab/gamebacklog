"use strict";

// E2E test server — sets env vars before requiring server.js
const fs = require("fs");
const {
  PORT, DATA_DIR,
  ACCOUNT_MANAGER_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI,
} = require("./constants");

// Clean slate for game data (auth lives in account-manager, not here)
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.PORT                = String(PORT);
process.env.DATA_DIR            = DATA_DIR;
process.env.NODE_ENV            = "test";
process.env.ACCOUNT_MANAGER_URL = ACCOUNT_MANAGER_URL;
process.env.OAUTH_CLIENT_ID     = OAUTH_CLIENT_ID;
process.env.OAUTH_CLIENT_SECRET = OAUTH_CLIENT_SECRET;
process.env.OAUTH_REDIRECT_URI  = OAUTH_REDIRECT_URI;
process.env.CSRF_SECRET         = "test-csrf-secret-not-for-production";

const { app } = require("../../server/app");
const { preloadPublicKey } = require("../../server/lib/crypto");

preloadPublicKey()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[e2e-server] listening on ${PORT}, ACCOUNT_MANAGER=${ACCOUNT_MANAGER_URL}`);
    });
  })
  .catch(err => {
    console.error("[e2e-server] Failed to load public key:", err.message);
    process.exit(1);
  });
