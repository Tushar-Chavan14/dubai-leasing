import { createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { z } from "zod";

/**
 * The portal's hand-off token (S70). The portal proves who a person is and nothing else: the token names the person
 * (`sub`, `email`) and the module it is for (`aud`), lives 60 seconds and carries a one-use `jti`. It has no role claim,
 * and a token that carries one (or any claim not listed here) is refused: the module's own user row decides the role.
 * EdDSA (Ed25519): the portal signs, each module holds only the public key. Keys travel as one line of base64 DER
 * (PKCS#8 private, SPKI public). The caller passes the current wall-clock time (token expiry is not a legal date).
 */
export const HANDOFF_SECONDS = 60;
export const PortalAudience = z.enum(["leasing", "spa"]);
export type PortalAudience = z.infer<typeof PortalAudience>;

const Claims = z
  .object({
    sub: z.string().min(1),
    email: z.string().min(3),
    aud: PortalAudience,
    jti: z.string().min(8),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();
export type PortalClaims = z.infer<typeof Claims>;
const HEADER = { alg: "EdDSA", typ: "JWT" } as const;

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
const privateKey = (b: string) => createPrivateKey({ key: Buffer.from(b, "base64"), format: "der", type: "pkcs8" });
const publicKey = (b: string) => createPublicKey({ key: Buffer.from(b, "base64"), format: "der", type: "spki" });

export function generatePortalKeyPair(): { privateKey: string; publicKey: string } {
  const k = generateKeyPairSync("ed25519");
  return {
    privateKey: k.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKey: k.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

export function signPortalToken(
  privateKeyB64: string,
  who: { sub: string; email: string; aud: PortalAudience },
  nowMs: number,
  jti: string = randomUUID(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: PortalClaims = {
    sub: who.sub,
    email: who.email.toLowerCase(),
    aud: who.aud,
    jti,
    iat,
    exp: iat + HANDOFF_SECONDS,
  };
  const data = `${b64(JSON.stringify(HEADER))}.${b64(JSON.stringify(payload))}`;
  return `${data}.${b64(sign(null, Buffer.from(data), privateKey(privateKeyB64)))}`;
}

export type PortalVerdict = { ok: true; claims: PortalClaims } | { ok: false };

/** Refuses anything but an exact, unexpired EdDSA token for `audience`. The reason is never returned. */
export function verifyPortalToken(
  publicKeyB64: string,
  token: string,
  audience: PortalAudience,
  nowMs: number,
): PortalVerdict {
  const no: PortalVerdict = { ok: false };
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return no;
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as Record<string, unknown>;
    if (header.alg !== HEADER.alg || header.typ !== HEADER.typ || Object.keys(header).length !== 2) return no;
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verify(null, data, publicKey(publicKeyB64), Buffer.from(parts[2], "base64url"))) return no;
    const parsed = Claims.safeParse(JSON.parse(Buffer.from(parts[1], "base64url").toString()));
    if (!parsed.success) return no;
    const c = parsed.data;
    if (c.aud !== audience) return no;
    if (c.exp * 1000 <= nowMs || c.exp - c.iat > HANDOFF_SECONDS || c.iat * 1000 > nowMs + 10_000) return no;
    return { ok: true, claims: { ...c, email: c.email.toLowerCase() } };
  } catch {
    return no;
  }
}
