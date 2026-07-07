"use strict";

const { chromium } = require("@playwright/test");
const { PORT, AUTH_STATE_FILE, ACCOUNT_MANAGER_URL, USERNAME, PASSWORD, TOTP_SECRET } = require("./constants");
const { computeTOTP } = require("./totp");

module.exports = async function globalSetup() {
  if (!TOTP_SECRET) {
    throw new Error(
      "E2E_TOTP_SECRET is not set. Run 'make setup-test-env' in homelab-infra first, " +
      "then use 'make test-e2e-gamebacklog' to pass credentials automatically."
    );
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page    = await context.newPage();

  // Navigate to the app — React will call /auth/session, get 401, and redirect to /auth/login,
  // which the server turns into a redirect to account-manager's /authorize endpoint.
  await page.goto(`http://localhost:${PORT}/gamebacklog`);

  // Wait for account-manager's login form — this covers the full redirect chain and
  // ensures the form content is ready before we try to interact with it.
  await page.waitForSelector('input[name="username"]', { timeout: 20000 });

  // Fill in the account-manager OAuth login form.
  await page.fill('input[name="username"]', USERNAME);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="totp"]', computeTOTP(TOTP_SECRET));
  await page.click('button[name="decision"][value="allow"]');

  // If TOTP was at a boundary, the code may have expired — retry with next window.
  const currentUrl = page.url();
  if (currentUrl.includes(`${ACCOUNT_MANAGER_URL}/authorize`)) {
    await page.fill('input[name="totp"]', computeTOTP(TOTP_SECRET, 1));
    await page.click('button[name="decision"][value="allow"]');
  }

  // Account-manager redirects back to gamebacklog's /auth/callback, which exchanges the
  // code for a token, sets the accessToken cookie, and redirects to the app root.
  await page.waitForSelector('[data-testid="screen-main"]', { timeout: 15000 });

  await context.storageState({ path: AUTH_STATE_FILE });
  await browser.close();
};
