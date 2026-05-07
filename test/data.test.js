"use strict";

const os      = require("os");
const fs      = require("fs");
const path    = require("path");
const request = require("supertest");

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
process.env.DATA_DIR   = DATA_DIR;
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NODE_ENV   = "test";

const { app, computeTOTP } = require("../server/app");
const { setupAndLogin }    = require("./helpers");

let token;

beforeAll(async () => {
  const result = await setupAndLogin(request, app, computeTOTP);
  token = result.accessToken;
});

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

const auth = () => ({ Authorization: `Bearer ${token}` });

// ─── GET /api/data ────────────────────────────────────────────────────────────
describe("GET /api/data", () => {
  test("returns 401 without auth", async () => {
    await request(app).get("/api/data").expect(401);
  });

  test("returns { games: null, profile: null } on a fresh install", async () => {
    const res = await request(app).get("/api/data").set(auth()).expect(200);
    expect(res.body.games).toBeNull();
    expect(res.body.profile).toBeNull();
  });
});

// ─── POST /api/data ───────────────────────────────────────────────────────────
describe("POST /api/data", () => {
  test("returns 401 without auth", async () => {
    await request(app).post("/api/data").send({ games: {} }).expect(401);
  });

  test("saves games and returns ok", async () => {
    const games = { queue: [{ id: "q1", title: "Test Game", genre: "rpg", hours: "10", note: "" }], played: [] };
    const res = await request(app).post("/api/data").set(auth()).send({ games }).expect(200);
    expect(res.body.ok).toBe(true);
  });

  test("saves profile and returns ok", async () => {
    const res = await request(app)
      .post("/api/data")
      .set(auth())
      .send({ profile: [{ name: "CORE IDENTITY", text: "I love atmospheric games." }] })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────
describe("data round-trip", () => {
  const games = {
    inbox:         [],
    queue:         [{ id: "q1", title: "Hollow Knight", genre: "atmospheric", hours: "40", note: "Essential" }],
    caveats:       [],
    decompression: [],
    yourCall:      [],
    skip:          [],
    played:        [{ id: "p1", title: "SOMA", playedDate: "1/1/2024" }]
  };
  const profile = [{ name: "CORE IDENTITY", text: "I love atmospheric games." }];

  beforeAll(async () => {
    await request(app).post("/api/data").set(auth()).send({ games, profile });
  });

  test("GET /api/data returns exactly what was saved", async () => {
    const res = await request(app).get("/api/data").set(auth()).expect(200);
    expect(res.body.games).toEqual(games);
    expect(res.body.profile).toEqual(profile);
  });

  test("partial POST only updates provided fields", async () => {
    const newProfile = [{ name: "UPDATED", text: "Updated profile." }];
    await request(app).post("/api/data").set(auth()).send({ profile: newProfile });
    const res = await request(app).get("/api/data").set(auth());
    expect(res.body.games).toEqual(games); // unchanged
    expect(res.body.profile).toEqual(newProfile);
  });
});

// ─── POST /api/data validation ────────────────────────────────────────────────
describe("POST /api/data validation", () => {
  // Seed known-good state so we can verify rejected payloads don't corrupt it
  const goodGames = {
    inbox: [],
    queue: [{ id: "v1", title: "Validation Seed", genre: "rpg", hours: "5", note: "" }],
    caveats: [], decompression: [], yourCall: [], skip: [], played: []
  };
  const goodProfile = [{ name: "VALIDATION SEED", text: "baseline." }];

  beforeAll(async () => {
    await request(app).post("/api/data").set(auth()).send({ games: goodGames, profile: goodProfile });
  });

  async function expectStateUnchanged() {
    const res = await request(app).get("/api/data").set(auth());
    expect(res.body.games).toEqual(goodGames);
    expect(res.body.profile).toEqual(goodProfile);
  }

  test("rejects games: null", async () => {
    await request(app).post("/api/data").set(auth()).send({ games: null }).expect(400);
    await expectStateUnchanged();
  });

  test("rejects games as a string", async () => {
    await request(app).post("/api/data").set(auth()).send({ games: "oops" }).expect(400);
    await expectStateUnchanged();
  });

  test("rejects games as an array", async () => {
    await request(app).post("/api/data").set(auth()).send({ games: [] }).expect(400);
    await expectStateUnchanged();
  });

  test("rejects games with a non-array category", async () => {
    await request(app).post("/api/data").set(auth()).send({ games: { queue: "not-a-list" } }).expect(400);
    await expectStateUnchanged();
  });

  test("rejects profile as a non-array", async () => {
    await request(app).post("/api/data").set(auth()).send({ profile: 42 }).expect(400);
    await expectStateUnchanged();
  });

  test("empty body is a no-op (200, state preserved)", async () => {
    await request(app).post("/api/data").set(auth()).send({}).expect(200);
    await expectStateUnchanged();
  });
});

// ─── url field round-trip + inbox category ────────────────────────────────────
describe("url field and inbox category", () => {
  test("a game with url survives round-trip", async () => {
    const games = {
      inbox: [{ id: "u1", title: "Inbox Item", url: "https://store.steampowered.com/app/123" }],
      queue: [], caveats: [], decompression: [], yourCall: [], skip: [], played: []
    };
    await request(app).post("/api/data").set(auth()).send({ games }).expect(200);
    const res = await request(app).get("/api/data").set(auth());
    expect(res.body.games.inbox).toHaveLength(1);
    expect(res.body.games.inbox[0].url).toBe("https://store.steampowered.com/app/123");
  });

  test("readGames returns inbox key even when no games are in inbox", async () => {
    const games = {
      queue: [{ id: "q-only", title: "Only Queue", genre: "rpg", hours: "5", note: "" }],
      caveats: [], decompression: [], yourCall: [], skip: [], played: []
    };
    await request(app).post("/api/data").set(auth()).send({ games }).expect(200);
    const res = await request(app).get("/api/data").set(auth());
    expect(res.body.games.inbox).toEqual([]);
  });
});

// ─── /api/export ──────────────────────────────────────────────────────────────
describe("GET /api/export", () => {
  test("requires auth", async () => {
    await request(app).get("/api/export").expect(401);
  });

  test("returns a JSON snapshot with attachment headers", async () => {
    const res = await request(app).get("/api/export").set(auth()).expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-disposition"]).toMatch(/attachment.*gamebacklog-.*\.json/);
    const body = JSON.parse(res.text);
    expect(body).toHaveProperty("exportedAt");
    expect(body).toHaveProperty("games");
    expect(body).toHaveProperty("profile");
  });
});

// ─── /api/import ──────────────────────────────────────────────────────────────
describe("POST /api/import", () => {
  test("requires auth", async () => {
    await request(app).post("/api/import").send({ games: {} }).expect(401);
  });

  test("rejects payload missing games", async () => {
    await request(app).post("/api/import").set(auth()).send({ profile: [] }).expect(400);
  });

  test("rejects games with non-array category", async () => {
    await request(app).post("/api/import").set(auth())
      .send({ games: { queue: "oops" }, profile: [] }).expect(400);
  });

  test("replaces all data on success", async () => {
    const games = {
      inbox: [{ id: "imp1", title: "Imported Game", url: "https://example.com" }],
      queue: [], caveats: [], decompression: [], yourCall: [], skip: [], played: []
    };
    const importedProfile = [{ name: "IMPORTED PROFILE", text: "hello." }];
    await request(app).post("/api/import").set(auth())
      .send({ games, profile: importedProfile }).expect(200);
    const res = await request(app).get("/api/data").set(auth());
    expect(res.body.games.inbox[0].title).toBe("Imported Game");
    expect(res.body.games.inbox[0].url).toBe("https://example.com");
    expect(res.body.profile).toEqual(importedProfile);
  });
});
