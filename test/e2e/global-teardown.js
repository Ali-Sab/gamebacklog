"use strict";

const fs = require("fs");
const { DATA_DIR, AUTH_STATE_FILE } = require("./constants");

module.exports = async function globalTeardown() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  if (fs.existsSync(AUTH_STATE_FILE)) fs.unlinkSync(AUTH_STATE_FILE);
};
