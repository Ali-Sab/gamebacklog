import { useState, useRef, useEffect } from "react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApp } from "../../context/AppContext";
import { useToast } from "../shared/Toast";

const THEMES = ["void", "dusk", "ash", "light"];

interface Props { theme: string; onThemeChange: (t: string) => void; }

export function SettingsTab({ theme, onThemeChange }: Props) {
  const { logout } = useAuth();
  const { state } = useApp();
  const { showToast } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mcpInfo, setMcpInfo] = useState<{ url: string; clientId: string; clientSecret: string; accountManagerUrl: string } | null>(null);

  useEffect(() => {
    api("GET", "/api/mcp-url").then((data) => { if (data.url) setMcpInfo(data); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleExport() { window.open("/api/export"); }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      const data = await api("POST", "/api/import", json);
      if (data.error) showToast(`Import failed: ${data.error as string}`);
      else showToast("Import successful");
    } catch { showToast("Invalid file"); }
    e.target.value = "";
  }

  const total = Object.values(state.games).reduce((a, c) => a + (c ? c.length : 0), 0);
  const accountManagerUrl = mcpInfo?.accountManagerUrl ?? null;

  return (
    <div data-testid="tab-settings">
      {/* Theme */}
      <div className="settings-section">
        <div className="settings-title">Theme</div>
        <div className="btn-row">
          {THEMES.map((t) => (
            <button key={t} className={`btn theme-btn${theme === t ? " active" : ""}`} data-theme={t} onClick={() => onThemeChange(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Account management */}
      <div className="settings-section">
        <div className="settings-title">Account</div>
        <div className="settings-desc">
          Manage your password, passkeys, and recovery codes in Account Manager.
        </div>
        {accountManagerUrl ? (
          <a href={accountManagerUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ display: "inline-block", textDecoration: "none" }}>
            Open Account Manager
          </a>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Set ACCOUNT_MANAGER_URL to link to account manager.</div>
        )}
      </div>

      {/* Session */}
      <div className="settings-section">
        <div className="settings-title">Session</div>
        <button className="btn btn-ghost" onClick={logout} data-testid="logout-btn">Log Out</button>
      </div>

      {/* Backup & Restore */}
      <div className="settings-section">
        <div className="settings-title">Backup & Restore</div>
        <div className="settings-desc">{total} games in your library.</div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={handleExport}>Export JSON</button>
          <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>Import JSON</button>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImport} />
        </div>
      </div>

      {/* Connect Claude */}
      <div className="settings-section">
        <div className="settings-title">Connect Claude</div>
        <div className="settings-desc">
          Add these credentials to Claude.ai → Settings → Integrations → Add MCP Server to allow Claude to read and suggest changes to your game library.
        </div>
        {mcpInfo ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(["url", "clientId", "clientSecret"] as const).map((key) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 100, fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
                  {key === "url" ? "MCP endpoint" : key === "clientId" ? "Client ID" : "Client Secret"}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", wordBreak: "break-all", color: "var(--sub)", flex: 1 }}>
                  {mcpInfo[key] || <span style={{ color: "var(--muted)" }}>not set</span>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
        )}
      </div>
    </div>
  );
}
