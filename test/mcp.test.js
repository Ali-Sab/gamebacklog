"use strict";

// MCP tool unit tests — no HTTP, no disk I/O
const { execTool } = require("../server/mcp-server");
const { makeStore } = require("./helpers");

// Helpers
function text(result) {
  return result.content[0].text;
}
function json(result) {
  return JSON.parse(text(result));
}

const GAMES = {
  inbox: [],
  queue: [
    { id: "q1", title: "Hollow Knight", mode: "atmospheric", risk: "",       hours: "40", note: "Essential metroidvania" },
    { id: "q2", title: "SOMA",          mode: "atmospheric", risk: "",       hours: "10", note: "Existential horror"     }
  ],
  caveats: [
    { id: "c1", title: "Hades",         mode: "action",      risk: "medium", hours: "22", note: "Roguelike with story"  }
  ],
  decompression: [],
  yourCall: [],
  played: []
};

const PROFILE = [{ name: "CORE IDENTITY", text: "I love atmospheric games above all else." }];

// ─── get_game_library ─────────────────────────────────────────────────────────
describe("get_game_library", () => {
  test("returns all categories", async () => {
    const { readJSON, writeJSON } = makeStore({ "games.json": GAMES });
    const result = await execTool("get_game_library", {}, readJSON, writeJSON);
    const data = json(result);
    expect(data).toHaveProperty("queue");
    expect(data).toHaveProperty("caveats");
    expect(data).toHaveProperty("played");
  });

  test("queue items have 1-based rank", async () => {
    const { readJSON, writeJSON } = makeStore({ "games.json": GAMES });
    const data = json(await execTool("get_game_library", {}, readJSON, writeJSON));
    expect(data.queue[0].rank).toBe(1);
    expect(data.queue[1].rank).toBe(2);
  });

  test("all items have a 1-based rank", async () => {
    const { readJSON, writeJSON } = makeStore({ "games.json": GAMES });
    const data = json(await execTool("get_game_library", {}, readJSON, writeJSON));
    expect(data.caveats[0].rank).toBe(1);
  });

  test("includes notes for each game", async () => {
    const { readJSON, writeJSON } = makeStore({ "games.json": GAMES });
    const data = json(await execTool("get_game_library", {}, readJSON, writeJSON));
    expect(data.queue[0].note).toBe("Essential metroidvania");
    expect(data.queue[1].note).toBe("Existential horror");
    expect(data.caveats[0].note).toBe("Roguelike with story");
  });

  test("includes title, mode, risk, hours, category on each game", async () => {
    const { readJSON, writeJSON } = makeStore({ "games.json": GAMES });
    const data = json(await execTool("get_game_library", {}, readJSON, writeJSON));
    const game = data.queue[0];
    expect(game.title).toBe("Hollow Knight");
    expect(game.mode).toBe("atmospheric");
    expect(game.hours).toBe("40");
    expect(game.category).toBe("queue");
  });

  test("returns empty categories for fresh library", async () => {
    const { readJSON, writeJSON } = makeStore({ "games.json": {} });
    const data = json(await execTool("get_game_library", {}, readJSON, writeJSON));
    expect(data).toEqual({});
  });
});

// ─── get_taste_profile ────────────────────────────────────────────────────────
describe("get_taste_profile", () => {
  test("returns the full profile text", async () => {
    const { readJSON, writeJSON } = makeStore({ "profile.json": PROFILE });
    const result = await execTool("get_taste_profile", {}, readJSON, writeJSON);
    expect(text(result)).toBe("CORE IDENTITY\nI love atmospheric games above all else.");
  });

  test("returns placeholder when no profile is set", async () => {
    const { readJSON, writeJSON } = makeStore({});
    const result = await execTool("get_taste_profile", {}, readJSON, writeJSON);
    expect(text(result)).toBe("(no profile set)");
  });
});


// ─── suggest_game_move ────────────────────────────────────────────────────────
describe("suggest_game_move", () => {
  test("creates a pending item in pending.json", async () => {
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": [] });
    await execTool("suggest_game_move", {
      title: "SOMA", fromCategory: "queue", toCategory: "played", reason: "Beat it"
    }, readJSON, writeJSON);

    expect(store["pending.json"]).toHaveLength(1);
    const item = store["pending.json"][0];
    expect(item.type).toBe("game_move");
    expect(item.status).toBe("pending");
    expect(item.data.title).toBe("SOMA");
    expect(item.data.fromCategory).toBe("queue");
    expect(item.data.toCategory).toBe("played");
    expect(item.reason).toBe("Beat it");
    expect(item.id).toBeDefined();
    expect(item.createdAt).toBeDefined();
  });

  test("appends to an existing pending list for a different game", async () => {
    const existing = [{ id: "aaa", type: "new_game", status: "pending", data: { title: "Other Game" } }];
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": existing });
    await execTool("suggest_game_move", {
      title: "Hades", fromCategory: "caveats", toCategory: "queue", reason: "Good fit"
    }, readJSON, writeJSON);
    expect(store["pending.json"]).toHaveLength(2);
  });

  test("replaces existing pending suggestion for the same game", async () => {
    const existing = [{ id: "aaa", type: "game_move", status: "pending", data: { title: "Hades" }, reason: "Old reason" }];
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": existing });
    await execTool("suggest_game_move", {
      title: "Hades", fromCategory: "caveats", toCategory: "played", reason: "New reason"
    }, readJSON, writeJSON);
    expect(store["pending.json"]).toHaveLength(1);
    expect(store["pending.json"][0].id).toBe("aaa");
    expect(store["pending.json"][0].data.toCategory).toBe("played");
    expect(store["pending.json"][0].reason).toBe("New reason");
  });

  test("merges into pending new_game when move targets an unadded game", async () => {
    const existing = [{ id: "ng1", type: "new_game", status: "pending", data: { title: "Disco Elysium", category: "queue" }, reason: "Great fit" }];
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": existing });
    await execTool("suggest_game_move", {
      title: "Disco Elysium", fromCategory: "queue", toCategory: "played", reason: "Already finished"
    }, readJSON, writeJSON);
    // Should still be one item — the new_game, not a separate game_move
    expect(store["pending.json"]).toHaveLength(1);
    expect(store["pending.json"][0].type).toBe("new_game");
    expect(store["pending.json"][0].data.category).toBe("played");
    expect(store["pending.json"][0].reason).toBe("Already finished");
  });

  test("returns a confirmation message", async () => {
    const { readJSON, writeJSON } = makeStore({ "pending.json": [] });
    const result = await execTool("suggest_game_move", {
      title: "SOMA", fromCategory: "queue", toCategory: "played", reason: "Done"
    }, readJSON, writeJSON);
    expect(text(result)).toContain("SOMA");
    expect(text(result)).toContain("Awaiting user approval");
  });
});

