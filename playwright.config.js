"use strict";

const { defineConfig, devices } = require("@playwright/test");
const { PORT, AUTH_STATE_FILE }  = require("./test/e2e/constants");

module.exports = defineConfig({
  testDir:        "./test/e2e",
  testMatch:      "**/*.spec.js",
  fullyParallel:  false,
  retries:        0,
  workers:        1,
  timeout:        20000,
  globalSetup:    "./test/e2e/global-setup.js",
  globalTeardown: "./test/e2e/global-teardown.js",

  use: {
    baseURL:     `http://localhost:${PORT}`,
    storageState: AUTH_STATE_FILE,
    trace:       "on-first-retry",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command:          "NODE_ENV=production node test/e2e/server.js",
    port:             PORT,
    reuseExistingServer: false,
    timeout:          15000,
  },
});
