"use strict";

const os   = require("os");
const fs   = require("fs");
const path = require("path");

// Isolate this test file's DATA_DIR before requiring the module
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
process.env.DATA_DIR    = DATA_DIR;
process.env.JWT_SECRET  = "test-jwt-secret";
process.env.NODE_ENV    = "test";

const { computeTOTP, verifyTOTP, generateSecret, hashPassword } = require("../server/server");

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

// ─── generateSecret ───────────────────────────────────────────────────────────
describe("generateSecret", () => {
  test("returns a 32-character string", () => {
    expect(generateSecret()).toHaveLength(32);
  });

  test("only contains valid base32 characters", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  test("produces different values each call", () => {
    const a = generateSecret();
    const b = generateSecret();
    // Astronomically unlikely to collide
    expect(a).not.toBe(b);
  });
});

// ─── computeTOTP ─────────────────────────────────────────────────────────────
describe("computeTOTP", () => {
  test("returns a zero-padded 6-digit string", () => {
    const secret = generateSecret();
    const code = computeTOTP(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  test("same secret + offset yields same code", () => {
    const secret = generateSecret();
    expect(computeTOTP(secret, 0)).toBe(computeTOTP(secret, 0));
  });

  test("adjacent time windows produce different codes (usually)", () => {
    // This has a 1-in-1,000,000 chance of failing — acceptable
    const secret = generateSecret();
    const curr = computeTOTP(secret, 0);
    const next = computeTOTP(secret, 1);
    const prev = computeTOTP(secret, -1);
    // At least one of the adjacent windows must differ from current
    expect(curr !== next || curr !== prev).toBe(true);
  });
});

// ─── verifyTOTP ───────────────────────────────────────────────────────────────
describe("verifyTOTP", () => {
  test("accepts the current time window code", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, computeTOTP(secret))).toBe(true);
  });

  test("accepts the previous time window (clock drift tolerance)", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, computeTOTP(secret, -1))).toBe(true);
  });

  test("accepts the next time window (clock drift tolerance)", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, computeTOTP(secret, 1))).toBe(true);
  });

  test("rejects a clearly wrong code", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, "000000")).toBe(
      // only fails if 000000 actually happens to be valid right now
      computeTOTP(secret, -1) === "000000" ||
      computeTOTP(secret,  0) === "000000" ||
      computeTOTP(secret,  1) === "000000"
    );
  });

  test("rejects codes that are not 6 digits", () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, "12345")).toBe(false);
    expect(verifyTOTP(secret, "1234567")).toBe(false);
    expect(verifyTOTP(secret, "")).toBe(false);
    expect(verifyTOTP(secret, "abcdef")).toBe(false);
  });

  test("strips whitespace before checking", () => {
    const secret = generateSecret();
    const code = computeTOTP(secret);
    expect(verifyTOTP(secret, ` ${code} `)).toBe(true);
  });
});

// ─── hashPassword ─────────────────────────────────────────────────────────────
describe("hashPassword", () => {
  test("returns a 128-character hex string", async () => {
    const hash = await hashPassword("mypassword", "mysalt");
    expect(hash).toMatch(/^[0-9a-f]{128}$/);
  });

  test("same password + salt always yields the same hash", async () => {
    const a = await hashPassword("password", "salt");
    const b = await hashPassword("password", "salt");
    expect(a).toBe(b);
  });

  test("different passwords produce different hashes", async () => {
    const a = await hashPassword("password1", "salt");
    const b = await hashPassword("password2", "salt");
    expect(a).not.toBe(b);
  });

  test("different salts produce different hashes", async () => {
    const a = await hashPassword("password", "salt1");
    const b = await hashPassword("password", "salt2");
    expect(a).not.toBe(b);
  });
});
