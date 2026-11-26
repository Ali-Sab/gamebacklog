"use strict";

process.env.NODE_ENV = "test";

const os           = require("os");
const fs           = require("fs");
const path         = require("path");
const crypto       = require("crypto");
const express      = require("express");
const cookieParser = require("cookie-parser");
const jwt          = require("jsonwebtoken");
const request      = require("supertest");
// helpers sets PUBLIC_KEY_PATH at load
const { setupAndLogin } = require("./helpers");

const PUB = "https://pub.example/accounts";
const INT = "http://am-internal:3001";
const MSG = "ACCOUNT_MANAGER_INTERNAL_URL must be an absolute http(s) URL, e.g. http://account-manager:3001";

const KEYS = [
  "ACCOUNT_MANAGER_URL", "ACCOUNT_MANAGER_INTERNAL_URL", "PUBLIC_KEY_PATH",
  "OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "OAUTH_REDIRECT_URI",
  "GAMEBACKLOG_CLIENT_ID", "GAMEBACKLOG_CLIENT_SECRET", "GAMEBACKLOG_REDIRECT_URI",
  "DATA_DIR",
];

let envSnapshot;
let fetchSnapshot;

beforeEach(() => {
  envSnapshot = {};
  for (const k of KEYS) envSnapshot[k] = process.env[k];
  fetchSnapshot = globalThis.fetch;
  jest.resetModules();
});

afterEach(() => {
  for (const k of KEYS) {
    if (envSnapshot[k] === undefined) delete process.env[k];
    else process.env[k] = envSnapshot[k];
  }
  globalThis.fetch = fetchSnapshot;
  jest.restoreAllMocks();
  jest.dontMock("../server/db");
  jest.resetModules();
});

// ─── helpers ──────────────────────────────────────────────────────────────────
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// table maps exact URL -> () => response. Unknown URL -> network error.
function mockFetch(table = {}) {
  globalThis.fetch = jest.fn(async (url) => {
    const h = table[String(url)];
    if (!h) throw new TypeError("fetch failed");
    return h();
  });
  return globalThis.fetch;
}

const flush = () => new Promise(r => setImmediate(r));

function loadIsolated(modPath, setup) {
  let m;
  jest.isolateModules(() => {
    if (setup) setup();
    m = require(modPath);
  });
  return m;
}

