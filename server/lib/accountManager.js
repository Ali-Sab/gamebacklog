"use strict";

const INVALID_INTERNAL_MSG =
  "ACCOUNT_MANAGER_INTERNAL_URL must be an absolute http(s) URL, e.g. http://account-manager:3001";

/**
 * Resolve account-manager base URLs from an env object.
 * PUBLIC: browser/external-client facing. INTERNAL: server-to-server.
 * Both have trailing slashes removed. INTERNAL falls back to PUBLIC when unset/blank.
 * Throws Error("ACCOUNT_MANAGER_INTERNAL_URL must be an absolute http(s) URL, e.g. http://account-manager:3001")
 * when ACCOUNT_MANAGER_INTERNAL_URL is set but not an absolute http/https URL. The message never contains the value.
 * @param {Record<string, string|undefined>} env
 * @returns {{ PUBLIC: string, INTERNAL: string }}
 */
function resolveAccountManagerUrls(env) {
  const publicUrl = (env.ACCOUNT_MANAGER_URL || "http://localhost:3001").replace(/\/+$/, "");
  const rawInternal = (env.ACCOUNT_MANAGER_INTERNAL_URL || "").trim();
  if (!rawInternal) return { PUBLIC: publicUrl, INTERNAL: publicUrl };

  let u;
  try { u = new URL(rawInternal); } catch { throw new Error(INVALID_INTERNAL_MSG); }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
    throw new Error(INVALID_INTERNAL_MSG);
  }
  return { PUBLIC: publicUrl, INTERNAL: rawInternal.replace(/\/+$/, "") };
}

const { PUBLIC, INTERNAL } = resolveAccountManagerUrls(process.env);

module.exports = { PUBLIC, INTERNAL, resolveAccountManagerUrls };
