"use strict";

// Auth flows — does NOT use saved storageState
const { test, expect } = require("@playwright/test");
const { PORT, USERNAME, PASSWORD, TOTP_SECRET } = require("./constants");
const { computeTOTP } = require("./totp");

test.use({ storageState: { cookies: [], origins: [] } });

test("redirects to login on first load", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await expect(page.locator('[data-testid="screen-login"]')).toBeVisible();
  await expect(page.locator('[data-testid="screen-main"]')).toHaveCount(0);
});

test("shows error for wrong password", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForSelector('[data-testid="screen-login"]');
  await page.fill('[data-testid="login-username"]', USERNAME);
  await page.fill('[data-testid="login-password"]', "wrongpassword");
  await page.click('[data-testid="login-submit-step1"]');
  await expect(page.locator('[data-testid="login-error1"]')).toBeVisible();
});

test("shows TOTP step after valid credentials", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForSelector('[data-testid="screen-login"]');
  await page.fill('[data-testid="login-username"]', USERNAME);
  await page.fill('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit-step1"]');
  await expect(page.locator('[data-testid="login-totp-mode"]')).toBeVisible();
  await expect(page.locator('[data-testid="login-totp"]')).toBeVisible();
});

test("shows error for wrong TOTP code", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForSelector('[data-testid="screen-login"]');
  await page.fill('[data-testid="login-username"]', USERNAME);
  await page.fill('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit-step1"]');
  await page.waitForSelector('[data-testid="login-totp"]');
  await page.fill('[data-testid="login-totp"]', "000000");
  await page.click('button:has-text("Verify")');
  await expect(page.locator('[data-testid="login-error2"]')).toBeVisible();
});

test("full login flow lands on main app", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForSelector('[data-testid="screen-login"]');
  await page.fill('[data-testid="login-username"]', USERNAME);
  await page.fill('[data-testid="login-password"]', PASSWORD);
  await page.click('[data-testid="login-submit-step1"]');
  await page.waitForSelector('[data-testid="login-totp"]');

  let code = computeTOTP(TOTP_SECRET);
  await page.fill('[data-testid="login-totp"]', code);
  await page.click('button:has-text("Verify")');

  const err = page.locator('[data-testid="login-error2"]');
  if (await err.isVisible({ timeout: 1500 }).catch(() => false)) {
    await page.fill('[data-testid="login-totp"]', computeTOTP(TOTP_SECRET, 1));
    await page.click('button:has-text("Verify")');
  }

  await expect(page.locator('[data-testid="screen-main"]')).toBeVisible({ timeout: 10000 });
});

// Logout test does its own fresh login so it doesn't revoke the shared storageState token
test.describe("authenticated logout", () => {
  test("logout clears session and shows login screen", async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/gamebacklog`);
    await page.waitForSelector('[data-testid="screen-login"]');
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
    await page.click("button[data-tab='settings']");
    await page.click('[data-testid="logout-btn"]');
    await expect(page.locator('[data-testid="screen-login"]')).toBeVisible({ timeout: 5000 });
  });
});
