"use strict";

const os      = require("os");
const fs      = require("fs");
const path    = require("path");
const request = require("supertest");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
process.env.DATA_DIR   = DATA_DIR;
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NODE_ENV   = "test";

const { app, computeTOTP } = require("../server");
const { execTool }         = require("../mcp-server");
const { readJSON, writeJSON } = require("../db");
const { setupAndLogin, makeStore } = require("./helpers");

let token;

beforeAll(async () => {
  const result = await setupAndLogin(request, app, computeTOTP);
  token = result.accessToken;

  // Seed a game library so move/approve tests have something to work with
  const games = {
    queue:         [{ id: "q1", title: "Hollow Knight", mode: "atmospheric", hours: "40", note: "Essential" }],
    caveats:       [{ id: "c1", title: "Hades", mode: "action", risk: "medium", hours: "22", note: "" }],
    decompression: [],
    yourCall:      [],
    played:        []
  };
  await request(app)
    .post("/api/data")
    .set("Authorization", `Bearer ${token}`)
    .send({ games, profile: "My taste profile." });
});

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const auth = () => ({ Authorization: `Bearer ${token}` });

// ─── Auth guard ───────────────────────────────────────────────────────────────
describe("auth guards", () => {
  test("GET /api/pending requires auth", async () => {
    await request(app).get("/api/pending").expect(401);
  });
  test("GET /api/pending/history requires auth", async () => {
    await request(app).get("/api/pending/history").expect(401);
  });
  test("POST /api/pending/:id/approve requires auth", async () => {
    await request(app).post("/api/pending/fakeid/approve").expect(401);
  });
  test("POST /api/pending/:id/reject requires auth", async () => {
    await request(app).post("/api/pending/fakeid/reject").expect(401);
  });
});

// ─── Empty state ──────────────────────────────────────────────────────────────
describe("empty pending queue", () => {
  test("GET /api/pending returns []", async () => {
    const res = await request(app).get("/api/pending").set(auth()).expect(200);
    expect(res.body).toEqual([]);
  });

  test("GET /api/pending/history returns []", async () => {
    const res = await request(app).get("/api/pending/history").set(auth()).expect(200);
    expect(res.body).toEqual([]);
  });
});

// ─── Not found ────────────────────────────────────────────────────────────────
describe("unknown IDs", () => {
  test("approve nonexistent ID returns 404", async () => {
    await request(app).post("/api/pending/doesnotexist/approve").set(auth()).expect(404);
  });
  test("reject nonexistent ID returns 404", async () => {
    await request(app).post("/api/pending/doesnotexist/reject").set(auth()).expect(404);
  });
});

// ─── game_move ────────────────────────────────────────────────────────────────
describe("game_move suggestion", () => {
  let itemId;

  beforeAll(async () => {
    await execTool("suggest_game_move", {
      title: "Hollow Knight",
      fromCategory: "queue",
      toCategory: "played",
      reason: "Already finished it"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth());
    itemId = res.body[0]?.id;
  });

  test("pending queue has one item", async () => {
    const res = await request(app).get("/api/pending").set(auth()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].type).toBe("game_move");
    expect(res.body[0].status).toBe("pending");
    expect(res.body[0].data.title).toBe("Hollow Knight");
  });

  test("reject removes item from pending list", async () => {
    // Reject and check it disappears
    await request(app).post(`/api/pending/${itemId}/reject`).set(auth()).expect(200);
    const res = await request(app).get("/api/pending").set(auth());
    expect(res.body).toHaveLength(0);
  });

  test("history shows rejected item", async () => {
    const res = await request(app).get("/api/pending/history").set(auth()).expect(200);
    const item = res.body.find(p => p.id === itemId);
    expect(item).toBeDefined();
    expect(item.status).toBe("rejected");
  });
});

