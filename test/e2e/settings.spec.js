"use strict";

const { test, expect } = require("@playwright/test");
const { USERNAME, TOTP_SECRET } = require("./constants");
const { computeTOTP } = require("./totp");

test.beforeEach(async ({ page }) => {
  await  page.goto("./");
  await page.waitForSelector('[data-testid="screen-main"]');
  await page.click("button[data-tab='settings']");
  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible();
});

test("settings tab shows change password section", async ({ page }) => {
  await expect(page.locator("#s-current-pw")).toBeVisible();
  await expect(page.locator("#s-new-pw")).toBeVisible();
  await expect(page.locator("#s-confirm-pw")).toBeVisible();
  await expect(page.locator("button:has-text('Change Password')")).toBeVisible();
});

test("settings tab shows Connect Claude section", async ({ page }) => {
  await expect(page.locator(".settings-title:has-text('Connect Claude')")).toBeVisible();
  await expect(page.locator("text=MCP endpoint")).toBeVisible();
});

test("settings tab shows logout button", async ({ page }) => {
  await expect(page.locator('[data-testid="logout-btn"]')).toBeVisible();
});

test("shows error when current password is wrong", async ({ page }) => {
  await page.fill("#s-current-pw", "wrongpassword");
  await page.fill("#s-new-pw", "newpass123");
  await page.fill("#s-confirm-pw", "newpass123");
  await page.click("button:has-text('Change Password')");
  await expect(page.locator("#s-pw-msg")).toBeVisible();
  await expect(page.locator("#s-pw-msg")).toContainText(/incorrect|wrong|invalid/i);
});

test("shows error when passwords don't match", async ({ page }) => {
  await page.fill("#s-current-pw", "e2epassword123");
  await page.fill("#s-new-pw", "newpass123");
  await page.fill("#s-confirm-pw", "differentpass");
  await page.click("button:has-text('Change Password')");
  await expect(page.locator("#s-pw-msg")).toBeVisible();
  await expect(page.locator("#s-pw-msg")).toContainText(/match/i);
});

test("logout navigates back to login screen", async ({ page }) => {
  await page.click('[data-testid="logout-btn"]');
  await expect(page.locator('[data-testid="screen-login"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="screen-main"]')).toHaveCount(0);
});
