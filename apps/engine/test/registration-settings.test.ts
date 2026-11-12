import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { DEFAULT_REGISTRATION_SETTINGS } from "@leasing/core";
import { type Database, leaseEvents } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { settingsEntityId } from "../src/manager/registration-settings.ts";
import { addStaff, freshDatabase, noDb, testContext } from "./harness.ts";

const SECRET = "test-secret";

describe.skipIf(noDb)("registration settings API (Postgres)", () => {
  let database: Database;
  let app: ReturnType<typeof createApi>;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-10-19T04:00:00Z");
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ["leasing_officer", "admin"] as const) {
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    }
  });

  const send = (role: string, path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
    });

  test("returns defaults for all 7; dubai online, sharjah manual", async () => {
    const r = await send("leasing_officer", "/registration-settings");
    expect(r.status).toBe(200);
    const all = (await r.json()) as Record<string, { source: string; mode: string }>;
    expect(Object.keys(all)).toHaveLength(7);
    expect(all.dubai!.source).toBe("default");
    expect(all.dubai!.mode).toBe("online");
    expect(all.sharjah!.mode).toBe("manual");
  });

  test("bad emirate is 400", async () => {
    expect((await send("admin", "/registration-settings/narnia")).status).toBe(400);
  });

  test("non-admin cannot save", async () => {
    const r = await send(
      "leasing_officer",
      "/registration-settings/sharjah",
      "PUT",
      DEFAULT_REGISTRATION_SETTINGS.sharjah,
    );
    expect(r.status).toBe(403);
  });

  test("save, read back, audit event", async () => {
    const body = { ...DEFAULT_REGISTRATION_SETTINGS.sharjah, portalName: "Sharjah test portal" };
    const r = await send("admin", "/registration-settings/sharjah", "PUT", body);
    expect(r.status).toBe(200);
    const back = (await (await send("leasing_officer", "/registration-settings/sharjah")).json()) as {
      portalName: string;
      source: string;
    };
    expect(back.portalName).toBe("Sharjah test portal");
    expect(back.source).toBe("saved");
    const ev = await database.db
      .select()
      .from(leaseEvents)
      .where(eq(leaseEvents.entityId, settingsEntityId("sharjah")));
    expect(ev.map((e) => e.type)).toContain("REGISTRATION_SETTINGS_UPDATED");
    expect(ev[0]!.actor).toStartWith("user:");
  });

  test("online refused without an adapter", async () => {
    const r = await send("admin", "/registration-settings/ajman", "PUT", {
      ...DEFAULT_REGISTRATION_SETTINGS.ajman,
      mode: "online",
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe("no online registry for Ajman; use manual");
  });

  test("bad pattern is 400", async () => {
    const r = await send("admin", "/registration-settings/ajman", "PUT", {
      ...DEFAULT_REGISTRATION_SETTINGS.ajman,
      referencePattern: "(abc",
    });
    expect(r.status).toBe(400);
  });
});