// ─── approve game_move ────────────────────────────────────────────────────────
describe("approve game_move", () => {
  let itemId;

  beforeAll(async () => {
    // Move Hades from caveats to queue
    await execTool("suggest_game_move", {
      title: "Hades",
      fromCategory: "caveats",
      toCategory: "queue",
      reason: "Great fit actually"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth());
    itemId = res.body[res.body.length - 1]?.id;
  });

  test("approving moves the game in games.json", async () => {
    await request(app).post(`/api/pending/${itemId}/approve`).set(auth()).expect(200);

    const dataRes = await request(app).get("/api/data").set(auth());
    const { games } = dataRes.body;
    expect(games.queue.some(g => g.title === "Hades")).toBe(true);
    expect(games.caveats.some(g => g.title === "Hades")).toBe(false);
  });

  test("approved item appears in history with status approved", async () => {
    const res = await request(app).get("/api/pending/history").set(auth()).expect(200);
    const item = res.body.find(p => p.id === itemId);
    expect(item.status).toBe("approved");
    expect(item.approvedAt).toBeDefined();
  });
});

// ─── approve new_game ─────────────────────────────────────────────────────────
describe("approve new_game", () => {
  let itemId;

  beforeAll(async () => {
    await execTool("suggest_new_game", {
      title: "Disco Elysium",
      category: "queue",
      mode: "detective",
      risk: "",
      hours: "30",
      note: "Essential detective RPG",
      reason: "Perfect taste profile fit"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth());
    itemId = res.body[res.body.length - 1]?.id;
  });

  test("approving adds the game to games.json", async () => {
    await request(app).post(`/api/pending/${itemId}/approve`).set(auth()).expect(200);
    const dataRes = await request(app).get("/api/data").set(auth());
    const { games } = dataRes.body;
    expect(games.queue.some(g => g.title === "Disco Elysium")).toBe(true);
  });
});

// ─── suggest_game_edit ────────────────────────────────────────────────────────
describe("suggest_game_edit", () => {
  test("queues a pending game_edit item", async () => {
    await execTool("suggest_game_edit", {
      title: "Hollow Knight",
      mode: "action",
      hours: "50",
      reason: "More action than atmospheric on reflection"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth()).expect(200);
    const item = res.body.find(p => p.type === "game_edit" && p.data.title === "Hollow Knight");
    expect(item).toBeDefined();
    expect(item.status).toBe("pending");
    expect(item.data.changes.mode).toBe("action");
    expect(item.data.changes.hours).toBe("50");
    expect(item.data.changes.note).toBeUndefined();
  });

  test("second suggestion for same title replaces first", async () => {
    await execTool("suggest_game_edit", {
      title: "Hollow Knight",
      mode: "immersive",
      reason: "Updated take"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth());
    const items = res.body.filter(p => p.type === "game_edit" && p.data.title === "Hollow Knight" && p.status === "pending");
    expect(items).toHaveLength(1);
    expect(items[0].data.changes.mode).toBe("immersive");
  });

  test("returns error when no fields are provided", async () => {
    const result = await execTool("suggest_game_edit", {
      title: "Hollow Knight",
      reason: "Nothing to change"
    }, readJSON, writeJSON);
    expect(result.content[0].text).toMatch(/no changes/i);
  });
});

// ─── approve game_edit ────────────────────────────────────────────────────────
describe("approve game_edit", () => {
  let itemId;

  beforeAll(async () => {
    await execTool("suggest_game_edit", {
      title: "Hades",
      mode: "action",
      hours: "25",
      note: "Excellent loop",
      reason: "Refined after reflection"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth());
    itemId = res.body.find(p => p.type === "game_edit" && p.data.title === "Hades")?.id;
  });

  test("approving patches the game fields in place", async () => {
    await request(app).post(`/api/pending/${itemId}/approve`).set(auth()).expect(200);
    const dataRes = await request(app).get("/api/data").set(auth());
    const allGames = Object.values(dataRes.body.games).flat();
    const hades = allGames.find(g => g.title === "Hades");
    expect(hades).toBeDefined();
    expect(hades.mode).toBe("action");
    expect(hades.hours).toBe("25");
    expect(hades.note).toBe("Excellent loop");
  });

  test("approved item appears in history", async () => {
    const res = await request(app).get("/api/pending/history").set(auth()).expect(200);
    const item = res.body.find(p => p.id === itemId);
    expect(item.status).toBe("approved");
    expect(item.approvedAt).toBeDefined();
  });
});

// ─── approve profile_update ───────────────────────────────────────────────────
describe("approve profile_update", () => {
  let itemId;

  beforeAll(async () => {
    await execTool("suggest_profile_update", {
      section: "SESSION LENGTH",
      change: "Prefers sessions under 2 hours.",
      reason: "Observed from conversation"
    }, readJSON, writeJSON);

    const res = await request(app).get("/api/pending").set(auth());
    itemId = res.body[res.body.length - 1]?.id;
  });

  test("approving appends the change to profile.json", async () => {
    await request(app).post(`/api/pending/${itemId}/approve`).set(auth()).expect(200);
    const dataRes = await request(app).get("/api/data").set(auth());
    expect(dataRes.body.profile).toContain("SESSION LENGTH");
    expect(dataRes.body.profile).toContain("Prefers sessions under 2 hours.");
  });
});
