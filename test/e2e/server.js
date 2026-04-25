"use strict";

// E2E test server — sets env vars before requiring server.js
const { PORT, JWT_SECRET, DATA_DIR } = require("./constants");

process.env.PORT       = String(PORT);
process.env.JWT_SECRET = JWT_SECRET;
process.env.DATA_DIR   = DATA_DIR;
process.env.NODE_ENV   = "test";

const { app } = require("../../server");

app.listen(PORT, () => {
  console.log(`[e2e-server] listening on ${PORT}, DATA_DIR=${DATA_DIR}`);
});
