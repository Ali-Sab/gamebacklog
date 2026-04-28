"use strict";

// Pure-Node TOTP implementation used in Jest tests only.
// Replaces otplib (which pulls in @scure/base, an ESM-only package that Jest cannot parse).
// Mirrors the functional API used in server.js: generateSync, verifySync, generateSecret.

const crypto = require("crypto");

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(str) {
  const s = str.toUpperCase().replace(/=+$/, "");
  let bits = 0, val = 0;
  const bytes = [];
  for (const c of s) {
    const idx = CHARS.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[19] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1_000_000;
  return String(code).padStart(6, "0");
}

function totp(secret, epochSec) {
  const T = Math.floor(epochSec / 30);
  return hotp(base32Decode(secret), T);
}

// generateSecret(n) — n is bytes; returns ceil(n * 8 / 5) base32 chars (matching real otplib)
function generateSecret(n = 20) {
  const charLen = Math.ceil(n * 8 / 5);
  return Array.from(crypto.randomBytes(charLen), b => CHARS[b % 32]).join("");
}

// generateSync({secret, epoch?}) — epoch in seconds; default = now
function generateSync({ secret, epoch } = {}) {
  const epochSec = epoch !== undefined ? epoch : Math.floor(Date.now() / 1000);
  return totp(secret, epochSec);
}

// verifySync({secret, token, epochTolerance?}) — epochTolerance in seconds
function verifySync({ secret, token, epochTolerance = 0 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const steps = Math.ceil(epochTolerance / 30);
  for (let w = -steps; w <= steps; w++) {
    if (totp(secret, now + w * 30) === token) return { valid: true, delta: w };
  }
  return { valid: false };
}

module.exports = { generateSync, verifySync, generateSecret };
