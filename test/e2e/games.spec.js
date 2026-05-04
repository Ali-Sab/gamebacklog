"use strict";

const { test, expect } = require("@playwright/test");

const GAME_DEFAULTS = { platform: "pc", input: "kbm" };

function withDefaults(list) {
  return list.map((g) => ({ ...GAME_DEFAULTS, ...g }));
}

async function seedGames(page, games) {
  const res = await page.request.post("/api/auth/refresh");
  const { accessToken } = await res.json();
  const normalized = Object.fromEntries(
    Object.entries(games).map(([cat, list]) => [cat, withDefaults(list)])
  );
  await page.request.post("/api/data", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { games: normalized },
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="screen-main"]');
});

test("games tab is visible and active by default", async ({ page }) => {
  await expect(page.locator('[data-testid="tab-games"]')).toBeVisible();
  await expect(page.locator(".cat-tabs")).toBeVisible();
});

test("all category tabs are present", async ({ page }) => {
  const cats = ["Inbox", "Play Queue", "With Caveats", "Decompression", "Your Call", "Played"];
  for (const label of cats) {
    await expect(page.locator(`.cat-btn:has-text("${label}")`)).toBeVisible();
  }
});

test("Add Game button puts the game in the Inbox", async ({ page }) => {
  await seedGames(page, {
    inbox: [],
    queue: [], caveats: [], decompression: [], yourCall: [], played: []
  });
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');

  await page.click('[data-testid="add-game-btn"]');
  await expect(page.locator(".modal")).toBeVisible();
  await page.fill('[data-testid="gm-title"]', "User Added Game");
  await page.fill("#gm-hours", "5");
  await page.getByLabel("Platform").selectOption("pc");
  await page.getByLabel("Input").selectOption("kbm");
  await page.click('[data-testid="gm-save"]');
  await expect(page.locator(".modal")).toHaveCount(0);

  await page.click(".cat-btn[data-cat='inbox']");
  await expect(page.locator(".game-title:has-text('User Added Game')")).toBeVisible();
});

test("Add Game modal requires platform and input before saving", async ({ page }) => {
  await page.click('[data-testid="add-game-btn"]');
  await expect(page.locator(".modal")).toBeVisible();
  await page.fill('[data-testid="gm-title"]', "Validation Test Game");

  // Save with neither platform nor input selected — expect error
  await page.click('[data-testid="gm-save"]');
  await expect(page.locator('[data-testid="gm-error"]')).toBeVisible();
  await expect(page.locator(".modal")).toBeVisible();

  // Fill platform only — still blocked
  await page.getByLabel("Platform").selectOption("pc");
  await page.click('[data-testid="gm-save"]');
  await expect(page.locator('[data-testid="gm-error"]')).toBeVisible();
  await expect(page.locator(".modal")).toBeVisible();

  // Fill input too — should succeed now
  await page.getByLabel("Input").selectOption("kbm");
  await page.click('[data-testid="gm-save"]');
  await expect(page.locator(".modal")).toHaveCount(0);
});

test("Inbox tab hides rank column and move-to dropdown", async ({ page }) => {
  await seedGames(page, {
    inbox: [{ id: "ib1", title: "Inbox Only", url: "https://store.steampowered.com/app/1" }],
    queue: [], caveats: [], decompression: [], yourCall: [], played: []
  });
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');
  await page.click(".cat-btn[data-cat='inbox']");

  await expect(page.locator(".game-title:has-text('Inbox Only')")).toBeVisible();
  // No rank column header in inbox
  await expect(page.locator(".table-header:has-text('#')")).toHaveCount(0);
  // No move-to dropdown — but Edit and Delete buttons exist
  await expect(page.locator(".game-row select")).toHaveCount(0);
  await expect(page.locator(".row-edit-btn")).toBeVisible();
  await expect(page.locator(".row-delete-btn")).toBeVisible();
  // URL link rendered
  await expect(page.locator(".game-link")).toBeVisible();
});

test("Edit button opens prefilled modal and saves changes", async ({ page }) => {
  await seedGames(page, {
    inbox: [],
    queue: [{ id: "edit-1", title: "Editable Game", mode: "rpg", hours: "10", note: "before" }],
    caveats: [], decompression: [], yourCall: [], played: []
  });
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');

  await page.locator(".game-row:has-text('Editable Game') .row-edit-btn").click();
  await expect(page.locator('[data-testid="gm-title"]')).toHaveValue("Editable Game");
  await expect(page.locator("#gm-hours")).toHaveValue("10");
  await page.fill("#gm-hours", "25");
  await page.click('[data-testid="gm-save"]');
  await expect(page.locator(".modal")).toHaveCount(0);

  await expect(page.locator(".game-row:has-text('Editable Game') .game-hours")).toContainText("25h");
});

test("Delete button removes the game after confirmation", async ({ page }) => {
  await seedGames(page, {
    inbox: [],
    queue: [{ id: "del-1", title: "Doomed Game", mode: "rpg", hours: "10", note: "" }],
    caveats: [], decompression: [], yourCall: [], played: []
  });
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');

  await page.locator(".game-row:has-text('Doomed Game') .row-delete-btn").click();
  await expect(page.locator(".modal-title:has-text('Delete game')")).toBeVisible();
  await page.click('[data-testid="confirm-delete-btn"]');
  await expect(page.locator(".game-title:has-text('Doomed Game')")).toHaveCount(0);
});

test("game table renders after switching categories", async ({ page }) => {
  await page.click(".cat-btn[data-cat='played']");
  await expect(page.locator(".game-table")).toBeVisible();
});

test("search filters games by title", async ({ page }) => {
  await seedGames(page, {
    queue: [
      { id: "e2e-1", title: "Hollow Knight", mode: "atmospheric", risk: "", hours: "40", note: "Great game" },
      { id: "e2e-2", title: "SOMA",           mode: "atmospheric", risk: "", hours: "10", note: "Eerie"      },
    ],
    caveats: [], decompression: [], yourCall: [], played: []
  });
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');

  await page.fill("#global-search", "hollow");
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
  await seedGames(page, {
    queue: [], caveats: [], decompression: [], yourCall: [],
    played: [{ id: "e2e-p1", title: "Finished Game", mode: "action", risk: "", hours: "20", note: "", playedDate: "1/1/2025" }]
  });
  await page.reload();
  await page.waitForSelector('[data-testid="screen-main"]');
  await page.click(".cat-btn[data-cat='played']");
  await expect(page.locator(".action-played")).toHaveCount(0);
});
