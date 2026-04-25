"use strict";

// Auth flows — does NOT use saved storageState
const { test, expect } = require("@playwright/test");
const { PORT, USERNAME, PASSWORD, TOTP_SECRET } = require("./constants");
const { computeTOTP } = require("./totp");

test.use({ storageState: { cookies: [], origins: [] } });

test("redirects to login on first load", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);
  await expect(page.locator("#screen-login")).toBeVisible();
  await expect(page.locator("#screen-main")).toBeHidden();
});

test("shows error for wrong password", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);
  await page.waitForSelector("#screen-login:not(.hidden)");
  await page.fill("#login-username", USERNAME);
  await page.fill("#login-password", "wrongpassword");
  await page.click("#login-step1 .btn-gold");
  await expect(page.locator("#login-error1")).toBeVisible();
});

test("shows TOTP step after valid credentials", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);
  await page.waitForSelector("#screen-login:not(.hidden)");
  await page.fill("#login-username", USERNAME);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-step1 .btn-gold");
  await expect(page.locator("#login-step2")).toBeVisible();
  await expect(page.locator("#login-totp")).toBeVisible();
});

test("shows error for wrong TOTP code", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);
  await page.waitForSelector("#screen-login:not(.hidden)");
  await page.fill("#login-username", USERNAME);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-step1 .btn-gold");
  await page.waitForSelector("#login-totp");
  await page.fill("#login-totp", "000000");
  await page.click("#login-step2 .btn-gold");
  await expect(page.locator("#login-error2")).toBeVisible();
});

test("full login flow lands on main app", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}`);
  await page.waitForSelector("#screen-login:not(.hidden)");
  await page.fill("#login-username", USERNAME);
  await page.fill("#login-password", PASSWORD);
  await page.click("#login-step1 .btn-gold");
  await page.waitForSelector("#login-totp");

  let code = computeTOTP(TOTP_SECRET);
  await page.fill("#login-totp", code);
  await page.click("#login-step2 .btn-gold");

  const err = page.locator("#login-error2:not(.hidden)");
  if (await err.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.fill("#login-totp", computeTOTP(TOTP_SECRET, 1));
    await page.click("#login-step2 .btn-gold");
  }

  await expect(page.locator("#screen-main")).toBeVisible({ timeout: 10000 });
});

// Logout test does its own fresh login so it doesn't revoke the shared storageState token
test.describe("authenticated logout", () => {
  test("logout clears session and shows login screen", async ({ page }) => {
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector("#screen-login:not(.hidden)");
    await page.fill("#login-username", USERNAME);
    await page.fill("#login-password", PASSWORD);
    await page.click("#login-step1 .btn-gold");
    await page.waitForSelector("#login-totp");
    await page.fill("#login-totp", computeTOTP(TOTP_SECRET));
    await page.click("#login-step2 .btn-gold");
    const err = page.locator("#login-error2:not(.hidden)");
    if (await err.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.fill("#login-totp", computeTOTP(TOTP_SECRET, 1));
      await page.click("#login-step2 .btn-gold");
    }
    await page.waitForSelector("#screen-main:not(.hidden)", { timeout: 10000 });
    await page.click("button[data-tab='settings']");
    await page.click("text=Log Out + Clear Session");
    await expect(page.locator("#screen-login")).toBeVisible({ timeout: 5000 });
  });
});
