"use strict";

const { test, expect } = require("@playwright/test");
const { PORT, ACCOUNT_MANAGER_URL } = require("./constants");

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page.waitForSelector('[data-testid="screen-main"]');
  await page.click("button[data-tab='settings']");
  await expect(page.locator('[data-testid="tab-settings"]')).toBeVisible();
});

test("settings tab shows theme section", async ({ page }) => {
  await expect(page.locator(".settings-title:has-text('Theme')")).toBeVisible();
});

test("settings tab shows Connect Claude section", async ({ page }) => {
  await expect(page.locator(".settings-title:has-text('Connect Claude')")).toBeVisible();
  await expect(page.locator("text=MCP endpoint")).toBeVisible();
});

test("settings tab shows account manager link", async ({ page }) => {
  await expect(page.locator(".settings-title:has-text('Account')")).toBeVisible();
  // Either shows a link to account manager or an info message about ACCOUNT_MANAGER_URL.
  // Use .or() so the assertion retries until one of the two stable states renders.
  await expect(
    page.locator("a:has-text('Open Account Manager')").or(page.getByText("ACCOUNT_MANAGER_URL"))
  ).toBeVisible();
});

test("settings tab shows logout button", async ({ page }) => {
  await expect(page.locator('[data-testid="logout-btn"]')).toBeVisible();
});

test("logout leaves the main app", async ({ page }) => {
  await page.click('[data-testid="logout-btn"]');
  await page.waitForURL(
    url => !url.href.includes(`localhost:${PORT}/gamebacklog`) || url.href.includes("/auth/login"),
    { timeout: 10000 }
  );
  await expect(page.locator('[data-testid="screen-main"]')).toHaveCount(0);
});
