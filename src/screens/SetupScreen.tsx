import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import {
  decodeRegistrationOptions,
  encodeRegistrationResponse,
} from "../hooks/usePasskey";

type Step = "credentials" | "passkey" | "recovery";

export function SetupScreen() {
  const { setScreen, login } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  useEffect(() => {
    api("GET", "/api/setup/secret", undefined, false).then((data) => {
      if (typeof data.formatted === "string") setTotpSecret(data.formatted);
      if (typeof data.qrDataUrl === "string") setQrDataUrl(data.qrDataUrl as string);
    });
  }, []);

  async function submitCredentials() {
    setError("");
    if (!username.trim()) return setError("Username required");
    if (password.length < 6) return setError("Password must be at least 6 characters");
    if (password !== confirm) return setError("Passwords do not match");
    setStep("passkey");
  }

  async function registerPasskey() {
    setError("");
    if (!window.PublicKeyCredential) {
      return setError("This browser does not support passkeys");
    }
    setLoading(true);
    try {
      const opts = await api("POST", "/api/webauthn/register/start", { username: username.trim(), password }, false);
      if (opts.error) { setError(opts.error as string); setLoading(false); return; }
      const cred = await navigator.credentials.create({
        publicKey: decodeRegistrationOptions(opts as Parameters<typeof decodeRegistrationOptions>[0]) as unknown as PublicKeyCredentialCreationOptions,
      }) as PublicKeyCredential;
      const response = encodeRegistrationResponse(cred);
      const result = await api("POST", "/api/webauthn/register/finish", response, false);
      if (result.error) { setError(result.error as string); setLoading(false); return; }
      setScreen("login");
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err.name === "NotAllowedError") setError("Passkey registration was cancelled");
      else setError("Failed to register passkey");
    }
    setLoading(false);
  }

  async function skipToTotp() {
    setError("");
    if (!totpCode.trim()) return setError("TOTP code required");
    setLoading(true);
    const data = await api("POST", "/api/setup", {
      username: username.trim(), password, totpCode,
    }, false);
    setLoading(false);
    if (data.error) { setError(data.error as string); return; }
    setRecoveryCodes(data.recoveryCodes as string[] || []);
    setStep("recovery");
  }

  async function doneWithRecovery() {
    // Boot into login
    setScreen("login");
  }

  return (
    <div className="screen" data-testid="screen-setup">
      <div className="screen-box">
        <div className="screen-tag">GAME BACKLOG</div>

        {step === "credentials" && (
          <>
            <div className="screen-title">First-time setup</div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: "var(--mono)", textAlign: "center", marginBottom: 8 }}>
                <img src={qrDataUrl} alt="QR code" style={{ width: 160, height: 160, display: "block", margin: "0 auto 8px" }} />
                <div className="secret-box">{totpSecret}</div>
              </div>
              <div className="field-hint">Scan the QR code or enter the secret in your authenticator app. You'll verify the code below.</div>
            </div>
            {error && <div className="error-msg" data-testid="setup-error1">{error}</div>}
            <div className="field">
              <label>Username</label>
              <input data-testid="setup-username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input data-testid="setup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>Confirm Password</label>
              <input data-testid="setup-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <div className="field">
              <label>Authenticator Code</label>
              <input
                data-testid="setup-totp"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit code"
                maxLength={6}
                onKeyDown={(e) => { if (e.key === "Enter") submitCredentials(); }}
              />
            </div>
            <button className="btn btn-gold" onClick={submitCredentials} disabled={loading}>Continue</button>
          </>
        )}

        {step === "passkey" && (
          <>
            <div className="screen-title">Register a passkey</div>
            <div className="field-hint" style={{ marginBottom: 20 }}>
              Register a passkey (Touch ID, Face ID, or hardware key) to enable one-tap sign-in.
            </div>
            {error && <div className="error-msg">{error}</div>}
            <div className="btn-row">
              <button className="btn btn-gold" onClick={registerPasskey} disabled={loading}>Register Passkey</button>
              <button className="btn btn-ghost" onClick={skipToTotp} disabled={loading}>Skip — Use TOTP Only</button>
            </div>
          </>
        )}

        {step === "recovery" && (
          <>
            <div className="screen-title">Save your recovery codes</div>
            <div className="field-hint" style={{ marginBottom: 16 }}>Save these somewhere safe — each code works once and they won't be shown again.</div>
            <div className="recovery-codes" style={{ marginBottom: 16 }}>
              {recoveryCodes.map((c) => <div key={c} className="recovery-code">{c}</div>)}
            </div>
            <div style={{ fontSize: "12px", color: "var(--red)", marginBottom: 16 }}>These won't be shown again.</div>
            <button className="btn btn-gold" onClick={doneWithRecovery}>I've saved them — Continue to Login</button>
          </>
        )}
      </div>
    </div>
  );
}
