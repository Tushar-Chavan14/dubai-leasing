/**
 * Who a listing-chat visitor is, for the rate limit (S61 amendment). `x-forwarded-for` is only as honest as the hop
 * that wrote it: a visitor can send their own, so the first entry is never used. Behind a proxy we run
 * (`SPA_TRUSTED_PROXY=true`) the last entry is the one that proxy appended. Otherwise (and when the last entry isn't an
 * address) every visitor of a listing shares the fixed `direct` bucket; Next route handlers don't expose the socket.
 */
export const DIRECT_BUCKET = "direct";
const ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;

export function clientBucket(headers: Headers, trustedProxy: boolean): string {
  if (!trustedProxy) return DIRECT_BUCKET;
  const last = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "";
  return ADDRESS.test(last) ? last : DIRECT_BUCKET;
}
