"use strict";

const fs   = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { DATA_DIR } = require("./constants");

function seedGames(games) {
  fs.writeFileSync(path.join(DATA_DIR, "games.json"), JSON.stringify(games, null, 2));
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#screen-main:not(.hidden)");
});

test("games tab is visible and active by default", async ({ page }) => {
  await expect(page.locator("#tab-games")).toHaveClass(/active/);
  await expect(page.locator(".cat-tabs")).toBeVisible();
});

test("all category tabs are present", async ({ page }) => {
  const cats = ["Play Queue", "With Caveats", "Decompression", "Your Call", "Played"];
  for (const label of cats) {
    await expect(page.locator(`.cat-btn:has-text("${label}")`)).toBeVisible();
  }
});

test("game table renders after switching categories", async ({ page }) => {
  await page.click(".cat-btn[data-cat='played']");
  await expect(page.locator("#game-table")).toBeVisible();
});

test("search filters games by title", async ({ page }) => {
  seedGames({
    queue: [
      { id: "e2e-1", title: "Hollow Knight", mode: "atmospheric", risk: "", hours: "40", note: "Great game" },
      { id: "e2e-2", title: "SOMA",           mode: "atmospheric", risk: "", hours: "10", note: "Eerie"      },
    ],
    caveats: [], decompression: [], yourCall: [], played: []
  });
  await page.reload();
  await page.waitForSelector("#screen-main:not(.hidden)");

  await page.fill("#game-search", "hollow");
  await expect(page.locator(".game-title:has-text('Hollow Knight')")).toBeVisible();
  await expect(page.locator(".game-title:has-text('SOMA')")).toHaveCount(0);
});

test("queue games show rank numbers", async ({ page }) => {
  await expect(page.locator(".game-rank").first()).toBeVisible();
});

test("mark played button appears on non-played games", async ({ page }) => {
  // Switch to queue tab
  await page.click(".cat-btn[data-cat='queue']");
  const rows = page.locator(".game-row");
  const count = await rows.count();
  if (count > 0) {
    await expect(rows.first().locator(".action-played")).toBeVisible();
  }
});

test("switching to played category shows no mark-played button", async ({ page }) => {
  seedGames({
    queue: [], caveats: [], decompression: [], yourCall: [],
    played: [{ id: "e2e-p1", title: "Finished Game", mode: "action", risk: "", hours: "20", note: "", playedDate: "1/1/2025" }]
  });
  await page.reload();
  await page.waitForSelector("#screen-main:not(.hidden)");
  await page.click(".cat-btn[data-cat='played']");
  await expect(page.locator(".action-played")).toHaveCount(0);
});
