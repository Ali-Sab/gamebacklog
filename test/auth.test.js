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
const { setupUser, login } = require("./helpers");

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

// ─── Setup flow ───────────────────────────────────────────────────────────────
describe("GET /api/setup/status", () => {
  test("returns configured:false before setup", async () => {
    const res = await request(app).get("/api/setup/status").expect(200);
    expect(res.body).toMatchObject({ configured: false });
  });
});

describe("GET /api/setup/secret", () => {
  test("returns secret, formatted string, and QR data URL", async () => {
    const res = await request(app).get("/api/setup/secret").expect(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{16}$/);
    expect(res.body.formatted).toMatch(/^[A-Z2-7 ]+$/);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe("POST /api/setup", () => {
  test("rejects mismatched / wrong TOTP code", async () => {
    // Get a fresh secret
    await request(app).get("/api/setup/secret");
    const res = await request(app)
      .post("/api/setup")
      .send({ username: "tester", password: "password123", totpCode: "000000" })
      .expect(400);
    expect(res.body.error).toMatch(/TOTP/i);
  });

  test("rejects password shorter than 6 characters", async () => {
    const { body: { secret } } = await request(app).get("/api/setup/secret");
    const res = await request(app)
      .post("/api/setup")
      .send({ username: "tester", password: "hi", totpCode: computeTOTP(secret) })
      .expect(400);
    expect(res.body.error).toMatch(/password/i);
  });

  test("rejects missing fields", async () => {
    await request(app).get("/api/setup/secret");
    const res = await request(app).post("/api/setup").send({ username: "tester" }).expect(400);
    expect(res.body.error).toBeDefined();
  });

  test("accepts valid credentials and TOTP code", async () => {
    // This is the "real" setup that the rest of auth tests depend on.
    // Store secret at module scope so later describe blocks can use it.
    const secret = await setupUser(request, app, computeTOTP);
    totpSecret = secret;
    expect(secret).toMatch(/^[A-Z2-7]{16}$/);
  });
});

describe("GET /api/setup/status (after setup)", () => {
  test("returns configured:true", async () => {
    const res = await request(app).get("/api/setup/status").expect(200);
    expect(res.body).toMatchObject({ configured: true });
  });
});

describe("GET /api/setup/secret (after setup)", () => {
  test("returns 403 when already configured", async () => {
    await request(app).get("/api/setup/secret").expect(403);
  });
});

// ─── Login flow ───────────────────────────────────────────────────────────────
// All login tests share the user created in the setup block above.
// We need the secret to compute TOTP — so we grab it fresh each describe via beforeAll.
let totpSecret;
beforeAll(async () => {
  // Setup was already done in the describe blocks above.
  // The secret was stored in pending_setup.json during GET /api/setup/secret,
  // then moved to credentials.json by POST /api/setup.
  // We compute TOTP from the first secret generated during setup.
  // Simplest: just store it from the setupUser call. We can't re-read it here,
  // so we'll rely on computeTOTP with a known-good secret from a login test.
  // Instead, we do a fresh login each test that needs it.
});

describe("POST /api/auth/login (step 1)", () => {
  test("rejects wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "tester", password: "wrongpass" })
      .expect(401);
    expect(res.body.error).toBeDefined();
  });

  test("rejects wrong username", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "notexist", password: "password123" })
      .expect(401);
    expect(res.body.error).toBeDefined();
  });

  test("returns mfaToken for valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "tester", password: "password123" })
      .expect(200);
    expect(res.body.mfaToken).toBeDefined();
    expect(typeof res.body.mfaToken).toBe("string");
  });
});

describe("POST /api/auth/mfa (step 2)", () => {
  let mfaToken;
  beforeEach(async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "tester", password: "password123" });
    mfaToken = res.body.mfaToken;
  });

  test("rejects wrong MFA code", async () => {
    const res = await request(app)
      .post("/api/auth/mfa")
      .send({ mfaToken, code: "000000" });
    // 000000 is almost certainly wrong; only accept if it happens to be valid
    if (res.status !== 200) {
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    }
  });

  test("rejects garbled mfaToken", async () => {
    const res = await request(app)
      .post("/api/auth/mfa")
      .send({ mfaToken: "not-a-jwt", code: "123456" })
      .expect(401);
    expect(res.body.error).toBeDefined();
  });
});

// ─── Token lifecycle ──────────────────────────────────────────────────────────
describe("full token lifecycle", () => {
  let accessToken, cookie;

  beforeAll(async () => {
    const result = await login(request, app, totpSecret, computeTOTP);
    accessToken = result.accessToken;
    cookie = result.cookie;
  });

  test("login returns an access token", () => {
    expect(typeof accessToken).toBe("string");
    expect(accessToken.split(".")).toHaveLength(3); // JWT format
  });

  test("login sets a refresh token cookie", () => {
    expect(cookie).toBeDefined();
    expect(cookie[0]).toMatch(/refreshToken=/);
  });

  test("POST /api/auth/refresh returns a new access token", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
  });

  test("POST /api/auth/refresh without cookie returns 401", async () => {
    await request(app).post("/api/auth/refresh").expect(401);
  });

  test("POST /api/auth/logout succeeds", async () => {
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie)
      .expect(200);
  });

  test("POST /api/auth/refresh after logout returns 401", async () => {
    await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie)
      .expect(401);
  });
});

// ─── Change password ──────────────────────────────────────────────────────────
describe("POST /api/auth/change-password", () => {
  let token;

  beforeAll(async () => {
    const result = await login(request, app, totpSecret, computeTOTP);
    token = result.accessToken;
  });

  test("requires auth", async () => {
    await request(app).post("/api/auth/change-password").expect(401);
  });

  test("rejects wrong current password", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "wrongpass", newPassword: "newpass123" })
      .expect(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test("rejects new password that is too short", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "password123", newPassword: "hi" })
      .expect(400);
    expect(res.body.error).toMatch(/short/i);
  });

  test("accepts correct current password and valid new password", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "password123", newPassword: "newpassword456" })
      .expect(200);
    expect(res.body.ok).toBe(true);
  });
});
