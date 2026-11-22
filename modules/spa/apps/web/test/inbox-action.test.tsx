/* oxlint-disable no-explicit-any -- the mocked framework calls are read loosely */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { buildWorld, type World } from "../../engine/test/reads-fixture.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

let session = "";
const redirects: string[] = [];
const revalidated: string[] = [];
mock.module("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: session }) }) }));
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
mock.module("next/cache", () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
mock.module("../lib/env", () => ({ engineUrl: () => "http://engine.test", sessionCookie: () => "spa_session" }));

describe.skipIf(!url)("C31: the decide server action", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  const realFetch = globalThis.fetch;
  const asUser = (role: keyof World["users"]) => (session = issueToken(SECRET, w.users[role]!.id, NOW));
  const run = async (f: Record<string, string>) => {
    const { decideApproval } = await import("../app/(staff)/decide");
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.set(k, v);
    redirects.length = 0;
    await decideApproval(form).catch(() => {});
    return redirects[0];
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildWorld(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    globalThis.fetch = ((input: string, init?: RequestInit) =>
      app.request(String(input).replace("http://engine.test", ""), init)) as never;
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await database?.close();
  });

  test("a refused decision comes back to the inbox with an error and decides nothing", async () => {
    asUser("officer");
    expect(await run({ id: w.held.kyc, decision: "approve", from: "work" })).toBe(
      "/work?tab=inbox&error=refused#inbox",
    );
    expect(revalidated).toEqual([]);
  });

  test("a missing note comes back with the note error before any request", async () => {
    asUser("manager");
    expect(await run({ id: w.held.kyc, decision: "reject", from: "work" })).toBe("/work?tab=inbox&error=note#inbox");
  });

  test("the right role decides, the screens are refreshed and the user returns to where the form was", async () => {
    asUser("compliance");
    expect(
      await run({
        id: w.held.aml,
        decision: "aml",
        outcome: "more_info",
        note: "need the source of funds",
        from: "compliance",
        role: "admin",
      }),
    ).toBe("/compliance#inbox");
    expect(revalidated).toEqual(["/", "/work", "/compliance"]);
  });
  test("C33: a case page gets the user back to itself, and no other address is ever followed", async () => {
    const own = "/compliance/cases/0198a1b2-0000-7000-8000-000000000009";
    asUser("officer");
    expect(await run({ id: w.held.kyc, decision: "approve", from: "compliance", back: own })).toBe(
      `${own}?error=refused#inbox`,
    );
    for (const back of ["https://evil.test/", "//evil.test", "/work", "/compliance/cases/x", `${own}/../..`]) {
      const to = await run({ id: w.held.kyc, decision: "approve", from: "compliance", back });
      expect(to).toBe("/compliance?error=refused#inbox");
    }
  });
});
