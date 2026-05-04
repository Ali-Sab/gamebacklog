"use strict";

const { doubleCsrf } = require("csrf-csrf");
const { JWT_SECRET }  = require("../lib/crypto");

const IS_PROD = process.env.NODE_ENV === "production";

const CSRF_SECRET = process.env.CSRF_SECRET || JWT_SECRET + ":csrf";

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => CSRF_SECRET,
  getSessionIdentifier: () => "default", // single-user app
  cookieName: IS_PROD ? "__Host-csrf" : "csrf",
  cookieOptions: { sameSite: "strict", secure: IS_PROD, httpOnly: false, path: "/" },
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  skipCsrfProtection: () => process.env.NODE_ENV === "test",
});

module.exports = { CSRF_SECRET, generateCsrfToken, doubleCsrfProtection };
