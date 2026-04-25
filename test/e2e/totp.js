"use strict";

// Self-contained TOTP implementation (RFC 6238) — no server.js dependency
const crypto = require("crypto");

function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const i = A.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function computeTOTP(secret, offset = 0) {
  const key = base32Decode(secret);
  const counter = BigInt(Math.floor(Date.now() / 30000) + offset);
  const buf = Buffer.alloc(8);
  let t = counter;
  for (let i = 7; i >= 0; i--) { buf[i] = Number(t & 0xffn); t >>= 8n; }
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0xf;
  const n = ((hmac[o] & 0x7f) << 24) | ((hmac[o+1] & 0xff) << 16) |
            ((hmac[o+2] & 0xff) << 8) | (hmac[o+3] & 0xff);
  return String(n % 1_000_000).padStart(6, "0");
}

module.exports = { computeTOTP };
