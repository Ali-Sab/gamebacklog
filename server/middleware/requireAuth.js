"use strict";

const { verifyAccess } = require("../lib/crypto");

function requireAuth(req, res, next) {
  // Accept token from Authorization header or httpOnly accessToken cookie
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : req.cookies?.accessToken;
  if (!token) return res.status(401).json({ error: "No token" });
  const payload = verifyAccess(token);
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
  req.user = payload.sub;
  req.isAdmin = payload.admin === true; // account-manager sets this for its admin only
  next();
}

module.exports = requireAuth;
