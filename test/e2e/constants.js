"use strict";

const os   = require("os");
const path = require("path");

module.exports = {
  PORT:            4321,
  JWT_SECRET:      "e2e-test-jwt-secret-do-not-use-in-production",
  DATA_DIR:        path.join(os.tmpdir(), "gamebacklog-e2e"),
  AUTH_STATE_FILE: path.join(__dirname, ".auth-state.json"),
  USERNAME:        "e2etester",
  PASSWORD:        "e2epassword123",
  // Fixed 16-char base32 TOTP secret — used for deterministic test codes
  TOTP_SECRET:     "AAAAAAAAAAAAAAAA",
};
