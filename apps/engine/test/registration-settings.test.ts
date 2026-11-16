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

  test("D74: defaults carry contract wording; a row saved without it falls back to the default", async () => {
    const r = await send("leasing_officer", "/registration-settings/ras_al_khaimah");
    const back = (await r.json()) as { contractWording: { registrationSystem: string; utilityProvider: string } };
    expect(back.contractWording).toEqual(DEFAULT_REGISTRATION_SETTINGS.ras_al_khaimah.contractWording!);
    // Saved before D74 (no contractWording in the body): read back with the default wording.
    const { contractWording: _drop, ...old } = DEFAULT_REGISTRATION_SETTINGS.umm_al_quwain;
    expect((await send("admin", "/registration-settings/umm_al_quwain", "PUT", old)).status).toBe(200);
    const uaq = (await (await send("admin", "/registration-settings/umm_al_quwain")).json()) as {
      source: string;
      contractWording: unknown;
    };
    expect(uaq.source).toBe("saved");
    expect(uaq.contractWording).toEqual(DEFAULT_REGISTRATION_SETTINGS.umm_al_quwain.contractWording!);
  });

  test("D74: an admin saves contract wording, audited; an officer cannot", async () => {
    const wording = { ...DEFAULT_REGISTRATION_SETTINGS.fujairah.contractWording!, utilityProvider: "FEWA test" };
    const body = { ...DEFAULT_REGISTRATION_SETTINGS.fujairah, contractWording: wording };
    expect((await send("leasing_officer", "/registration-settings/fujairah", "PUT", body)).status).toBe(403);
    expect(((await (await send("admin", "/registration-settings/fujairah")).json()) as { source: string }).source).toBe(
      "default",
    );
    const r = await send("admin", "/registration-settings/fujairah", "PUT", body);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { contractWording: typeof wording }).contractWording).toEqual(wording);
    const back = (await (await send("leasing_officer", "/registration-settings/fujairah")).json()) as {
      contractWording: typeof wording;
    };
    expect(back.contractWording.utilityProvider).toBe("FEWA test");
    const ev = await database.db
      .select()
      .from(leaseEvents)
      .where(eq(leaseEvents.entityId, settingsEntityId("fujairah")));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "REGISTRATION_SETTINGS_UPDATED" });
    expect(ev[0]!.actor).toStartWith("user:");
    expect((ev[0]!.payload as { to: { contractWording: typeof wording } }).to.contractWording).toEqual(wording);
  });

  test("D74: empty or unknown wording is refused", async () => {
    const w = DEFAULT_REGISTRATION_SETTINGS.ajman.contractWording!;
    for (const contractWording of [
      { ...w, governingLaw: "" },
      { ...w, extra: "x" },
    ]) {
      const r = await send("admin", "/registration-settings/ajman", "PUT", {
        ...DEFAULT_REGISTRATION_SETTINGS.ajman,
        contractWording,
      });
      expect(r.status).toBe(400);
    }
  });
});
