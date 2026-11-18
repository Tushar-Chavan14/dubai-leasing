import { createHash, randomBytes } from "node:crypto";

/** A random URL-safe token for magic links (256 bits). Only its hash is stored. */
export const newToken = (): string => randomBytes(32).toString("base64url");

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Short human reference for a submission, e.g. "R-7KQ2M9" (no 0/O/1/I). */
export function shortRef(prefix: string): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(6);
  return `${prefix}-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}
