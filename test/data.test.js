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
    expect(res.body).toEqual({ games: null, profile: null });
  });
});

// ─── POST /api/data ───────────────────────────────────────────────────────────
describe("POST /api/data", () => {
  test("returns 401 without auth", async () => {
    await request(app).post("/api/data").send({ games: {} }).expect(401);
  });

  test("saves games and returns ok", async () => {
    const games = { queue: [{ id: "q1", title: "Test Game", mode: "rpg", hours: "10", note: "" }], played: [] };
    const res = await request(app).post("/api/data").set(auth()).send({ games }).expect(200);
    expect(res.body.ok).toBe(true);
  });

  test("saves profile and returns ok", async () => {
    const res = await request(app)
      .post("/api/data")
      .set(auth())
      .send({ profile: "My taste profile text." })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────
describe("data round-trip", () => {
  const games = {
    queue:         [{ id: "q1", title: "Hollow Knight", mode: "atmospheric", hours: "40", note: "Essential" }],
    caveats:       [],
    decompression: [],
    yourCall:      [],
    played:        [{ id: "p1", title: "SOMA", playedDate: "1/1/2024" }]
  };
  const profile = "CORE IDENTITY\nI love atmospheric games.";

  beforeAll(async () => {
    await request(app).post("/api/data").set(auth()).send({ games, profile });
  });

  test("GET /api/data returns exactly what was saved", async () => {
    const res = await request(app).get("/api/data").set(auth()).expect(200);
    expect(res.body.games).toEqual(games);
    expect(res.body.profile).toBe(profile);
  });

  test("partial POST only updates provided fields", async () => {
    const newProfile = "Updated profile.";
    await request(app).post("/api/data").set(auth()).send({ profile: newProfile });
    const res = await request(app).get("/api/data").set(auth());
    expect(res.body.games).toEqual(games); // unchanged
    expect(res.body.profile).toBe(newProfile);
  });
});
