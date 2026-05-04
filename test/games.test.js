"use strict";

const os      = require("os");
const fs      = require("fs");
const path    = require("path");
const request = require("supertest");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
process.env.DATA_DIR   = DATA_DIR;
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NODE_ENV   = "test";

const { app, computeTOTP } = require("../server/server");
const { setupAndLogin }    = require("./helpers");

let token;

beforeAll(async () => {
  const result = await setupAndLogin(request, app, computeTOTP);
  token = result.accessToken;
});

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const auth = () => ({ Authorization: `Bearer ${token}` });

// ─── POST /api/games ──────────────────────────────────────────────────────────
describe("POST /api/games", () => {
  test("requires auth", async () => {
    await request(app).post("/api/games").send({ title: "Test" }).expect(401);
  });

  test("rejects missing title", async () => {
    const res = await request(app).post("/api/games").set(auth()).send({}).expect(400);
    expect(res.body.error).toMatch(/title/i);
  });

  test("rejects invalid platform", async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "Test", platform: "switch" })
      .expect(400);
    expect(res.body.error).toMatch(/platform/i);
  });

  test("rejects invalid input device", async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "Test", input: "gamepad" })
      .expect(400);
    expect(res.body.error).toMatch(/input/i);
  });

  test("creates a game in inbox and returns it", async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({
        title: "Hollow Knight",
        mode: "atmospheric",
        hours: "40",
        note: "Essential metroidvania",
        platform: "pc",
        input: "kbm",
        url: "https://store.steampowered.com/app/367520",
        imageUrl: "https://cdn.cloudflare.steamstatic.com/img.jpg",
      })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.game.id).toMatch(/^usr-/);
    expect(res.body.game.title).toBe("Hollow Knight");
    expect(res.body.game.category).toBe("inbox");
    expect(res.body.game.platform).toBe("pc");
    expect(res.body.game.input).toBe("kbm");
    expect(res.body.game.imageUrl).toBe("https://cdn.cloudflare.steamstatic.com/img.jpg");
  });

  test("creates a minimal game (title only)", async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "Minimal" })
      .expect(200);
    expect(res.body.game.title).toBe("Minimal");
    expect(res.body.game.category).toBe("inbox");
  });
});

// ─── PATCH /api/games/:id ─────────────────────────────────────────────────────
describe("PATCH /api/games/:id", () => {
  let gameId;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "Editable Game", hours: "10" });
    gameId = res.body.game.id;
  });

  test("requires auth", async () => {
    await request(app).patch(`/api/games/${gameId}`).send({ hours: "12" }).expect(401);
  });

  test("returns 404 for unknown id", async () => {
    await request(app).patch("/api/games/bad-id").set(auth()).send({ hours: "5" }).expect(404);
  });

  test("updates allowed fields", async () => {
    const res = await request(app)
      .patch(`/api/games/${gameId}`)
      .set(auth())
      .send({ hours: "15", note: "Updated note", platform: "ps5", input: "ps5-controller" })
      .expect(200);
    expect(res.body.game.hours).toBe("15");
    expect(res.body.game.note).toBe("Updated note");
    expect(res.body.game.platform).toBe("ps5");
    expect(res.body.game.input).toBe("ps5-controller");
  });

  test("ignores category/rank changes (use /move instead)", async () => {
    const res = await request(app)
      .patch(`/api/games/${gameId}`)
      .set(auth())
      .send({ category: "queue", rank: 1 })
      .expect(200);
    expect(res.body.game.category).toBe("inbox");
  });

  test("rejects invalid platform in patch", async () => {
    await request(app)
      .patch(`/api/games/${gameId}`)
      .set(auth())
      .send({ platform: "xbox" })
      .expect(400);
  });
});

// ─── DELETE /api/games/:id ────────────────────────────────────────────────────
describe("DELETE /api/games/:id", () => {
  let gameId;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "To Be Deleted" });
    gameId = res.body.game.id;
  });

  test("requires auth", async () => {
    await request(app).delete(`/api/games/${gameId}`).expect(401);
  });

  test("returns 404 for unknown id", async () => {
    await request(app).delete("/api/games/no-such-id").set(auth()).expect(404);
  });

  test("deletes the game and returns ok", async () => {
    const res = await request(app).delete(`/api/games/${gameId}`).set(auth()).expect(200);
    expect(res.body.ok).toBe(true);
  });

  test("second delete returns 404", async () => {
    await request(app).delete(`/api/games/${gameId}`).set(auth()).expect(404);
  });
});

// ─── POST /api/games/:id/move ─────────────────────────────────────────────────
describe("POST /api/games/:id/move", () => {
  let gameId;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "Movable Game" });
    gameId = res.body.game.id;
  });

  test("requires auth", async () => {
    await request(app).post(`/api/games/${gameId}/move`).send({ category: "queue" }).expect(401);
  });

  test("returns 404 for unknown id", async () => {
    await request(app).post("/api/games/bad/move").set(auth()).send({ category: "queue" }).expect(404);
  });

  test("rejects missing category", async () => {
    const res = await request(app)
      .post(`/api/games/${gameId}/move`)
      .set(auth())
      .send({})
      .expect(400);
    expect(res.body.error).toMatch(/category/i);
  });

  test("moves game to the target category", async () => {
    const res = await request(app)
      .post(`/api/games/${gameId}/move`)
      .set(auth())
      .send({ category: "queue" })
      .expect(200);
    expect(res.body.game.category).toBe("queue");
  });
});

// ─── POST /api/games/:id/played ───────────────────────────────────────────────
describe("POST /api/games/:id/played", () => {
  let gameId;
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/games")
      .set(auth())
      .send({ title: "Game To Play" });
    gameId = res.body.game.id;
  });

  test("requires auth", async () => {
    await request(app).post(`/api/games/${gameId}/played`).expect(401);
  });

  test("returns 404 for unknown id", async () => {
    await request(app).post("/api/games/none/played").set(auth()).expect(404);
  });

  test("moves game to played and stamps playedDate", async () => {
    const res = await request(app)
      .post(`/api/games/${gameId}/played`)
      .set(auth())
      .expect(200);
    expect(res.body.game.category).toBe("played");
    expect(res.body.game.playedDate).toBeDefined();
    expect(typeof res.body.game.playedDate).toBe("string");
  });
});

// ─── new fields survive round-trip through POST /api/data ─────────────────────
describe("new fields (platform/input/imageUrl) survive /api/data round-trip", () => {
  test("platform, input, imageUrl persist through bulk save", async () => {
    const games = {
      inbox: [{
        id: "rt1", title: "Round Trip",
        platform: "ps5", input: "ps5-controller",
        imageUrl: "https://example.com/img.jpg",
        mode: "narrative", hours: "10", note: ""
      }],
      queue: [], caveats: [], decompression: [], yourCall: [], played: []
    };
    await request(app).post("/api/data").set(auth()).send({ games }).expect(200);
    const res = await request(app).get("/api/data").set(auth()).expect(200);
    const saved = res.body.games.inbox[0];
    expect(saved.platform).toBe("ps5");
    expect(saved.input).toBe("ps5-controller");
    expect(saved.imageUrl).toBe("https://example.com/img.jpg");
  });
});
