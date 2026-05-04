import { useEffect, useState, useRef } from "react";
import { api, fetchCsrfToken } from "../api";
import { useAuth } from "../context/AuthContext";
import {
  decodeAuthenticationOptions,
  encodeAuthenticationResponse,
} from "../hooks/usePasskey";
import { useToast } from "../components/shared/Toast";

type Step = "passkey" | "password-step1" | "password-step2" | "recovery";

export function LoginScreen() {
  const { loginHasPasskeys, login } = useAuth();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>(loginHasPasskeys ? "passkey" : "password-step1");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const totpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "password-step2") setTimeout(() => totpRef.current?.focus(), 50);
  }, [step]);

  async function loginWithPasskey() {
    setError("");
    if (!window.PublicKeyCredential) return setError("This browser does not support passkeys");
    setLoading(true);
    try {
      const opts = await api("POST", "/api/webauthn/login/start", {}, false);
      if (opts.error) { setError(opts.error as string); setLoading(false); return; }
      const assertion = await navigator.credentials.get({
        publicKey: decodeAuthenticationOptions(opts as Parameters<typeof decodeAuthenticationOptions>[0]) as unknown as PublicKeyCredentialRequestOptions,
      }) as PublicKeyCredential;
      const response = encodeAuthenticationResponse(assertion);
      const result = await api("POST", "/api/webauthn/login/finish", response, false);
      if (result.error) { setError(result.error as string); setLoading(false); return; }
      await fetchCsrfToken();
      await login(result.accessToken as string);
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err.name === "NotAllowedError") setError("Passkey sign-in was cancelled");
      else setError("Passkey sign-in failed");
    }
    setLoading(false);
  }

  async function submitStep1() {
    setError("");
    const data = await api("POST", "/api/auth/login", { username: username.trim(), password }, false);
    if (data.error) return setError(data.error as string);
    setMfaToken(data.mfaToken as string);
    setStep("password-step2");
  }

  async function submitStep2() {
    setError("");
    const data = await api("POST", "/api/auth/mfa", { mfaToken, code: totpCode }, false);
    if (data.error) return setError(data.error as string);
    await login(data.accessToken as string, data.csrfToken as string | undefined);
  }

  async function submitRecovery() {
    setError("");
    const data = await api("POST", "/api/auth/recovery", { mfaToken, code: recoveryCode }, false);
    if (data.error) return setError(data.error as string);
    if (typeof data.remaining === "number" && data.remaining <= 2) {
      showToast(`Warning: only ${data.remaining} recovery code${data.remaining === 1 ? "" : "s"} remaining. Regenerate in Settings.`);
    }
    await login(data.accessToken as string, data.csrfToken as string | undefined);
  }

  return (
    <div className="screen" data-testid="screen-login">
      <div className="screen-box">
        <div className="screen-tag">GAME BACKLOG</div>
        <div className="screen-title">Sign in</div>

        {/* Passkey section */}
        {step === "passkey" && (
          <div data-testid="login-passkey-section">
            {error && <div className="error-msg" data-testid="login-error-pk">{error}</div>}
            <button className="btn btn-gold" style={{ width: "100%", marginBottom: 10 }} onClick={loginWithPasskey} disabled={loading}>
              Sign in with Passkey
            </button>
            <div style={{ textAlign: "center" }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setStep("password-step1"); setError(""); }}
              >
                Use password instead
              </button>
            </div>
          </div>
        )}

        {/* Password step 1 */}
        {step === "password-step1" && (
          <div data-testid="login-step1">
            {loginHasPasskeys && (
              <div style={{ marginBottom: 10, textAlign: "right" }} data-testid="login-back-to-passkey-row">
                <button className="btn btn-ghost btn-sm" onClick={() => { setStep("passkey"); setError(""); }}>
                  Use passkey instead
                </button>
              </div>
            )}
            {error && <div className="error-msg" data-testid="login-error1">{error}</div>}
            <div className="field">
              <label>Username</label>
              <input
                data-testid="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") submitStep1(); }}
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitStep1(); }}
              />
            </div>
            <button className="btn btn-gold" onClick={submitStep1} data-testid="login-submit-step1">Continue</button>
          </div>
        )}

        {/* Password step 2 — TOTP */}
        {step === "password-step2" && (
          <div>
            <div data-testid="login-totp-mode">
              {error && <div className="error-msg" data-testid="login-error2">{error}</div>}
              <div className="field">
                <label>Authenticator Code</label>
                <input
                  data-testid="login-totp"
                  ref={totpRef}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="6-digit code"
                  maxLength={6}
                  onKeyDown={(e) => { if (e.key === "Enter") submitStep2(); }}
                />
              </div>
              <div className="btn-row">
                <button className="btn btn-gold" onClick={submitStep2}>Verify</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setStep("recovery"); setError(""); }}>
                  Use recovery code
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recovery code */}
        {step === "recovery" && (
          <div data-testid="login-recovery-mode">
            {error && <div className="error-msg" data-testid="login-error3">{error}</div>}
            <div className="field">
              <label>Recovery Code</label>
              <input
                data-testid="login-recovery"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="xxxx-xxxx-xx"
                onKeyDown={(e) => { if (e.key === "Enter") submitRecovery(); }}
              />
            </div>
            <div className="btn-row">
              <button className="btn btn-gold" onClick={submitRecovery}>Sign in</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setStep("password-step2"); setError(""); }}>
                Back to TOTP
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
