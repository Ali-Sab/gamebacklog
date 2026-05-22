import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setAccessToken, redirectToLogin } from "../api";

type Screen = "loading" | "main";

interface AuthContextValue {
  currentScreen: Screen;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, onMain }: { children: ReactNode; onMain: () => void }) {
  const [currentScreen, setCurrentScreen] = useState<Screen>("loading");

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
    // Clear the cookie server-side then redirect to account-manager
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/auth/logout`, { method: "POST", credentials: "include" })
      .finally(() => { redirectToLogin(); });
  }

  return (
    <AuthContext.Provider value={{ currentScreen, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
