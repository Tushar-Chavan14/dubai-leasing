import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { type ChannelUpdate, defaultCompanyPolicy, newId } from "@leasing/core";
import { applications, companyPolicy, contracts, type Database, leases, parties, units } from "@leasing/db";
import { buildEjariPayload } from "@leasing/helpers";
import { FakeLlm } from "@leasing/llm";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { APPLICATION_MAIL_JOB, sendApplicationMail } from "../src/manager/applications.ts";
import { DEFAULT_ADDENDUM, prepareContract } from "../src/manager/contracts.ts";
import { handleChannelUpdate } from "../src/manager/enquiries.ts";
import { INBOUND_JOB, processInbound } from "../src/manager/inbound.ts";
import { isTimedAgentJob } from "../src/manager/agent-switches.ts";
import { addStaff, agreeingDecision, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const START = "2026-11-02T04:00:00Z";
const SECRET = "test-secret";
const SPECIMENS = join(import.meta.dir, "../../../packages/helpers/src/kyc/evals/specimens");
const png = (f: string) => new Uint8Array(readFileSync(join(SPECIMENS, f)));
const hi = (value: string) => ({ value, confidence: 0.97 });
const COMPANY = "Example Ventures Trading LLC";
let database: Database;

describe.skipIf(noDb)("a company applicant from the chat, end to end", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("chat -> KYC (trade licence + signatory) -> offer -> reservation -> contract and Ejari payload carry the company", async () => {
    const llm = new FakeLlm(agreeingDecision, (_images, prompt) => {
      if (prompt.includes("commercial trade licence"))
        return {
          documentType: "trade_licence",
          licenceNo: hi("CN-4410927"),
          tradeName: hi(COMPANY),
          managerName: hi("Priya Example Rao"),
          expiryDate: hi("14/08/2029"),
        };
      if (prompt.includes("back of an identity card"))
        return { documentType: "identity_card_back", cardNumber: hi("SPC4820193"), employer: hi(COMPANY) };
      return {
        documentType: "identity_card_front",
        idNumber: hi("784-1991-4820193-4"),
        name: hi("Priya Example Rao"),
        nationality: hi("India"),
        birthDate: hi("07/03/1991"),
        sex: hi("F"),
        expiryDate: hi("14/08/2029"),
      };
    });
    const t = testContext(database, START, { llm });
    await database.db.insert(companyPolicy).values({
      id: newId(),
      version: 98,
      effectiveFrom: "2000-01-01" as never,
      values: {
        ...defaultCompanyPolicy,
        autopilot: { ...defaultCompanyPolicy.autopilot, apply_without_viewing: true },
      },
      createdBy: "test",
    });
    const landlordId = newId();
    await database.db.insert(parties).values({ id: landlordId, kind: "company", fullNameEn: "Fictional Holdings LLC" });
    const unitId = newId();
    await database.db.insert(units).values({
      companyId: await testCompany(database),
      id: unitId,
      code: "BB-OF2",
      building: "Demo BB-OF2 Tower",
      community: "Business Bay",
      unitNo: "OF2",
      category: "commercial",
      subtype: "office",
      bedrooms: null,
      bathrooms: 1,
      areaSqft: 2000,
      dldPropertyNo: "DEMO-DLD-000777",
      makaniNo: "2222233333",
      furnished: false,
      state: "LISTED",
      askingRentFils: 15_000_000,
      priceApprovedAt: new Date("2026-10-01T08:00:00Z"),
      landlordPartyId: landlordId,
    });
    const officer = await addStaff(database, "leasing_officer");
    const app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
    });
    const visitorId = newId();
    const send = (input: { kind: "text"; text: string } | { kind: "callback"; data: string }) =>
      handleChannelUpdate(t.ctx, {
        channel: "web",
        updateId: newId(),
        chatId: visitorId,
        from: { id: visitorId },
        ...input,
      } as ChannelUpdate);
    let done = 0;
    const drain = async () => {
      while (done < t.scheduler.jobs.length) {
        const j = t.scheduler.jobs[done++]!;
        if (isTimedAgentJob(j)) continue; // a reminder pg-boss would hold until its startAfter
        if (j.name === APPLICATION_MAIL_JOB)
          await sendApplicationMail(t.ctx, String(j.data.applicationId), j.data.kind as never, Number(j.data.seq));
        if (j.name === INBOUND_JOB) await processInbound(t.ctx, String(j.data.inboundEventId));
      }
    };
    const token = (re: RegExp) => re.exec(t.mailer.sent.at(-1)!.text)?.[1];

    // The chat: email, then Apply now on a commercial unit: company name, contact person.
    await send({ kind: "text", text: "priya@example-ventures.example" });
    await send({ kind: "callback", data: "contact:skip" });
    await send({ kind: "callback", data: `apply:${unitId}` });
    await send({ kind: "text", text: COMPANY });
    await send({ kind: "text", text: "Priya Example Rao" });
    await drain();
    const [a0] = await database.db.select().from(applications);
    const [party] = await database.db.select().from(parties).where(eq(parties.id, a0!.partyId));
    expect(party).toMatchObject({ kind: "company", fullNameEn: COMPANY });

    // The documents: the trade licence and the signatory's Emirates ID (both sides).
    const upload = token(/\/t\/([A-Za-z0-9_-]{30,64})\/documents/)!;
    const put = async (file: string, kind: string, side: string) => {
      const form = new FormData();
      form.set("file", new File([png(file)], "photo.png", { type: "image/png" }));
      form.set("kind", kind);
      form.set("side", side);
      const r = await app.request(`/api/portal/${upload}/documents`, { method: "POST", body: form });
      return ((await r.json()) as { id: string }).id;
    };
    const docs = [
      await put("company-licence.png", "trade_licence", "page"),
      await put("priya-eid-front.png", "emirates_id", "front"),
      await put("priya-eid-back.png", "emirates_id", "back"),
    ];
    const sub = await app.request("/api/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: upload, type: "DOCS_UPLOADED", payload: { documentIds: docs } }),
    });
    expect(sub.status).toBe(202);
    await drain();
    let a = (await database.db.select().from(applications).where(eq(applications.id, a0!.id)))[0]!;
    expect(a.state).toBe("OFFER");
    const [kycd] = await database.db.select().from(parties).where(eq(parties.id, a.partyId));
    expect(kycd).toMatchObject({ kind: "company", fullNameEn: COMPANY, tradeLicenceNo: "CN-4410927" });

    // The offer, accepted through its link; the officer records the reservation.
    await drain();
    const offer = token(/\/t\/([A-Za-z0-9_-]{30,64})\/offer/)!;
    await app.request("/api/inbound", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: offer, type: "OFFER_RESPONDED", payload: { revision: 1, choice: "accept" } }),
    });
    await drain();
    const res = await app.request(`/api/applications/${a0!.id}/reservation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, officer.id, Date.now())}`,
      },
      body: JSON.stringify({ paidOn: "2026-11-02", reference: "TRX-777" }),
    });
    expect(res.status).toBe(200);
    a = (await database.db.select().from(applications).where(eq(applications.id, a0!.id)))[0]!;
    expect(a.state).toBe("CONVERTED");

    // The contract: the company is the tenant (not the contact person) and its trade licence is used.
    const [lease] = await database.db.select().from(leases).where(eq(leases.applicationId, a.id));
    const prepared = await prepareContract(t.ctx, lease!.id, { addendum: DEFAULT_ADDENDUM, actor: "system" });
    expect(prepared.status).toBe("prepared");
    const [k] = await database.db.select().from(contracts).where(eq(contracts.leaseId, lease!.id));
    expect(k!.fields).toMatchObject({
      tenantKind: "company",
      tenantNameEn: COMPANY,
      tenantTradeLicenceNo: "CN-4410927",
    });
    expect(k!.fields.tenantNameEn).not.toBe("Priya Example Rao");

    // The Ejari payload is built from those fields: the company name and the trade licence.
    const built = buildEjariPayload(k!.fields);
    expect(built.ok).toBe(true);
    if (built.ok)
      expect(built.payload).toMatchObject({
        tenantNameEn: COMPANY,
        tenantIdType: "trade_licence",
        tenantIdNo: "CN-4410927",
      });
  });
});