function setEnv(env) {
  for (const k of ["ACCOUNT_MANAGER_URL", "ACCOUNT_MANAGER_INTERNAL_URL"]) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function resolve(env) {
  setEnv({});
  const { resolveAccountManagerUrls } = loadIsolated("../server/lib/accountManager");
  return resolveAccountManagerUrls(env);
}

function thrownMessage(fn) {
  try { fn(); } catch (e) { return e.message; }
  throw new Error("expected function to throw");
}

// ─── resolveAccountManagerUrls ────────────────────────────────────────────────
describe("resolveAccountManagerUrls", () => {
  test("defaults both to http://localhost:3001", () => {
    expect(resolve({})).toEqual({ PUBLIC: "http://localhost:3001", INTERNAL: "http://localhost:3001" });
  });

  test("strips trailing slashes from PUBLIC and INTERNAL falls back to it", () => {
    expect(resolve({ ACCOUNT_MANAGER_URL: PUB + "/" })).toEqual({ PUBLIC: PUB, INTERNAL: PUB });
    expect(resolve({ ACCOUNT_MANAGER_URL: PUB + "///" })).toEqual({ PUBLIC: PUB, INTERNAL: PUB });
  });

  test("uses a distinct INTERNAL and strips its trailing slash", () => {
    expect(resolve({ ACCOUNT_MANAGER_URL: PUB, ACCOUNT_MANAGER_INTERNAL_URL: INT + "/" }))
      .toEqual({ PUBLIC: PUB, INTERNAL: INT });
    expect(resolve({ ACCOUNT_MANAGER_URL: PUB, ACCOUNT_MANAGER_INTERNAL_URL: INT + "//" }))
      .toEqual({ PUBLIC: PUB, INTERNAL: INT });
  });

  test("INTERNAL set but PUBLIC unset: PUBLIC keeps its default", () => {
    expect(resolve({ ACCOUNT_MANAGER_INTERNAL_URL: INT }))
      .toEqual({ PUBLIC: "http://localhost:3001", INTERNAL: INT });
  });

  test.each([["empty", ""], ["whitespace", "   "]])("%s INTERNAL falls back to PUBLIC", (_n, v) => {
    expect(resolve({ ACCOUNT_MANAGER_URL: PUB, ACCOUNT_MANAGER_INTERNAL_URL: v }))
      .toEqual({ PUBLIC: PUB, INTERNAL: PUB });
  });

  test("surrounding whitespace on INTERNAL is trimmed", () => {
    expect(resolve({ ACCOUNT_MANAGER_URL: PUB, ACCOUNT_MANAGER_INTERNAL_URL: " " + INT + " " }).INTERNAL).toBe(INT);
  });

  test("https INTERNAL is accepted", () => {
    expect(resolve({ ACCOUNT_MANAGER_INTERNAL_URL: "https://am.internal:8443" }).INTERNAL)
      .toBe("https://am.internal:8443");
  });

  test.each([
    ["no-scheme typo", "account-manager:3001"],
    ["non-http scheme", "ftp://am"],
    ["no host", "http://"],
    ["not a url", "not a url"],
    ["bare host", "account-manager"],
  ])("rejects %s with the exact message", (_n, bad) => {
    const env = { ACCOUNT_MANAGER_URL: PUB, ACCOUNT_MANAGER_INTERNAL_URL: bad };
    expect(() => resolve(env)).toThrow(/ACCOUNT_MANAGER_INTERNAL_URL must be an absolute http\(s\) URL/);
    expect(thrownMessage(() => resolve(env))).toBe(MSG);
  });

  test("error message never contains the rejected value (credentials in URL)", () => {
    const msg = thrownMessage(() =>
      resolve({ ACCOUNT_MANAGER_INTERNAL_URL: "ftp://u:s3cret@am" }));
    expect(msg).toBe(MSG);
    expect(msg).not.toContain("s3cret");
    expect(msg).not.toContain("u:");
  });

  test("module-level PUBLIC/INTERNAL are computed from process.env at require time", () => {
    setEnv({ ACCOUNT_MANAGER_URL: PUB + "/", ACCOUNT_MANAGER_INTERNAL_URL: INT + "/" });
    const m = loadIsolated("../server/lib/accountManager");
    expect(m.PUBLIC).toBe(PUB);
    expect(m.INTERNAL).toBe(INT);
  });

  test("requiring the module with an invalid INTERNAL throws at startup", () => {
    setEnv({ ACCOUNT_MANAGER_INTERNAL_URL: "account-manager:3001" });
    expect(() => loadIsolated("../server/lib/accountManager")).toThrow(/ACCOUNT_MANAGER_INTERNAL_URL/);
  });
});

// ─── preloadPublicKey ─────────────────────────────────────────────────────────
describe("preloadPublicKey", () => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const sign = (claims, key = pair.privateKey) => jwt.sign(claims, key, { algorithm: "RS256" });

  function loadCrypto(env) {
    delete process.env.PUBLIC_KEY_PATH;
    setEnv({ ACCOUNT_MANAGER_URL: PUB, ...env });
    return loadIsolated("../server/lib/crypto");
  }

  test("fetches JWKS from INTERNAL (once, exact URL) and verifies a gamebacklog token", async () => {
    const f = mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [jwk] }) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await expect(c.preloadPublicKey()).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(INT + "/.well-known/jwks.json");
    expect(c.verifyAccess(sign({ sub: "u1", aud: "gamebacklog" })).sub).toBe("u1");
  });

  test("never contacts the public host when INTERNAL is set", async () => {
    const f = mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [jwk] }) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await c.preloadPublicKey();
    for (const call of f.mock.calls) expect(String(call[0])).not.toMatch(/^https:\/\/pub\.example/);
  });

  test("falls back to PUBLIC when INTERNAL is unset", async () => {
    const f = mockFetch({ [PUB + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [jwk] }) });
    const c = loadCrypto({});
    await c.preloadPublicKey();
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(PUB + "/.well-known/jwks.json");
  });

  test("network error rejects with 'fetch failed'", async () => {
    mockFetch({});
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await expect(c.preloadPublicKey()).rejects.toThrow(/fetch failed/);
  });

  test("HTTP 503 rejects with the status", async () => {
    mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({}, 503) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await expect(c.preloadPublicKey()).rejects.toThrow(/503/);
  });

  test("empty key set rejects", async () => {
    mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [] }) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await expect(c.preloadPublicKey()).rejects.toThrow(/No keys/);
  });

  test("aud is still enforced: mcp token rejected by verifyAccess, accepted by verifyMcpToken", async () => {
    mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [jwk] }) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await c.preloadPublicKey();
    const mcp = sign({ sub: "u1", aud: "mcp" });
    expect(c.verifyAccess(mcp)).toBeNull();
    expect(c.verifyMcpToken(mcp)).toMatchObject({ sub: "u1" });
    expect(c.verifyMcpToken(sign({ sub: "u1", aud: "gamebacklog" }))).toBeNull();
  });

  test("a token signed by a different key is rejected", async () => {
    mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [jwk] }) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await c.preloadPublicKey();
    expect(c.verifyAccess(sign({ sub: "u1", aud: "gamebacklog" }, other.privateKey))).toBeNull();
  });

  test("non-RS256 (HS256) token is rejected", async () => {
    mockFetch({ [INT + "/.well-known/jwks.json"]: () => jsonResponse({ keys: [jwk] }) });
    const c = loadCrypto({ ACCOUNT_MANAGER_INTERNAL_URL: INT });
    await c.preloadPublicKey();
    const hs = jwt.sign({ sub: "u1", aud: "gamebacklog" }, "secret", { algorithm: "HS256" });
    expect(c.verifyAccess(hs)).toBeNull();
  });
});

