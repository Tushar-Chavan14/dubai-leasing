import { describe, expect, test } from "bun:test";
import { completeHandoff } from "../lib/portal-handoff";

const COOKIE = "leasing_session";
const FAIL = "/login?error=portal";
const jar = () => {
  const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return { set, jar: { set: (name: string, value: string, options: never) => set.push({ name, value, options }) } };
};
const answer =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });
const run = (j: ReturnType<typeof jar>, over: Partial<Parameters<typeof completeHandoff>[0]> = {}) =>
  completeHandoff({
    token: "a-token",
    exchange: answer({ token: "module-session" }),
    jar: j.jar,
    cookieName: COOKIE,
    secure: true,
    failPath: FAIL,
    ...over,
  });

describe("portal hand-off landing (C38, S70)", () => {
  test("a session from the engine is kept in this app's own cookie only, httpOnly, and the user lands on /", async () => {
    const j = jar();
    expect(await run(j)).toBe("/");
    expect(j.set).toHaveLength(1);
    expect(j.set[0]).toMatchObject({
      name: COOKIE,
      value: "module-session",
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
    });
  });
  test("no match (403), a bad token (401), a limit (429), an odd answer or a down engine: no cookie, the sign-in page", async () => {
    for (const exchange of [
      answer({ error: "x" }, 403),
      answer({ error: "x" }, 401),
      answer({ error: "x" }, 429),
      answer({ nope: 1 }),
      answer({ token: 5 }),
      async () => {
        throw new Error("refused");
      },
      async () => null,
    ]) {
      const j = jar();
      expect(await run(j, { exchange })).toBe(FAIL);
      expect(j.set).toEqual([]);
    }
  });
  test("a missing or oversized token never reaches the engine", async () => {
    let calls = 0;
    const exchange = async () => (calls++, new Response("{}"));
    const j = jar();
    expect(await run(j, { token: null, exchange })).toBe(FAIL);
    expect(await run(j, { token: "x".repeat(2001), exchange })).toBe(FAIL);
    expect(calls).toBe(0);
  });
  test("signing out of this app clears its own cookie only", async () => {
    const src = await Bun.file(`${import.meta.dir}/../app/login/actions.ts`).text();
    const deletes = [...src.matchAll(/\.delete\(([^)]*)\)/g)].map((m) => m[1]);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/sessionCookie|SESSION_COOKIE/);
    expect(src).not.toMatch(/portal_session/);
  });
});
