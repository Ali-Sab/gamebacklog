"use strict";

const fs     = require("fs");
const crypto = require("crypto");
const path   = require("path");
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
  // Fresh data directory
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Write credentials.json with hardcoded TOTP secret for deterministic codes
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashPassword(PASSWORD, salt);
  fs.writeFileSync(
    path.join(DATA_DIR, "credentials.json"),
    JSON.stringify({ username: USERNAME, hash, salt, totpSecret: TOTP_SECRET }, null, 2)
  );

  // Write empty pending queue
  fs.writeFileSync(path.join(DATA_DIR, "pending.json"), "[]");

  // Browser login to capture auth storage state
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto(`http://localhost:${PORT}`);

  // Step 1 — credentials
  await page.waitForSelector("#screen-login:not(.hidden)");
  await page.fill("#login-username", USERNAME);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-step1 .btn-gold");

  // Step 2 — TOTP (try current window, fall back to +1 if we're at a boundary)
  await page.waitForSelector("#login-totp");
  await page.fill("#login-totp", computeTOTP(TOTP_SECRET));
  await page.click("text=Verify & Sign In");

  // If TOTP failed (boundary timing), retry with next window
  const err = page.locator("#login-error2:not(.hidden)");
  if (await err.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.fill("#login-totp", computeTOTP(TOTP_SECRET, 1));
    await page.click("text=Verify & Sign In");
  }

  // Wait for main app
  await page.waitForSelector("#screen-main:not(.hidden)", { timeout: 10000 });

  await context.storageState({ path: AUTH_STATE_FILE });
  await browser.close();
};
