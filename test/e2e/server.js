"use strict";

// E2E test server — sets env vars before requiring server.js
const fs = require("fs");
const { PORT, JWT_SECRET, DATA_DIR } = require("./constants");

// Always start with a clean slate so credentials written by global-setup are the only ones
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.PORT       = String(PORT);
process.env.JWT_SECRET = JWT_SECRET;
process.env.DATA_DIR   = DATA_DIR;
process.env.NODE_ENV   = "test";

const { app } = require("../../server/app");

app.listen(PORT, () => {
  console.log(`[e2e-server] listening on ${PORT}, DATA_DIR=${DATA_DIR}`);
});
