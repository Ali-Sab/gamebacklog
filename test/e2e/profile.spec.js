"use strict";

const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  // Seed a known profile so tests are independent of prior test state
  const refreshRes = await page.request.post("/api/auth/refresh");
  const { accessToken } = await refreshRes.json();
  await page.request.post("/api/data", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { profile: [
      { name: "CORE IDENTITY", text: "I love atmospheric games above all else." },
      { name: "DIFFICULTY", text: "Prefer fair deaths with clear feedback." }
    ]}
  });

  await page.goto("/");
  await page.waitForSelector('[data-testid="screen-main"]');
  await page.click("button[data-tab='profile']");
  await expect(page.locator('[data-testid="tab-profile"]')).toBeVisible();
});

test("profile tab renders profile content", async ({ page }) => {
  await expect(page.locator('[data-testid="tab-profile"]')).toBeVisible();
  await expect(page.locator(".profile-section-card").first()).toBeVisible();
});

test("edit profile button is present on each section", async ({ page }) => {
  // Hover first section card to reveal edit button
  const card = page.locator(".profile-section-card").first();
  await card.hover();
  await expect(card.locator("button:has-text('Edit')")).toBeVisible();
});

test("clicking edit shows inline name input and textarea", async ({ page }) => {
  const card = page.locator(".profile-section-card").first();
  await card.hover();
  await card.locator("button:has-text('Edit')").click();
  await expect(page.locator(".profile-name-input").first()).toBeVisible();
  await expect(page.locator(".profile-text-textarea").first()).toBeVisible();
  await expect(page.locator("button:has-text('Save')").first()).toBeVisible();
});

test("can edit and save a section", async ({ page }) => {
  const card = page.locator(".profile-section-card").first();
  await card.hover();
  await card.locator("button:has-text('Edit')").click();

  const textarea = page.locator(".profile-text-textarea").first();
  await textarea.fill("Updated section content for E2E test");
  await page.locator("button:has-text('Save')").first().click();

  // After save, should exit edit mode (no textarea)
  await expect(page.locator(".profile-text-textarea")).toHaveCount(0);

  // Content should be visible
  await expect(page.locator('[data-testid="tab-profile"]')).toContainText("Updated section content for E2E test");

  // Reload and verify persistence
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');
  await page.click("button[data-tab='profile']");
  await expect(page.locator('[data-testid="tab-profile"]')).toContainText("Updated section content for E2E test");
});
