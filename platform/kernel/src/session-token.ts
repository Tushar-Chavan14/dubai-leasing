import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Staff session tokens for any module (S4): base64url(JSON {uid, exp}) + "." + HMAC-SHA256 with the module's own
 * secret. The caller passes the current wall-clock time (session expiry is not a legal date, so not the demo clock).
 */
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function issueToken(secret: string, userId: string, nowMs: number, hours = 12): string {
  const body = b64(JSON.stringify({ uid: userId, exp: nowMs + hours * 3_600_000 }));
  return `${body}.${sign(secret, body)}`;
}

/** The user id, or null when the token is malformed, signed with another secret, or expired. */
export function verifyToken(secret: string, token: string, nowMs: number): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; exp: number };
    const { uid, exp } = parsed;
    return typeof uid === "string" && typeof exp === "number" && exp > nowMs ? uid : null;
  } catch {
    return null;
  }
}
