import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setAccessToken, redirectToLogin } from "../api";

type Screen = "loading" | "main";

interface AuthContextValue {
  currentScreen: Screen;
  username: string | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, onMain }: { children: ReactNode; onMain: () => void }) {
  const [currentScreen, setCurrentScreen] = useState<Screen>("loading");
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => { boot(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function boot() {
    try {
      // Retrieve access token stored in the httpOnly cookie via the session endpoint
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res  = await fetch(`${base}/auth/session`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as { accessToken?: string };
        if (data.accessToken) {
          setAccessToken(data.accessToken);
          try {
            const me = await api("GET", "/api/me") as { username?: string };
            setUsername(me.username ?? null);
          } catch { /* non-fatal — cosmetic only */ }
          setCurrentScreen("main");
          onMain();
          return;
        }
      }
    } catch { /* fall through */ }
    redirectToLogin();
  }

  function logout() {
    setAccessToken(null);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/auth/logout`, { method: "POST", credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: { endSessionUrl?: string } | null) => {
        if (data?.endSessionUrl) {
          window.location.href = data.endSessionUrl;
        } else {
          redirectToLogin();
        }
      })
      .catch(() => { redirectToLogin(); });
  }

  return (
    <AuthContext.Provider value={{ currentScreen, username, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