// ─── auth router ──────────────────────────────────────────────────────────────
describe("auth router", () => {
  const REDIRECT = "https://pub.example/gamebacklog/auth/callback";
  const DISCOVERY = "/.well-known/oauth-authorization-server";

  async function loadAuth(opts = {}) {
    const table = opts.table || {};
    const internal = "internal" in opts ? opts.internal : INT;
    setEnv({
      ACCOUNT_MANAGER_URL: PUB,
      ACCOUNT_MANAGER_INTERNAL_URL: internal,
      OAUTH_CLIENT_ID: "gamebacklog-web",
      OAUTH_CLIENT_SECRET: "s",
      OAUTH_REDIRECT_URI: REDIRECT,
    });
    const f = mockFetch(table);
    const router = loadIsolated("../server/routes/auth");
    await flush();
    await flush();
    const app = express();
    app.use(cookieParser());
    app.use("/", router);
    return { app, f };
  }

  const discoveryWith = (endSession) => ({
    [INT + DISCOVERY]: () => jsonResponse(endSession === undefined ? {} : { end_session_endpoint: endSession }),
  });

  const logoutUrl = async (app) => (await request(app).post("/auth/logout").expect(200)).body.endSessionUrl;

  test("/auth/login redirects the browser to PUBLIC /authorize, not INTERNAL", async () => {
    const { app } = await loadAuth();
    const res = await request(app).get("/auth/login").expect(302);
    expect(res.headers.location.startsWith(PUB + "/authorize?")).toBe(true);
    expect(res.headers.location).not.toContain("am-internal");
  });

  test("discovery is fetched from INTERNAL", async () => {
    const { f } = await loadAuth({ table: discoveryWith(PUB + "/logout") });
    expect(f.mock.calls.map(c => String(c[0]))).toContain(INT + DISCOVERY);
    expect(f.mock.calls.map(c => String(c[0]))).not.toContain(PUB + DISCOVERY);
  });

  test("logout: public end_session_endpoint is kept", async () => {
    const { app } = await loadAuth({ table: discoveryWith(PUB + "/logout") });
    expect((await logoutUrl(app)).startsWith(PUB + "/logout?post_logout_redirect_uri=")).toBe(true);
  });

  test("logout: docker-internal end_session_endpoint is rebased onto PUBLIC", async () => {
    const { app } = await loadAuth({ table: discoveryWith("http://account-manager:3001/accounts/logout") });
    const url = await logoutUrl(app);
    expect(url.startsWith("https://pub.example/accounts/logout?")).toBe(true);
    expect(url).not.toContain("account-manager:3001");
    expect(url).not.toContain("am-internal");
  });

  test("logout: discovery fetch failure falls back to PUBLIC /logout, never INTERNAL", async () => {
    const { app } = await loadAuth({ table: {} });
    const url = await logoutUrl(app);
    expect(url.startsWith("https://pub.example/accounts/logout?")).toBe(true);
    expect(url).not.toContain("am-internal");
  });

  test("logout: discovery without end_session_endpoint falls back to PUBLIC /logout", async () => {
    const { app } = await loadAuth({ table: discoveryWith(undefined) });
    const url = await logoutUrl(app);
    expect(url.startsWith(PUB + "/logout?")).toBe(true);
    expect(url).not.toContain("am-internal");
  });

  test("logout: includes post_logout_redirect_uri derived from the redirect URI origin", async () => {
    const { app } = await loadAuth({ table: discoveryWith(PUB + "/logout") });
    const url = new URL(await logoutUrl(app));
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://pub.example/auth/login");
  });

  describe("callback token exchange", () => {
    const cookie = "pkce=" + encodeURIComponent(JSON.stringify({ verifier: "v", state: "s" }));
    const tokenTable = (base) => ({ [base + "/token"]: () => jsonResponse({ access_token: "tok" }) });

    test("POSTs the code exchange to INTERNAL and sets the access token cookie", async () => {
      const { app, f } = await loadAuth({ table: { ...discoveryWith(PUB + "/logout"), ...tokenTable(INT) } });
      const res = await request(app).get("/auth/callback?code=c&state=s").set("Cookie", cookie).expect(302);
      expect(res.headers.location).toBe("/gamebacklog/");
      expect(res.headers["set-cookie"].join(";")).toContain("accessToken=tok");
      expect(f).toHaveBeenCalledWith(INT + "/token", expect.objectContaining({ method: "POST" }));
    });

    test("client secret is never sent to the public host", async () => {
      const { app, f } = await loadAuth({ table: { ...discoveryWith(PUB + "/logout"), ...tokenTable(INT) } });
      await request(app).get("/auth/callback?code=c&state=s").set("Cookie", cookie).expect(302);
      const urls = f.mock.calls.map(c => String(c[0]));
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(u.startsWith("https://pub.example")).toBe(false);
      const tokenCall = f.mock.calls.find(c => String(c[0]) === INT + "/token");
      expect(String(tokenCall[1].body)).toContain("client_secret=s");
    });

    test("falls back to PUBLIC /token when INTERNAL is unset", async () => {
      const { app, f } = await loadAuth({ internal: undefined, table: tokenTable(PUB) });
      await request(app).get("/auth/callback?code=c&state=s").set("Cookie", cookie).expect(302);
      expect(f).toHaveBeenCalledWith(PUB + "/token", expect.objectContaining({ method: "POST" }));
    });

    test("falls back to PUBLIC discovery when INTERNAL is unset", async () => {
      const { f } = await loadAuth({ internal: undefined, table: {} });
      expect(f.mock.calls.map(c => String(c[0]))).toContain(PUB + DISCOVERY);
    });

    test("state mismatch does not call /token", async () => {
      const { app, f } = await loadAuth({ table: tokenTable(INT) });
      f.mockClear();
      const res = await request(app).get("/auth/callback?code=c&state=WRONG").set("Cookie", cookie).expect(302);
      expect(res.headers.location).toContain("auth_error=state_mismatch");
      expect(f).not.toHaveBeenCalled();
    });
  });
});

