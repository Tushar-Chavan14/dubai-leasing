import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { companyChecks, deals, kycRuns, registrations, type SpaDatabase, units } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import { listCompanyChecks } from "../src/manager/company-check.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { listKycRuns } from "../src/manager/kyc.ts";
import { sendSpaMail } from "../src/manager/mail.ts";
import { listRegistrations } from "../src/manager/registry.ts";
import { dealInDraft, markScreened, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const PASSPORT = "N1234567";
const EID = "784-1990-1234567-1";
const PHONE = "+971 50 123 4567";
const IBAN = "AE070331234567890123456";
const LEAK = `Passport ${PASSPORT}, Emirates ID ${EID}, phone ${PHONE}, account ${IBAN}`;
const clean = (v: unknown) => {
  const t = JSON.stringify(v);
  for (const raw of [PASSPORT, EID, PHONE, IBAN]) expect(t).not.toContain(raw);
};

describe.skipIf(!url)("staff views and logs mask personal data (rule 8)", () => {
  let database: SpaDatabase;
  let users: Record<string, U> = {};
  const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
  const ctx = (extra: Partial<SpaContext> = {}): SpaContext => ({
    database,
    clock,
    facts: failClosedFacts,
    ...extra,
  });
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("listKycRuns masks a flag's message", async () => {
    const made = await dealInDraft(ctx(), database, { type: "resale_ready" });
    await database.db.insert(kycRuns).values({
      id: newId(),
      dealId: made.dealId,
      partyId: made.buyerIds[0]!,
      role: "buyer_person",
      configScope: "*",
      configVersion: 1,
      status: "blocked",
      flags: [{ kind: "name_mismatch", message: LEAK, blocking: true }],
      identity: {},
      answers: {},
      docsHash: "h",
      createdAt: clock.now(),
    });
    const v = await listKycRuns(ctx(), made.dealId, users.officer!);
    const f = v.parties.find((p) => p.partyId === made.buyerIds[0])!.flags[0]!;
    expect(f.message).toContain("Passport");
    clean(v);
  });

  test("listCompanyChecks masks a finding's message", async () => {
    const made = await dealInDraft(ctx(), database, { type: "primary_offplan" });
    const company = made.sellerIds[0]!;
    await database.db.insert(companyChecks).values({
      id: newId(),
      dealId: made.dealId,
      partyId: company,
      status: "review",
      signerOk: true,
      owners: [],
      layers: 0,
      findings: [{ code: "licence_note", message: LEAK, severity: "info" }],
      docsHash: "h",
      createdAt: clock.now(),
    });
    const v = await listCompanyChecks(ctx(), made.dealId, users.officer!);
    clean(v);
    expect(JSON.stringify(v)).toContain("Passport");
  });

  test("listRegistrations masks the registry's reasons", async () => {
    const made = await dealInDraft(ctx(), database, {
      type: "primary_offplan",
      buyers: ["Buyer One"],
      unitNo: "U-777",
    });
    const [d] = await database.db.select().from(deals).where(eq(deals.id, made.dealId));
    await database.db.update(units).set({ state: "SOLD" }).where(eq(units.id, d!.unitId!));
    await database.db.update(deals).set({ state: "REGISTRATION" }).where(eq(deals.id, made.dealId));
    await markScreened(database, made.dealId);
    const { id } = await proposeApproval(ctx(), {
      gate: "oqood_submission",
      entity: { kind: "deal", id: made.dealId },
      dedupeKey: `${made.dealId}:oqood_submission`,
      title: "oqood",
      proposal: {},
      proposedBy: "system:registry",
    });
    await decideApproval(ctx(), id, users.salesadmin!, { decision: "approve" });
    await database.db.insert(registrations).values({
      id: newId(),
      dealId: made.dealId,
      kind: "oqood_register",
      attempt: 1,
      requestId: `${made.dealId}:a`,
      status: "rejected",
      reasons: [{ code: "INVALID_ID", field: "buyer", message: LEAK }],
      approvalId: id,
      payloadHash: "h",
      createdAt: clock.now(),
    });
    const v = await listRegistrations(ctx(), made.dealId, users.salesadmin!);
    expect(v.attempts[0]!.reasons[0]!.message).toContain("Passport");
    clean(v);
  });

  test("an unhandled error in a route is logged by masked name and message only, never the object", async () => {
    const app = createApp({
      database: new Proxy(database, {
        get: (t, k) => {
          if (k !== "db") return (t as never)[k];
          throw Object.assign(new Error(`boom ${LEAK}`), { name: `Err ${EID}` });
        },
      }) as never,
      jobs: { boss: {} as never, lastHeartbeat: () => null },
      clock: { today: () => clock.today(), now: () => clock.now(), refresh: async () => {}, offsetDays: 0 } as never,
      sessionSecret: "s".repeat(32),
      demoMode: true,
      nowMs: () => clock.now().getTime(),
    });
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await app.request("/api/auth/demo-users");
      expect(r.status).toBe(500);
      expect(spy).toHaveBeenCalled();
      const logged = spy.mock.calls;
      for (const call of logged) {
        expect(call.every((a) => typeof a === "string")).toBe(true);
        clean(call);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test("a mail error in an alert is scrubbed like mail.ts does it (no address, no ID)", async () => {
    const mailer = new FakeMailer();
    mailer.send = async () => {
      throw new Error(`smtp refused for amal@example.test: ${LEAK}`);
    };
    const r = await sendSpaMail(ctx({ mail: { mailer, webBaseUrl: "https://spa.example.test" } }), {
      entityKind: "approval",
      entityId: newId(),
      purpose: "notice",
      milestone: "alert:x",
      to: "amal@example.test",
      parts: { template: "t", version: 1, subject: "s", text: "t", html: "<p>t</p>" } as never,
    });
    expect(r.status).toBe("failed");
    const [row] = (await database.pool.query("select error from outbound_messages where id = $1", [r.outboundId])).rows;
    expect(row.error).not.toContain("amal@example.test");
    clean(row);
  });
});
