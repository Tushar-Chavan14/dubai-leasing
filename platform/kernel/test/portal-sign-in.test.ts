import { createPrivateKey, sign } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  createExchangeLimiter,
  generatePortalKeyPair,
  portalExchange,
  signPortalToken,
  verifyPortalToken,
} from "../src/index.ts";

const NOW = Date.parse("2026-11-21T08:00:00Z");
const keys = generatePortalKeyPair();
const other = generatePortalKeyPair();
const claims = { sub: "acct-1", email: "Ana@Example.test", aud: "spa" as const };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
/** A token signed with the real key but a payload the portal would never write. */
const forge = (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "EdDSA", typ: "JWT" }) => {
  const data = `${b64(header)}.${b64(payload)}`;
  const key = createPrivateKey({ key: Buffer.from(keys.privateKey, "base64"), format: "der", type: "pkcs8" });
  return `${data}.${sign(null, Buffer.from(data), key).toString("base64url")}`;
};
const base = { sub: "a", email: "a@x.test", aud: "spa", jti: "jti-12345", iat: NOW / 1000, exp: NOW / 1000 + 60 };

describe("portal hand-off token", () => {
  test("a signed token verifies for its audience, with lower-cased email and no role", () => {
    const t = signPortalToken(keys.privateKey, claims, NOW);
    const r = verifyPortalToken(keys.publicKey, t, "spa", NOW + 1000);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.email).toBe("ana@example.test");
      expect(r.claims.sub).toBe("acct-1");
      expect(Object.keys(r.claims).toSorted()).toEqual(["aud", "email", "exp", "iat", "jti", "sub"]);
    }
  });
  test("the other audience is refused", () => {
    const t = signPortalToken(keys.privateKey, { ...claims, aud: "leasing" }, NOW);
    expect(verifyPortalToken(keys.publicKey, t, "spa", NOW).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, t, "leasing", NOW).ok).toBe(true);
  });
  test("expired after 60 seconds, and a token that lives longer than that is refused", () => {
    const t = signPortalToken(keys.privateKey, claims, NOW);
    expect(verifyPortalToken(keys.publicKey, t, "spa", NOW + 59_000).ok).toBe(true);
    expect(verifyPortalToken(keys.publicKey, t, "spa", NOW + 61_000).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, forge({ ...base, exp: base.exp + 3600 }), "spa", NOW).ok).toBe(false);
  });
  test("signed with another key, unsigned (alg none), or HS256: refused", () => {
    const wrong = signPortalToken(other.privateKey, claims, NOW);
    expect(verifyPortalToken(keys.publicKey, wrong, "spa", NOW).ok).toBe(false);
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(base)}.`;
    expect(verifyPortalToken(keys.publicKey, none, "spa", NOW).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, forge(base, { alg: "HS256", typ: "JWT" }), "spa", NOW).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, "a.b", "spa", NOW).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, "", "spa", NOW).ok).toBe(false);
  });
  test("a role claim is refused, however it is signed, and any other extra claim too", () => {
    expect(verifyPortalToken(keys.publicKey, forge(base), "spa", NOW).ok).toBe(true);
    expect(verifyPortalToken(keys.publicKey, forge({ ...base, role: "admin" }), "spa", NOW).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, forge({ ...base, roles: ["admin"] }), "spa", NOW).ok).toBe(false);
  });
});

describe("exchange limiter", () => {
  test("per key and per scope, resets with the window", () => {
    const l = createExchangeLimiter({ exchange: { ip: 2, email: 1 }, check: { ip: 5, email: 5 }, windowMs: 60_000 });
    expect([1, 2, 3].map(() => l.allow("exchange", "ip", "1.1.1.1", NOW))).toEqual([true, true, false]);
    expect(l.allow("exchange", "ip", "2.2.2.2", NOW)).toBe(true);
    expect([1, 2].map(() => l.allow("exchange", "email", "a@x.test", NOW))).toEqual([true, false]);
    expect(l.allow("check", "email", "a@x.test", NOW)).toBe(true);
    expect(l.allow("exchange", "ip", "1.1.1.1", NOW + 60_001)).toBe(true);
  });
});

describe("exchange limiter memory", () => {
  test("a flood of distinct keys in one window is refused past the cap, and recovers after the window", () => {
    const l = createExchangeLimiter({ exchange: { ip: 5, email: 5 }, check: { ip: 5, email: 5 }, windowMs: 60_000 });
    for (let i = 0; i < 5001; i++) l.allow("exchange", "ip", `k${i}`, NOW);
    expect(l.allow("exchange", "ip", "one-more", NOW)).toBe(false);
    expect(l.allow("exchange", "ip", "k1", NOW)).toBe(true);
    expect(l.allow("exchange", "ip", "one-more", NOW + 60_001)).toBe(true);
  });
});

describe("portalExchange decision", () => {
  const store = () => {
    const taken = new Set<string>();
    return {
      takeJti: async (j: string) => (taken.has(j) ? false : (taken.add(j), true)),
      findUser: async (e: string) => (e === "ana@example.test" ? { id: "u1", role: "sales_officer" } : null),
    };
  };
  const run = (over: Partial<Parameters<typeof portalExchange>[0]> = {}, input = {}) => {
    const s = store();
    const deps = {
      publicKey: keys.publicKey as string | undefined,
      audience: "spa" as const,
      nowMs: NOW,
      limiter: createExchangeLimiter(),
      ...s,
      ...over,
    };
    return (token: string, i: { check?: boolean; ip?: string } = {}) =>
      portalExchange(deps as never, { token, check: false, ip: "9.9.9.9", ...input, ...i });
  };
  test("no public key: the feature is off (404)", async () => {
    const r = await run({ publicKey: undefined })(signPortalToken(keys.privateKey, claims, NOW));
    expect(r.status).toBe(404);
  });
  test("a valid token for a user gives that user; a replay gives 401", async () => {
    const go = run();
    const t = signPortalToken(keys.privateKey, claims, NOW);
    const first = await go(t);
    expect(first).toMatchObject({ status: 200, kind: "session", user: { id: "u1", role: "sales_officer" } });
    expect((await go(t)).status).toBe(401);
  });
  test("no user for the email: 403, one body, and the replay is also spent", async () => {
    const go = run();
    const a = await go(signPortalToken(keys.privateKey, { ...claims, email: "ghost@example.test" }, NOW));
    const b = await go(signPortalToken(keys.privateKey, { ...claims, email: "other@example.test" }, NOW));
    expect([a.status, b.status]).toEqual([403, 403]);
    expect(a).toEqual(b);
  });
  test("check answers active without taking the jti", async () => {
    const go = run();
    const t = signPortalToken(keys.privateKey, claims, NOW);
    expect(await go(t, { check: true })).toMatchObject({ status: 200, kind: "check", active: true });
    expect(await go(t, { check: true })).toMatchObject({ kind: "check", active: true });
    const ghost = signPortalToken(keys.privateKey, { ...claims, email: "ghost@example.test" }, NOW);
    expect(await go(ghost, { check: true })).toMatchObject({ kind: "check", active: false });
    expect(await go(t)).toMatchObject({ kind: "session" });
  });
  test("rate limited per IP and per email (429) with the same answer for every caller", async () => {
    const limiter = createExchangeLimiter({
      exchange: { ip: 3, email: 2 },
      check: { ip: 9, email: 9 },
      windowMs: 60_000,
    });
    const go = run({ limiter });
    const mint = (email = claims.email) => signPortalToken(keys.privateKey, { ...claims, email }, NOW);
    // email limit: two tokens for one person pass, the third is limited
    const byEmail = [
      await go(mint(), { ip: "1.1.1.1" }),
      await go(mint(), { ip: "2.2.2.2" }),
      await go(mint(), { ip: "3.3.3.3" }),
    ];
    expect(byEmail.map((r) => r.status)).toEqual([200, 200, 429]);
    // IP limit: the fourth try from one address is limited even with garbage, before the token is read
    const byIp = [];
    for (let i = 0; i < 4; i++) byIp.push((await go("garbage", { ip: "7.7.7.7" })).status);
    expect(byIp).toEqual([401, 401, 401, 429]);
  });
});