// ─── suggest_profile_update ───────────────────────────────────────────────────
describe("suggest_profile_update", () => {
  test("creates a profile_update pending item", async () => {
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": [] });
    await execTool("suggest_profile_update", {
      section: "SESSION LENGTH",
      change: "Prefers under 2 hours per session.",
      reason: "Observed from conversation"
    }, readJSON, writeJSON);

    const item = store["pending.json"][0];
    expect(item.type).toBe("profile_update");
    expect(item.status).toBe("pending");
    expect(item.data.section).toBe("SESSION LENGTH");
    expect(item.data.change).toBe("Prefers under 2 hours per session.");
  });

  test("replaces existing pending suggestion for the same section", async () => {
    const existing = [{ id: "bbb", type: "profile_update", status: "pending", data: { section: "DIFFICULTY", change: "Old change" }, reason: "Old" }];
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": existing });
    await execTool("suggest_profile_update", {
      section: "DIFFICULTY", change: "New change", reason: "Updated"
    }, readJSON, writeJSON);
    expect(store["pending.json"]).toHaveLength(1);
    expect(store["pending.json"][0].id).toBe("bbb");
    expect(store["pending.json"][0].data.change).toBe("New change");
  });

  test("returns a confirmation message", async () => {
    const { readJSON, writeJSON } = makeStore({ "pending.json": [] });
    const result = await execTool("suggest_profile_update", {
      section: "DIFFICULTY", change: "Handles hard games fine.", reason: "Evidence"
    }, readJSON, writeJSON);
    expect(text(result)).toContain("DIFFICULTY");
    expect(text(result)).toContain("Awaiting user approval");
  });
});

// ─── suggest_new_game ─────────────────────────────────────────────────────────
describe("suggest_new_game", () => {
  test("creates a new_game pending item with all fields", async () => {
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": [] });
    await execTool("suggest_new_game", {
      title: "Disco Elysium",
      category: "queue",
      mode: "detective",
      risk: "",
      hours: "30",
      note: "Extraordinary writing",
      reason: "Perfect fit"
    }, readJSON, writeJSON);

    const item = store["pending.json"][0];
    expect(item.type).toBe("new_game");
    expect(item.status).toBe("pending");
    expect(item.data.title).toBe("Disco Elysium");
    expect(item.data.category).toBe("queue");
    expect(item.data.mode).toBe("detective");
    expect(item.data.hours).toBe("30");
    expect(item.data.note).toBe("Extraordinary writing");
    expect(item.reason).toBe("Perfect fit");
  });

  test("optional fields default to empty string", async () => {
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": [] });
    await execTool("suggest_new_game", {
      title: "Minimal Game", category: "yourCall", reason: "Worth a look"
    }, readJSON, writeJSON);

    const item = store["pending.json"][0];
    expect(item.data.mode).toBe("");
    expect(item.data.risk).toBe("");
    expect(item.data.hours).toBe("");
    expect(item.data.note).toBe("");
  });

  test("replaces existing pending suggestion for the same title", async () => {
    const existing = [{ id: "ccc", type: "new_game", status: "pending", data: { title: "Disco Elysium", category: "yourCall" }, reason: "Old" }];
    const { readJSON, writeJSON, store } = makeStore({ "pending.json": existing });
    await execTool("suggest_new_game", {
      title: "Disco Elysium", category: "queue", reason: "Better fit actually"
    }, readJSON, writeJSON);
    expect(store["pending.json"]).toHaveLength(1);
    expect(store["pending.json"][0].id).toBe("ccc");
    expect(store["pending.json"][0].data.category).toBe("queue");
  });

  test("returns a confirmation message", async () => {
    const { readJSON, writeJSON } = makeStore({ "pending.json": [] });
    const result = await execTool("suggest_new_game", {
      title: "New Game", category: "queue", reason: "Reason"
    }, readJSON, writeJSON);
    expect(text(result)).toContain("New Game");
    expect(text(result)).toContain("Awaiting user approval");
  });
});

// ─── unknown tool ─────────────────────────────────────────────────────────────
describe("unknown tool", () => {
  test("throws McpError for unknown tool name", async () => {
    const { readJSON, writeJSON } = makeStore({});
    await expect(
      execTool("totally_unknown_tool", {}, readJSON, writeJSON)
    ).rejects.toThrow();
  });
});
