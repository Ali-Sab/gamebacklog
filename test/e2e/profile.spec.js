"use strict";

const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#screen-main:not(.hidden)");
  await page.click("button[data-tab='profile']");
  await expect(page.locator("#tab-profile")).toHaveClass(/active/);
});

test("profile tab renders profile content", async ({ page }) => {
  await expect(page.locator("#profile-content")).toBeVisible();
});

test("edit profile button is present", async ({ page }) => {
  await expect(page.locator("button:has-text('Edit Profile')")).toBeVisible();
});

test("clicking edit profile shows textarea and save button", async ({ page }) => {
  await page.click("button:has-text('Edit Profile')");
  await expect(page.locator("textarea")).toBeVisible();
  await expect(page.locator("#profile-btns button:has-text('Save')")).toBeVisible();
});

test("can edit and save profile", async ({ page }) => {
  await page.click("button:has-text('Edit Profile')");
  const ta = page.locator("textarea");
  await ta.fill("Updated profile content for E2E test");
  await page.click("#profile-btns button:has-text('Save')");

  // After save, should exit edit mode
  await expect(page.locator("textarea")).toHaveCount(0);

  // Reload and verify persistence
  await page.reload();
  await page.waitForSelector("#screen-main:not(.hidden)");
  await page.click("button[data-tab='profile']");
  await expect(page.locator("#profile-content")).toContainText("Updated profile content for E2E test");
});
