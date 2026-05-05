"use strict";

const fs     = require("fs");
const crypto = require("crypto");
const { chromium } = require("@playwright/test");
const { PORT, DATA_DIR, AUTH_STATE_FILE, USERNAME, PASSWORD, TOTP_SECRET } = require("./constants");
const { computeTOTP } = require("./totp");

function hashPassword(password, salt) {
  return new Promise((res, rej) =>
    crypto.pbkdf2(password, salt, 310000, 64, "sha512",
      (err, key) => err ? rej(err) : res(key.toString("hex")))
  );
}

module.exports = async function globalSetup() {
  // DATA_DIR was wiped and recreated by e2e/server.js before webServer launched.
  // Open a second SQLite connection to the same file and write credentials.
  // WAL mode allows concurrent readers/writers so the server process sees the write.
  process.env.DATA_DIR = DATA_DIR;
  const { writeCredentials } = require("../../server/db");

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashPassword(PASSWORD, salt);
  writeCredentials({ username: USERNAME, hash, salt, totpSecret: TOTP_SECRET });

  // Browser login to capture auth storage state
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto(`http://localhost:${PORT}/gamebacklog`);

  await page.waitForSelector('[data-testid="screen-login"]', { timeout: 10000 });
  await page.fill('[data-testid="login-username"]', USERNAME);
  await page.fill('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit-step1"]');

  await page.waitForSelector('[data-testid="login-totp"]');
  await page.fill('[data-testid="login-totp"]', computeTOTP(TOTP_SECRET));
  await page.click('button:has-text("Verify")');

  const err = page.locator('[data-testid="login-error2"]');
  if (await err.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.fill('[data-testid="login-totp"]', computeTOTP(TOTP_SECRET, 1));
    await page.click('button:has-text("Verify")');
  }

  await page.waitForSelector('[data-testid="screen-main"]', { timeout: 10000 });

  await context.storageState({ path: AUTH_STATE_FILE });
  await browser.close();
};