// ─── /api/mcp-url ─────────────────────────────────────────────────────────────
describe("GET /api/mcp-url", () => {
  function loadData(opts = {}) {
    const table = opts.table || {};
    const internal = "internal" in opts ? opts.internal : INT;
    setEnv({
      ACCOUNT_MANAGER_URL: PUB,
      ACCOUNT_MANAGER_INTERNAL_URL: internal,
      OAUTH_CLIENT_ID: "gamebacklog-web",
      OAUTH_CLIENT_SECRET: "s",
      OAUTH_REDIRECT_URI: "https://pub.example/gamebacklog/auth/callback",
    });
    const f = mockFetch(table);
    const router = loadIsolated("../server/routes/data", () => {
      jest.doMock("../server/db", () => ({
        db: { transaction: fn => fn },
        readGames: () => null,
        writeGames: () => {},
        readProfile: () => null,
        writeProfile: () => {},
      }));
    });
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return { app, f };
  }
  const mcpTable = (base) => ({
    [base + "/api/mcp-client"]: () => jsonResponse({ client_id: "mcp-id", client_secret: "mcp-sec" }),
  });
  const bearer = () => ({ Authorization: `Bearer ${setupAndLogin().accessToken}` });

  test("POSTs to INTERNAL /api/mcp-client; response accountManagerUrl is PUBLIC", async () => {
    const { app, f } = loadData({ table: mcpTable(INT) });
    const res = await request(app).get("/api/mcp-url").set(bearer()).expect(200);
    expect(res.body.accountManagerUrl).toBe(PUB);
    expect(res.body.clientId).toBe("mcp-id");
    expect(res.body.clientSecret).toBe("mcp-sec");
    expect(f).toHaveBeenCalledWith(INT + "/api/mcp-client", expect.objectContaining({ method: "POST" }));
  });

  test("basic-auth client credentials only go to INTERNAL, never the public host", async () => {
    const { app, f } = loadData({ table: mcpTable(INT) });
    await request(app).get("/api/mcp-url").set(bearer()).expect(200);
    for (const c of f.mock.calls) expect(String(c[0]).startsWith("https://pub.example")).toBe(false);
    const headers = f.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Basic " + Buffer.from("gamebacklog-web:s").toString("base64"));
  });

  test("falls back to PUBLIC /api/mcp-client when INTERNAL is unset", async () => {
    const { app, f } = loadData({ internal: undefined, table: mcpTable(PUB) });
    const res = await request(app).get("/api/mcp-url").set(bearer()).expect(200);
    expect(f).toHaveBeenCalledWith(PUB + "/api/mcp-client", expect.objectContaining({ method: "POST" }));
    expect(res.body.accountManagerUrl).toBe(PUB);
    expect(res.body.clientId).toBe("mcp-id");
  });

  test("returns 401 without auth and makes no fetch", async () => {
    const { app, f } = loadData({ table: mcpTable(INT) });
    await request(app).get("/api/mcp-url").expect(401);
    expect(f).not.toHaveBeenCalled();
  });
});

// ─── app.js protected-resource metadata ───────────────────────────────────────
describe("protected-resource metadata", () => {
  test("authorization_servers is the raw public ACCOUNT_MANAGER_URL, not INTERNAL", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gamebacklog-test-"));
    try {
      setEnv({
        ACCOUNT_MANAGER_URL: PUB + "/", // raw value, trailing slash must survive untouched
        ACCOUNT_MANAGER_INTERNAL_URL: INT,
        DATA_DIR: dataDir,
      });
      mockFetch({});
      const { app } = loadIsolated("../server/app");
      await flush();
      const res = await request(app).get("/.well-known/oauth-protected-resource/mcp").expect(200);
      expect(res.body.authorization_servers).toEqual([PUB + "/"]);
      expect(JSON.stringify(res.body)).not.toContain("am-internal");
    } finally {
      jest.resetModules();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
