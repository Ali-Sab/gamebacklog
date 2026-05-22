let _accessToken: string | null = null;
let _fetching = false;

export function setAccessToken(t: string | null) { _accessToken = t; }
export function getAccessToken() { return _accessToken; }

const ACCOUNT_MANAGER_URL = import.meta.env.VITE_ACCOUNT_MANAGER_URL || "";

export function redirectToLogin() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  window.location.href = `${base}/auth/login`;
}

export async function api(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
  _isRetry = false,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && _accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const url  = path.startsWith("/") ? `${base}${path}` : path;
  const res  = await fetch(url, {
    method,
    headers,
    credentials: "include",
    body: body != null ? JSON.stringify(body) : undefined,
  });

  // On 401, try fetching a fresh token from the cookie once, then redirect to login
  if (res.status === 401 && auth && !_isRetry && !_fetching) {
    _fetching = true;
    try {
      const sessionRes = await fetch(`${base}/auth/session`, { credentials: "include" });
      if (sessionRes.ok) {
        const data = await sessionRes.json() as { accessToken?: string };
        if (data.accessToken) {
          _accessToken = data.accessToken;
          _fetching = false;
          return api(method, path, body, auth, true);
        }
      }
    } catch { /* fall through */ }
    _fetching = false;
    redirectToLogin();
    return {};
  }

  if (!res.ok && !res.headers.get("content-type")?.includes("application/json")) {
    return { error: `Server error ${res.status}` };
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export function getAccountManagerUrl() {
  return ACCOUNT_MANAGER_URL;
}
