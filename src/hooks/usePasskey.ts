export function b64uDecode(str: string): ArrayBuffer {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const bin = atob(b64 + "=".repeat(pad));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

export function b64uEncode(buf: ArrayBuffer | Uint8Array | ArrayBufferLike): string {
  const bytes =
    buf instanceof ArrayBuffer
      ? new Uint8Array(buf)
      : new Uint8Array((buf as Uint8Array).buffer ?? buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

interface RegistrationOptions {
  challenge: string;
  user: { id: string; [k: string]: unknown };
  excludeCredentials?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

interface AuthenticationOptions {
  challenge: string;
  allowCredentials?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export function decodeRegistrationOptions(opts: RegistrationOptions) {
  return {
    ...opts,
    challenge: b64uDecode(opts.challenge),
    user: { ...opts.user, id: b64uDecode(opts.user.id as string) },
    excludeCredentials: (opts.excludeCredentials || []).map((c) => ({
      ...c,
      id: b64uDecode(c.id),
    })),
  };
}

export function encodeRegistrationResponse(cred: PublicKeyCredential) {
  const response = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(response.clientDataJSON),
      attestationObject: b64uEncode(response.attestationObject),
      transports: response.getTransports ? response.getTransports() : [],
    },
  };
}

export function decodeAuthenticationOptions(opts: AuthenticationOptions) {
  return {
    ...opts,
    challenge: b64uDecode(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map((c) => ({
      ...c,
      id: b64uDecode(c.id),
    })),
  };
}

export function encodeAuthenticationResponse(assertion: PublicKeyCredential) {
  const response = assertion.response as AuthenticatorAssertionResponse;
  return {
    id: assertion.id,
    rawId: b64uEncode(assertion.rawId),
    type: assertion.type,
    response: {
      clientDataJSON: b64uEncode(response.clientDataJSON),
      authenticatorData: b64uEncode(response.authenticatorData),
      signature: b64uEncode(response.signature),
      userHandle: response.userHandle ? b64uEncode(response.userHandle) : undefined,
    },
  };
}
