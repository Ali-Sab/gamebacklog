import { useState, useRef, useEffect } from "react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { useApp } from "../../context/AppContext";
import { useToast } from "../shared/Toast";
import { RecoveryCodesModal } from "../shared/RecoveryCodes";
import {
  decodeRegistrationOptions,
  encodeRegistrationResponse,
} from "../../hooks/usePasskey";

const THEMES = ["void", "dusk", "ash", "light"];

interface Passkey { credentialId: string; deviceName: string; createdAt: string }

interface Props { theme: string; onThemeChange: (t: string) => void; }

export function SettingsTab({ theme, onThemeChange }: Props) {
  const { logout } = useAuth();
  const { state } = useApp();
  const { showToast } = useToast();

  // Password change
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ text: string; type: "error" | "success" } | null>(null);

  // Recovery codes
  const [recoveryCount, setRecoveryCount] = useState<number | null>(null);
  const [showRecoveryCodes, setShowRecoveryCodes] = useState<{ codes: string[]; msg: string } | null>(null);

  // Passkeys
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [passkeyMsg, setPasskeyMsg] = useState<{ text: string; type: "error" | "success" | "" } | null>(null);

  // Import/export
  const fileInputRef = useRef<HTMLInputElement>(null);

  // MCP connection info
  const [mcpInfo, setMcpInfo] = useState<{ url: string; clientId: string; clientSecret: string } | null>(null);

  useEffect(() => {
    loadRecoveryCount();
    loadPasskeys();
    api("GET", "/api/mcp-url").then((data) => { if (data.url) setMcpInfo(data); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadRecoveryCount() {
    const data = await api("GET", "/api/auth/recovery-codes/count");
    if (typeof data.remaining === "number") setRecoveryCount(data.remaining);
  }

  async function loadPasskeys() {
    const data = await api("GET", "/api/webauthn/credentials");
    if (Array.isArray(data)) setPasskeys(data as Passkey[]);
  }

  async function changePassword() {
    setPwMsg(null);
    if (newPw.length < 6) return setPwMsg({ text: "New password must be at least 6 characters", type: "error" });
    if (newPw !== confirmPw) return setPwMsg({ text: "Passwords do not match", type: "error" });
    const data = await api("POST", "/api/auth/change-password", { currentPassword: curPw, newPassword: newPw });
    if (data.error) return setPwMsg({ text: data.error as string, type: "error" });
    setCurPw(""); setNewPw(""); setConfirmPw("");
    if (Array.isArray(data.recoveryCodes)) {
      setShowRecoveryCodes({ codes: data.recoveryCodes as string[], msg: "Password changed. Your recovery codes were regenerated. Save these before logging out." });
    } else {
      setPwMsg({ text: "Password changed. You will be logged out.", type: "success" });
      setTimeout(logout, 2000);
    }
  }

  async function regenRecoveryCodes() {
    const data = await api("POST", "/api/auth/recovery-codes/regenerate");
    if (data.error) { showToast(`Error: ${data.error as string}`); return; }
    setShowRecoveryCodes({ codes: data.recoveryCodes as string[], msg: "New recovery codes generated. Save these — old codes are now invalid." });
    loadRecoveryCount();
  }

  async function addPasskeyDevice() {
    setPasskeyMsg({ text: "Starting registration…", type: "" });
    if (!window.PublicKeyCredential) {
      setPasskeyMsg({ text: "This browser does not support passkeys", type: "error" }); return;
    }
    try {
      const opts = await api("POST", "/api/webauthn/add-device/start", {});
      if (opts.error) { setPasskeyMsg({ text: opts.error as string, type: "error" }); return; }
      const cred = await navigator.credentials.create({
        publicKey: decodeRegistrationOptions(opts as Parameters<typeof decodeRegistrationOptions>[0]) as unknown as PublicKeyCredentialCreationOptions,
      }) as PublicKeyCredential;
      const response = encodeRegistrationResponse(cred);
      const result = await api("POST", "/api/webauthn/add-device/finish", response);
      if (result.error) { setPasskeyMsg({ text: result.error as string, type: "error" }); return; }
      setPasskeyMsg({ text: "Device registered!", type: "success" });
      loadPasskeys();
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err.name === "NotAllowedError") setPasskeyMsg({ text: "Registration cancelled", type: "error" });
      else setPasskeyMsg({ text: "Registration failed", type: "error" });
    }
  }

  async function removePasskey(credentialId: string) {
    const result = await api("DELETE", `/api/webauthn/credentials/${encodeURIComponent(credentialId)}`);
    if (result.error) { setPasskeyMsg({ text: result.error as string, type: "error" }); return; }
    setPasskeyMsg(null);
    loadPasskeys();
  }

  function handleExport() {
    window.open("/api/export");
  }

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

  return (
    <div data-testid="tab-settings">
      {/* Theme */}
      <div className="settings-section">
        <div className="settings-title">Theme</div>
        <div className="btn-row">
          {THEMES.map((t) => (
            <button
              key={t}
              className={`btn theme-btn${theme === t ? " active" : ""}`}
              data-theme={t}
              onClick={() => onThemeChange(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Change password */}
      <div className="settings-section">
        <div className="settings-title">Change Password</div>
        {pwMsg && <div className={pwMsg.type === "error" ? "error-msg" : "success-msg"} id="s-pw-msg">{pwMsg.text}</div>}
        <div className="settings-fields">
          <input id="s-current-pw" type="password" placeholder="Current password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
          <input id="s-new-pw" type="password" placeholder="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input id="s-confirm-pw" type="password" placeholder="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          <button className="btn btn-ghost" onClick={changePassword}>Change Password</button>
        </div>
      </div>

      {/* Recovery codes */}
      <div className="settings-section">
        <div className="settings-title">Recovery Codes</div>
        <div className="settings-desc" id="recovery-count-desc">
          {recoveryCount === null ? "Loading…" : recoveryCount === 0
            ? "No recovery codes set up. Regenerate to create a fresh set."
            : `${recoveryCount} code${recoveryCount === 1 ? "" : "s"} remaining. Regenerate to invalidate all existing codes and create a new set.`
          }
        </div>
        <button className="btn btn-ghost" onClick={regenRecoveryCodes}>Regenerate Recovery Codes</button>
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

      {/* Passkeys */}
      <div className="settings-section">
        <div className="settings-title">Passkeys</div>
        <div id="passkey-list">
          {passkeys.length === 0
            ? <div style={{ fontSize: 13, color: "var(--muted)" }}>No passkeys registered.</div>
            : passkeys.map((p) => (
              <div key={p.credentialId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 13, color: "var(--text)" }}>{p.deviceName || "Device"}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Added {new Date(p.createdAt).toLocaleDateString()}</div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => removePasskey(p.credentialId)}>Remove</button>
              </div>
            ))
          }
        </div>
        {passkeyMsg && (
          <div id="passkey-msg" className={passkeyMsg.type === "error" ? "error-msg" : passkeyMsg.type === "success" ? "success-msg" : ""}>{passkeyMsg.text}</div>
        )}
        <button className="btn btn-ghost" onClick={addPasskeyDevice} style={{ marginTop: 8 }}>Add Passkey Device</button>
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

      {showRecoveryCodes && (
        <RecoveryCodesModal
          codes={showRecoveryCodes.codes}
          message={showRecoveryCodes.msg}
          onClose={() => setShowRecoveryCodes(null)}
          onLogout={logout}
        />
      )}
    </div>
  );
}
