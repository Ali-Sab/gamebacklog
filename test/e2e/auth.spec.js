"use strict";

// Auth flows — does NOT use saved storageState
const { test, expect } = require("@playwright/test");
const { PORT, ACCOUNT_MANAGER_URL, USERNAME, PASSWORD, TOTP_SECRET } = require("./constants");
const { computeTOTP } = require("./totp");

test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated load redirects to account-manager authorize", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForURL(url => url.href.includes(`${ACCOUNT_MANAGER_URL}/authorize`), { timeout: 10000 });
  await expect(page.locator("#username")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
});

test("shows error on wrong password", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForURL(url => url.href.includes(`${ACCOUNT_MANAGER_URL}/authorize`), { timeout: 10000 });
  await page.fill("#username", USERNAME);
  await page.fill("#password", "wrongpassword");
  await page.fill("#totp", "000000");
  await page.click('button[type="submit"][value="allow"]');
  // Account-manager re-renders the form with an error
  await expect(page.locator(".error")).toBeVisible({ timeout: 5000 });
  // Still on authorize page
  expect(page.url()).toContain(`${ACCOUNT_MANAGER_URL}/authorize`);
});

test("shows error on wrong TOTP code", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForURL(url => url.href.includes(`${ACCOUNT_MANAGER_URL}/authorize`), { timeout: 10000 });
  await page.fill("#username", USERNAME);
  await page.fill("#password", PASSWORD);
  await page.fill("#totp", "000000");
  await page.click('button[type="submit"][value="allow"]');
  await expect(page.locator(".error")).toBeVisible({ timeout: 5000 });
  expect(page.url()).toContain(`${ACCOUNT_MANAGER_URL}/authorize`);
});

test("full login flow lands on main app", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/gamebacklog`);
  await page.waitForURL(url => url.href.includes(`${ACCOUNT_MANAGER_URL}/authorize`), { timeout: 10000 });

  await page.fill("#username", USERNAME);
  await page.fill("#password", PASSWORD);
  await page.fill("#totp", computeTOTP(TOTP_SECRET));
  await page.click('button[type="submit"][value="allow"]');

  // Retry with next TOTP window if we were at a boundary
  if (page.url().includes(`${ACCOUNT_MANAGER_URL}/authorize`)) {
    await page.fill("#totp", computeTOTP(TOTP_SECRET, 1));
    await page.click('button[type="submit"][value="allow"]');
  }

  await expect(page.locator('[data-testid="screen-main"]')).toBeVisible({ timeout: 15000 });
});

test.describe("authenticated logout", () => {
  test("logout redirects away from app", async ({ page }) => {
    // Full login first
    await page.goto(`http://localhost:${PORT}/gamebacklog`);
    await page.waitForURL(url => url.href.includes(`${ACCOUNT_MANAGER_URL}/authorize`), { timeout: 10000 });
    await page.fill("#username", USERNAME);
    await page.fill("#password", PASSWORD);
    await page.fill("#totp", computeTOTP(TOTP_SECRET));
    await page.click('button[type="submit"][value="allow"]');
    if (page.url().includes(`${ACCOUNT_MANAGER_URL}/authorize`)) {
      await page.fill("#totp", computeTOTP(TOTP_SECRET, 1));
      await page.click('button[type="submit"][value="allow"]');
    }
    await page.waitForSelector('[data-testid="screen-main"]', { timeout: 15000 });

    // Trigger logout
    await page.click("button[data-tab='settings']");
    await page.click('[data-testid="logout-btn"]');

    // Should leave the main app (either to account-manager logout or login page)
    await page.waitForURL(
      url => !url.href.includes(`localhost:${PORT}/gamebacklog`) || url.href.includes("/auth/login"),
      { timeout: 10000 }
    );
    await expect(page.locator('[data-testid="screen-main"]')).toHaveCount(0);
  });
});
