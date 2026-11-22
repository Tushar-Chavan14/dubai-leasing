import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { DEAL_STATES, DEFAULT_SPA_POLICY } from "@spa/core";
import {
  amlCases,
  amlHits,
  dealEvents,
  deals,
  documents,
  outboundMessages,
  paymentPlanRows,
  portalLinks,
  spaApprovals,
  spaPolicy,
  type SpaDatabase,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { createApp } from "../src/app.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { kycJobKey, requestDocuments, resendDocumentsLink } from "../src/manager/kyc.ts";
import { type DocumentStore, setTargetTransferDate } from "../src/manager/noc.ts";
import {
  guardPortal,
  guardPortalText,
  issuePortalLink,
  loadPortal,
  mailDealParties,
  portalDocumentsPage,
  portalStatus,
  portalUpload,
  resolvePortalToken,
  sendPortalDocuments,
} from "../src/manager/portal.ts";
import { resolvePartyToken } from "../src/manager/party-assistant.ts";
import { hashLinkToken } from "../src/manager/signing.ts";
import { withSpaTx } from "@spa/db";
import { transferBookedMail } from "@spa/helpers";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const BANNED = /\b(aml|screening|sanctions?|pep|edd|risk|flag)\b/i;
const files = new Map<string, Uint8Array>();
const store: DocumentStore = {
  async put(bytes, ext) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${sha256.slice(0, 2)}/${sha256}.${ext}`;
    files.set(path, bytes);
    return { sha256, path, bytes: bytes.byteLength };
  },
};
const png = (tag = "x") =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tag)]);
const pdf = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string; message?: string }) => ({
      status: e.status,
      code: e.code,
      message: e.message,
    }),
  );

describe.skipIf(!url)("buyer and seller portal (C35, S67)", () => {
  let database: SpaDatabase;
  let users: Record<string, U> = {};
  let mailer = new FakeMailer();
  const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
  const jobs: { name: string; data: unknown; key?: string }[] = [];
  const keys = new Set<string>();
  /** A queue like pg-boss's: the same singleton key is accepted once. */
  const boss = {
    send: async (name: string, data?: unknown, opts?: { singletonKey?: string }) => {
      const k = opts?.singletonKey ? `${name}:${opts.singletonKey}` : null;
      if (k && keys.has(k)) return null;
      if (k) keys.add(k);
      jobs.push({ name, data, ...(opts?.singletonKey ? { key: opts.singletonKey } : {}) });
      return "job";
    },
  } as unknown as Pick<PgBoss, "send">;
  const ctx = (): SpaContext => ({
    database,
    clock,
    facts: failClosedFacts,
    mail: { mailer, webBaseUrl: "https://spa.example.test" },
  });
  const rows = async (sql: string, args: unknown[] = []) => (await database.pool.query(sql, args)).rows;
  const tokenIn = (mail: { text: string }, page: "documents" | "status"): string =>
    mail.text.match(new RegExp(`/b/([^/\\s]+)/${page}`))![1]!;

  /** A resale with two buyers and a seller, a plan, and a signing envelope with three signers. */
  async function world(state = "SIGNING") {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    const made = await dealInDraft(ctx(), database, {
      type: "resale_ready",
      buyers: ["Buyer One", "Buyer Two"],
      sellers: ["Seller One"],
      unitNo: "U-101",
    });
    await database.db
      .update(deals)
      .set({ state: state as never, createdBy: `user:${users.officer!.id}`, targetTransferOn: "2026-12-20" })
      .where(eq(deals.id, made.dealId));
    await database.db.insert(paymentPlanRows).values([
      { dealId: made.dealId, seq: 1, label: "Booking", dueOn: "2026-12-01", amountFils: 5_000_000, enteredBy: "u" },
      {
        dealId: made.dealId,
        seq: 2,
        label: "Handover",
        milestone: "On completion",
        amountFils: 7_000_000,
        enteredBy: "u",
      },
    ]);
    const t = (
      await rows(
        "insert into spa_templates (id, name, document_kind, created_by, created_at) values (gen_random_uuid(), $1, 'mou', 'u', now()) returning id",
        [`T-${newId()}`],
      )
    )[0].id;
    const tv = (
      await rows(
        `insert into spa_template_versions (id, template_id, version, doc_id, doc_hash, sections, blanks, look, party_blocks, signature_roles, checks, rules_version, created_by, created_at)
         values (gen_random_uuid(), $1, 1, 'd', 'h', '{}', '[]', '{}', '[]', '{}', '[]', 'r', 'u', now()) returning id`,
        [t],
      )
    )[0].id;
    const ag = (
      await rows(
        `insert into agreements (id, deal_id, kind, version, template_version_id, status, doc_hash, storage_key, values_hash, field_sources, rules_version, policy_version, prepared_by, prepared_at)
         values (gen_random_uuid(), $1, 'mou', 1, $2, 'approved', 'd', 'k', 'v', '{}', 'r', 0, 'system:prepare', now()) returning id`,
        [made.dealId, tv],
      )
    )[0].id;
    const env = (
      await rows(
        `insert into signing_envelopes (id, deal_id, agreement_id, doc_hash, status, created_at) values (gen_random_uuid(), $1, $2, 'd', 'open', now()) returning id`,
        [made.dealId, ag],
      )
    )[0].id;
    for (const [i, [partyId, role]] of (
      [
        [made.buyerIds[0]!, "purchaser"],
        [made.buyerIds[1]!, "purchaser"],
        [made.sellerIds[0]!, "seller"],
      ] as const
    ).entries())
      await rows(
        `insert into signatures (id, envelope_id, seq, role, party_id, name_on_agreement, email, link_token_hash, link_expires_at, anchor)
         values (gen_random_uuid(), $1, $2, $3, $4, 'N', 'n@example.test', $5, '2026-12-19T00:00:00Z', '{}')`,
        [env, i + 1, role, partyId, hashLinkToken(`sign-${newId()}`)],
      );
    return made;
  }

  /** A fresh link straight from the issuer (the mail paths have their own tests). */
  const issue = async (w: { dealId: string }, partyId: string, purpose: "documents" | "view") =>
    withSpaTx(database, async (tx) => {
      const [deal] = await tx.db.select().from(deals).where(eq(deals.id, w.dealId));
      return (await issuePortalLink(tx, ctx(), { deal: deal!, partyId, purpose, by: "system" })).token;
    });

  const app = (over: { documents?: DocumentStore | null } = {}) =>
    createApp({
      database,
      jobs: { boss: boss as never, lastHeartbeat: () => null },
      clock: { today: () => clock.today(), now: () => clock.now(), refresh: async () => {}, offsetDays: 0 } as never,
      sessionSecret: "s".repeat(32),
      demoMode: false,
      nowMs: () => clock.now().getTime(),
      mail: { mailer, webBaseUrl: "https://spa.example.test" },
      ...(over.documents === null ? {} : { documents: over.documents ?? store }),
    });
  const upload = (a: ReturnType<typeof app>, token: string, fields: Record<string, string | File>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return a.request(`/public/portal/${token}/documents`, { method: "POST", body: f });
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  beforeEach(() => {
    mailer = new FakeMailer();
    jobs.length = 0;
    keys.clear();
  });
  afterAll(async () => {
    await database?.close();
  });

  // ---- mail and links -------------------------------------------------------------------------------------------

  test("requesting documents emails every person a documents link; only its hash is stored; asking again mails nobody", async () => {
    const w = await world("PARTY_CHECK");
    const r = await requestDocuments(ctx(), w.dealId, users.officer!);
    expect(r).toMatchObject({ requested: 3, mail: { sent: 3, failed: [] } });
    expect(mailer.sent).toHaveLength(3);
    for (const m of mailer.sent) {
      expect(m.subject).toStartWith("Upload your documents");
      const token = tokenIn(m, "documents");
      const [row] = await database.db
        .select()
        .from(portalLinks)
        .where(eq(portalLinks.tokenHash, hashLinkToken(token)));
      expect(row).toMatchObject({ dealId: w.dealId, purpose: "documents", usedAt: null, supersededAt: null });
      expect(row!.expiresAt!.toISOString()).toBe("2026-12-03T06:00:00.000Z");
    }
    const stored = JSON.stringify(await database.db.select().from(outboundMessages));
    for (const m of mailer.sent) expect(stored).not.toContain(tokenIn(m, "documents"));
    const evs = JSON.stringify(await database.db.select().from(dealEvents));
    for (const m of mailer.sent) expect(evs).not.toContain(tokenIn(m, "documents"));
    const again = await requestDocuments(ctx(), w.dealId, users.officer!);
    expect(again.requested).toBe(0);
    expect(mailer.sent).toHaveLength(3);
  });

  test("a failed mail is shown to staff and not retried; a staff resend issues a new link and kills the old one", async () => {
    const w = await world("PARTY_CHECK");
    mailer.failNext = new Error("smtp down");
    const r = await requestDocuments(ctx(), w.dealId, users.officer!);
    expect(r.mail!.sent).toBe(2);
    expect(r.mail!.failed).toHaveLength(1);
    const failedParty = r.mail!.failed[0]!.partyId;
    expect((await rows("select count(*)::int n from outbound_messages where status = 'failed'"))[0].n).toBe(1);
    await requestDocuments(ctx(), w.dealId, users.officer!);
    expect(mailer.sent).toHaveLength(2);
    expect(await resendDocumentsLink(ctx(), w.dealId, failedParty, users.officer!)).toEqual({ status: "sent" });
    const first = tokenIn(mailer.sent[0]!, "documents");
    const resent = tokenIn(mailer.sent.at(-1)!, "documents");
    expect(await fails(portalDocumentsPage(ctx(), resent))).toBeNull();
    // A second resend kills the one before it.
    await resendDocumentsLink(ctx(), w.dealId, failedParty, users.officer!);
    expect(await fails(portalDocumentsPage(ctx(), resent))).toMatchObject({ status: 410, code: "link_superseded" });
    expect(await fails(portalDocumentsPage(ctx(), first))).toBeNull();
    expect(await fails(resendDocumentsLink(ctx(), w.dealId, failedParty, users.finance!))).toMatchObject({
      status: 403,
    });
    expect(await fails(resendDocumentsLink(ctx(), w.dealId, newId(), users.officer!))).toMatchObject({ status: 422 });
  });

  test("a new documents link kills the old one for the same person; another person's link is untouched", async () => {
    const w = await world("PARTY_CHECK");
    const a1 = await issue(w, w.buyerIds[0]!, "documents");
    const b1 = await issue(w, w.buyerIds[1]!, "documents");
    const a2 = await issue(w, w.buyerIds[0]!, "documents");
    expect(await resolvePortalToken(ctx(), a1)).toBeNull();
    expect(await resolvePortalToken(ctx(), a2)).not.toBeNull();
    expect(await resolvePortalToken(ctx(), b1)).not.toBeNull();
    expect(await fails(loadPortal(ctx(), a1))).toMatchObject({ status: 410, code: "link_superseded" });
  });

  test("a view link lives with the deal, dies on a newer one and when the deal is cancelled or completed", async () => {
    const w = await world("INSTALMENTS");
    const v1 = await issue(w, w.buyerIds[0]!, "view");
    clock.set(new Date("2027-03-01T06:00:00Z"));
    expect(await fails(portalStatus(ctx(), v1))).toBeNull();
    const v2 = await issue(w, w.buyerIds[0]!, "view");
    expect(await fails(portalStatus(ctx(), v1))).toMatchObject({ status: 410, code: "link_superseded" });
    for (const state of ["CANCELLED", "COMPLETED"]) {
      await database.db
        .update(deals)
        .set({ state: state as never })
        .where(eq(deals.id, w.dealId));
      expect(await fails(portalStatus(ctx(), v2))).toMatchObject({ status: 410, code: "link_closed" });
      expect(await resolvePortalToken(ctx(), v2)).toBeNull();
    }
    await database.db
      .update(deals)
      .set({ state: "INSTALMENTS" as never })
      .where(eq(deals.id, w.dealId));
    expect(await fails(portalStatus(ctx(), v2))).toBeNull();
  });

  test("transfer booked and the instalment mail carry a view link; a mail already sent is not sent again and keeps its link", async () => {
    const w = await world("TRANSFER");
    await setTargetTransferDate(ctx(), w.dealId, "2026-12-22", users.manager!);
    const booked = mailer.sent.filter((m) => m.subject.startsWith("Transfer booked"));
    expect(booked).toHaveLength(3);
    for (const m of booked) {
      expect(m.text).toContain("22 December 2026");
      expect(await fails(portalStatus(ctx(), tokenIn(m, "status")))).toBeNull();
    }
    const first = tokenIn(booked[0]!, "status");
    await mailDealParties(ctx(), w.dealId, "transfer_booked:2026-12-22", (i) =>
      transferBookedMail({ ...i, transferOn: "2026-12-22" }),
    );
    expect(mailer.sent.filter((m) => m.subject.startsWith("Transfer booked"))).toHaveLength(3);
    expect(await fails(portalStatus(ctx(), first))).toBeNull();
    // A new date is a new mail, with a new link that replaces the old one.
    await setTargetTransferDate(ctx(), w.dealId, "2026-12-23", users.manager!);
    expect(mailer.sent.filter((m) => m.subject.startsWith("Transfer booked"))).toHaveLength(6);
    expect(await fails(portalStatus(ctx(), first))).toMatchObject({ status: 410 });
  });

  // ---- scope -----------------------------------------------------------------------------------------------------

  test("token scope: a documents link cannot read the plan, a view link cannot upload; unknown and wrong-purpose tokens give one identical body", async () => {
    const w = await world("INSTALMENTS");
    const docs = await issue(w, w.buyerIds[0]!, "documents");
    const view = await issue(w, w.buyerIds[0]!, "view");
    const a = app();
    const body = async (r: Response) => ({ status: r.status, text: await r.text() });
    const unknown = await body(await a.request("/public/portal/no-such-token/status"));
    expect(unknown.status).toBe(404);
    expect(await body(await a.request(`/public/portal/${docs}/status`))).toEqual(unknown);
    expect(await body(await a.request("/public/portal/no-such-token/documents"))).toEqual(
      await body(await a.request(`/public/portal/${view}/documents`)),
    );
    const noUpload = await body(await upload(a, view, { kind: "passport", file: new File([png()], "p.png") }));
    expect(noUpload.status).toBe(404);
    const unknownUpload = await body(
      await upload(a, "no-such-token", { kind: "passport", file: new File([png()], "p.png") }),
    );
    expect(noUpload).toEqual(unknownUpload);
    const noSend = await a.request(`/public/portal/${view}/documents/send`, { method: "POST" });
    expect(await body(noSend)).toEqual(unknown);
    // The documents page has no plan, no step, no amount.
    const page = JSON.stringify(await (await a.request(`/public/portal/${docs}/documents`)).json());
    for (const word of ["Booking", "5000000", "instalments", "plan"]) expect(page).not.toContain(word);
    expect((await database.db.select().from(documents)).length).toBe(0);
  });

  test("a link reaches only its own deal and person: a partyId in the form is never read", async () => {
    const w = await world("PARTY_CHECK");
    const other = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    const a = app();
    const r = await upload(a, t, {
      kind: "passport",
      partyId: w.buyerIds[1]!,
      dealId: other.dealId,
      file: new File([png("passport")], "p.png"),
    });
    expect(r.status).toBe(201);
    const [doc] = await database.db.select().from(documents).where(eq(documents.dealId, w.dealId));
    expect(doc).toMatchObject({ dealId: w.dealId, partyId: w.buyerIds[0], uploadedBy: `party:${w.buyerIds[0]}` });
    const [ev] = await database.db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.type, "PARTY_DOCUMENT_UPLOADED"), eq(dealEvents.entityId, w.dealId)));
    expect(ev).toMatchObject({ entityId: w.dealId, actor: `party:${w.buyerIds[0]}` });
    expect(JSON.stringify(ev!.payload)).toContain("linkId");
    expect(JSON.stringify(ev)).not.toContain(t);
    expect((await database.db.select().from(documents).where(eq(documents.dealId, other.dealId))).length).toBe(0);
  });

  // ---- uploads ---------------------------------------------------------------------------------------------------

  test("upload limits: a kind outside the person's KYC config, a non-PDF/image and an oversized file are refused with plain reasons", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    const a = app();
    const json = async (r: Response) => ({
      status: r.status,
      ...((await r.json()) as { error: string; code: string }),
    });
    const kind = await json(await upload(a, t, { kind: "title_deed", file: new File([png()], "t.png") }));
    expect(kind).toMatchObject({
      status: 422,
      code: "kind_not_asked",
      error: "That is not one of the documents we asked you for.",
    });
    expect((await json(await upload(a, t, { kind: "nonsense", file: new File([png()], "t.png") }))).code).toBe(
      "kind_not_asked",
    );
    const text = await json(
      await upload(a, t, { kind: "passport", file: new File(["just text"], "p.pdf", { type: "application/pdf" }) }),
    );
    expect(text).toMatchObject({
      status: 422,
      code: "invalid_file",
      error: "a PDF or an image (JPEG, PNG, WebP) up to 10 MB",
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(png());
    const bigDirect = await fails(
      portalUpload(ctx(), boss, store, t, { kind: "passport", fileName: "p.png", bytes: big }),
    );
    expect(bigDirect).toMatchObject({ status: 422, code: "invalid_file" });
    const huge = new Uint8Array(10 * 1024 * 1024 + 200_000);
    huge.set(png());
    expect((await upload(a, t, { kind: "passport", file: new File([huge], "p.png") })).status).toBe(413);
    expect((await upload(a, t, { kind: "passport" })).status).toBe(400);
    expect((await database.db.select().from(documents).where(eq(documents.dealId, w.dealId))).length).toBe(0);
    // A good PDF and a good image are taken, and a readable kind is queued for the reader.
    expect((await upload(a, t, { kind: "passport", file: new File([pdf()], "p.pdf") })).status).toBe(201);
    expect((await upload(a, t, { kind: "emirates_id_front", file: new File([png()], "e.png") })).status).toBe(201);
    // A person's identity documents are read by their KYC run, not queued one by one.
    expect(jobs.filter((j) => j.name.includes("read"))).toHaveLength(0);
  });

  test("a company's link takes its own documents: a trade licence is queued for the reader and Send queues the company check", async () => {
    const made = await dealInDraft(ctx(), database, { type: "primary_offplan", buyers: ["Buyer One"] });
    const company = made.sellerIds[0]!;
    const t = await issue(made, company, "documents");
    const page = (await portalDocumentsPage(ctx(), t)) as { fields: { kind: string }[]; role: string };
    expect(page.role).toBe("seller");
    expect(page.fields.map((f) => f.kind)).toEqual(["trade_licence", "memorandum", "board_resolution", "poa"]);
    expect(
      await fails(portalUpload(ctx(), boss, store, t, { kind: "passport", fileName: "p.png", bytes: png() })),
    ).toMatchObject({
      code: "kind_not_asked",
    });
    await portalUpload(ctx(), boss, store, t, { kind: "trade_licence", fileName: "l.pdf", bytes: pdf() });
    expect(jobs.filter((j) => j.name === "spa.document.read")).toHaveLength(1);
    await sendPortalDocuments(ctx(), boss, t);
    expect(jobs.filter((j) => j.key?.includes(":company:"))).toHaveLength(1);
    expect(jobs.filter((j) => j.key?.includes(":kyc:"))).toHaveLength(0);
  });

  test("30 uploads an hour per link: the 31st is 429, and the next hour is open again", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    for (let i = 0; i < 30; i++)
      await portalUpload(ctx(), boss, store, t, { kind: "proof_of_address", fileName: "v.png", bytes: png(`v${i}`) });
    expect(
      await fails(
        portalUpload(ctx(), boss, store, t, { kind: "proof_of_address", fileName: "v.png", bytes: png("x") }),
      ),
    ).toMatchObject({
      status: 429,
    });
    clock.set(new Date("2026-11-19T07:05:00Z"));
    expect(
      await fails(
        portalUpload(ctx(), boss, store, t, { kind: "proof_of_address", fileName: "v.png", bytes: png("y") }),
      ),
    ).toBeNull();
  });

  test("the upload route answers 503 without a document store, and refuses a closed deal", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    expect(
      (await upload(app({ documents: null }), t, { kind: "passport", file: new File([png()], "p.png") })).status,
    ).toBe(503);
  });

  // ---- send my documents -------------------------------------------------------------------------------------------

  test("Send my documents queues one KYC run, uses the link up, opens no gate and changes no state; the same documents are never queued twice", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    expect(await fails(sendPortalDocuments(ctx(), boss, t))).toMatchObject({ status: 422, code: "nothing_uploaded" });
    await portalUpload(ctx(), boss, store, t, { kind: "passport", fileName: "p.png", bytes: png("passport") });
    const before = (await database.db.select().from(deals).where(eq(deals.id, w.dealId)))[0]!;
    const approvals = (await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, w.dealId))).length;
    expect(await sendPortalDocuments(ctx(), boss, t)).toEqual({ sent: true });
    expect(await fails(sendPortalDocuments(ctx(), boss, t))).toMatchObject({ status: 410, code: "link_used" });
    expect(await fails(portalDocumentsPage(ctx(), t))).toMatchObject({ status: 410, code: "link_used" });
    const runs = jobs.filter((j) => j.key?.includes(":kyc:"));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.data).toEqual({ dealId: w.dealId, partyId: w.buyerIds[0] });
    const [docs] = await database.db.select().from(documents).where(eq(documents.partyId, w.buyerIds[0]!));
    expect(runs[0]!.key).toBe(kycJobKey(w.buyerIds[0]!, runs[0]!.key!.split(":kyc:")[1]!));
    expect(docs).toBeDefined();
    const after = (await database.db.select().from(deals).where(eq(deals.id, w.dealId)))[0]!;
    expect(after.state).toBe(before.state);
    expect((await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, w.dealId))).length).toBe(
      approvals,
    );
    // A new link (a new request) for the same unchanged documents is the same job key: nothing more is queued.
    const t2 = await issue(w, w.buyerIds[0]!, "documents");
    expect(await sendPortalDocuments(ctx(), boss, t2)).toEqual({ sent: true });
    expect(jobs.filter((j) => j.key?.includes(":kyc:"))).toHaveLength(1);
    const evs = await database.db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.type, "PORTAL_DOCUMENTS_SENT"), eq(dealEvents.entityId, w.dealId)));
    expect(evs).toHaveLength(2);
    expect(JSON.stringify(evs)).not.toContain(t);
  });

  test("two sends at once: one wins and the other is told the link is used; one KYC run", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    await portalUpload(ctx(), boss, store, t, { kind: "passport", fileName: "p.png", bytes: png("passport") });
    const results = await Promise.all([
      fails(sendPortalDocuments(ctx(), boss, t)),
      fails(sendPortalDocuments(ctx(), boss, t)),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.find((r) => r)).toMatchObject({ status: 410, code: "link_used" });
    expect(jobs.filter((j) => j.key?.includes(":kyc:"))).toHaveLength(1);
  });

  test("the send route works end to end and answers 410 the second time", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[1]!, "documents");
    const a = app();
    expect((await upload(a, t, { kind: "passport", file: new File([png("p")], "p.png") })).status).toBe(201);
    const page = (await (await a.request(`/public/portal/${t}/documents`)).json()) as {
      fields: { kind: string; state: string }[];
    };
    expect(page.fields.find((f) => f.kind === "passport")!.state).toBe("received");
    expect((await a.request(`/public/portal/${t}/documents/send`, { method: "POST" })).status).toBe(200);
    const again = await a.request(`/public/portal/${t}/documents/send`, { method: "POST" });
    expect(again.status).toBe(410);
    expect(((await again.json()) as { code: string }).code).toBe("link_used");
  });

  // ---- what a party sees --------------------------------------------------------------------------------------------

  test("the status page: the step in party words, the plan, transfer day and 'you sign 2 of 3' with no names", async () => {
    const w = await world("SIGNING");
    const buyer = await portalStatus(ctx(), await issue(w, w.buyerIds[1]!, "view"));
    expect(buyer).toMatchObject({
      role: "buyer",
      status: "The agreement is ready to sign. Each person signs in turn.",
      transferDay: "2026-12-20",
      signing: { position: 2, of: 3, signed: false },
      next: { title: expect.any(String), body: expect.any(String) },
    });
    expect(buyer.plan!.instalments.map((i) => [i.label, i.amountFils, i.state])).toEqual([
      ["Booking", 5_000_000, "due"],
      ["Handover", 7_000_000, "due"],
    ]);
    const all = JSON.stringify(buyer);
    for (const name of ["Buyer One", "Buyer Two", "Seller One"]) expect(all).not.toContain(name);
    const seller = await portalStatus(ctx(), await issue(w, w.sellerIds[0]!, "view"));
    expect(seller.role).toBe("seller");
    expect(seller.plan).toBeNull();
    expect(seller.signing).toMatchObject({ position: 3, of: 3 });
  });

  test("confirmed payments show against the instalment", async () => {
    const w = await world("INSTALMENTS");
    const [d] = await database.db.select().from(deals).where(eq(deals.id, w.dealId));
    const q = (sql: string, args: unknown[] = []) => database.pool.query(sql, args);
    const documentId = newId();
    await q(
      `insert into documents (id, deal_id, kind, file_name, mime, size_bytes, sha256, storage_key, uploaded_by, uploaded_at)
       values ($1, $2, 'payment_receipt', 'r.png', 'image/png', 10, $3, $3, 'u', now())`,
      [documentId, d!.id, `r${documentId}`],
    );
    const runId = newId();
    await q(
      `insert into helper_runs (id, helper, deal_id, entity_kind, entity_id, status, result, reasons, prompt_version, rules_version, visibility, created_at)
       values ($1, 'spa_document_reader', $2, 'document', $3, 'ok', '{}', '[]', 'p', 'r', 'staff', now())`,
      [runId, d!.id, documentId],
    );
    const readId = newId();
    await q(
      `insert into document_reads (id, document_id, profile, fields, prompt_version, run_id, read_at)
       values ($1, $2, 'payment_receipt', '{}', 'p', $3, now())`,
      [readId, documentId, runId],
    );
    const pid = newId();
    await q(
      `insert into payments (id, deal_id, seq, document_id, read_id, status, method, amount_read_fils, into_escrow, payer_is_buyer, registered_by, created_at)
       values ($1, $2, 1, $3, $4, 'read', 'transfer', 5000000, true, true, 'u', now())`,
      [pid, d!.id, documentId, readId],
    );
    await q(
      `update payments set status = 'counted', amount_fils = 5000000, confirmed_by = 'user:f', confirmed_at = now() where id = $1`,
      [pid],
    );
    const s = await portalStatus(ctx(), await issue(w, w.buyerIds[0]!, "view"));
    expect(s.plan!.instalments[0]).toMatchObject({ paidFils: 5_000_000, state: "paid" });
    expect(s.plan!.instalments[1]).toMatchObject({ paidFils: 0, state: "due" });
  });

  test("a failed check reads in party words with the reason; a party under a compliance hold reads only Under review", async () => {
    const w = await world("PARTY_CHECK");
    await requestDocuments(ctx(), w.dealId, users.officer!);
    const buyer = w.buyerIds[0]!;
    await database.pool.query(
      `insert into kyc_runs (id, deal_id, party_id, role, config_scope, config_version, status, flags, identity, docs_hash, answers, created_at)
       values (gen_random_uuid(), $1, $2, 'buyer_person', 'any', 0, 'blocked', $3, $4, 'h', '{}', now())`,
      [
        w.dealId,
        buyer,
        JSON.stringify([{ kind: "expired", docId: null }]),
        JSON.stringify({ passportExpiresOn: "2026-01-01" }),
      ],
    );
    const view = await issue(w, buyer, "view");
    const s = await portalStatus(ctx(), view);
    expect(s.documents.attention).toContain("Passport expired. Please upload a valid one.");
    expect(s.next.title).toBe("Send your documents");
    expect(s.documents.underReview).toBe(false);
    // Now a compliance case names this buyer: the reason and the case never show.
    const [a] = await database.db
      .insert(spaApprovals)
      .values({
        id: newId(),
        gate: "aml_flag",
        entityKind: "deal",
        entityId: w.dealId,
        dedupeKey: `${w.dealId}:aml`,
        title: "Compliance review",
        proposal: { note: "Sanctions match" },
        reasons: ["a sanctions match"],
        rulesVersion: null,
        approverRole: "compliance_officer",
        status: "pending",
        proposedBy: "system:aml-screening",
        createdAt: clock.now(),
      } as never)
      .returning({ id: spaApprovals.id });
    const [c] = await database.db
      .insert(amlCases)
      .values({
        id: newId(),
        dealId: w.dealId,
        status: "open",
        approvalId: a!.id,
        summary: "Sanctions match",
        instructionLike: false,
        openedAt: clock.now(),
      })
      .returning({ id: amlCases.id });
    await database.db.insert(amlHits).values({
      id: newId(),
      caseId: c!.id,
      partyId: buyer,
      subjectKey: `party:${buyer}`,
      rule: "sanctions",
      severity: "flag",
      detail: "sanctions list match",
      listVersion: "v1",
      createdAt: clock.now(),
    });
    const held = await portalStatus(ctx(), view);
    expect(held.documents.underReview).toBe(true);
    expect(held.next).toMatchObject({ title: "Under review" });
    expect(held.documents.attention).toEqual(["Additional documents needed."]);
    expect(JSON.stringify(held)).not.toContain("Passport expired");
    // Same flag for everyone on the deal: the page never says who the matter concerns.
    const other = await portalStatus(ctx(), await issue(w, w.buyerIds[1]!, "view"));
    expect(other.documents.underReview).toBe(true);
    expect(other.next).toEqual(held.next);
    expect(other.documents.attention).not.toContain("Additional documents needed.");
  });

  test("an AML_HOLD deal reads Under review", async () => {
    const w = await world("AML_HOLD");
    const s = await portalStatus(ctx(), await issue(w, w.buyerIds[0]!, "view"));
    expect(s.status).toBe("Under review");
  });

  test("a scan of every portal page in every deal state finds no AML, screening, sanction, PEP, EDD, risk or flag word, and no other party", async () => {
    const w = await world("PARTY_CHECK");
    await requestDocuments(ctx(), w.dealId, users.officer!);
    const everyone = [w.buyerIds[0]!, w.buyerIds[1]!, w.sellerIds[0]!];
    for (const state of DEAL_STATES) {
      await database.db
        .update(deals)
        .set({ state: state as never })
        .where(eq(deals.id, w.dealId));
      for (const [i, p] of everyone.entries()) {
        const view = await issue(w, p, "view");
        const docs = await issue(w, p, "documents");
        const pages =
          state === "CANCELLED" || state === "COMPLETED"
            ? [await portalDocumentsPage(ctx(), docs).catch(() => ({}))]
            : [await portalStatus(ctx(), view), await portalDocumentsPage(ctx(), docs)];
        const text = JSON.stringify(pages);
        expect(text).not.toMatch(BANNED);
        expect(text).not.toMatch(/\b(sanction|compliance|launder|suspicious)/i);
        const others = ["Buyer One", "Buyer Two", "Seller One"].filter((_, j) => j !== i);
        for (const o of others) expect(text).not.toContain(o);
      }
    }
    expect(DEAL_STATES.length).toBeGreaterThan(10);
  });

  // ---- the guard and the assistant -----------------------------------------------------------------------------------

  test("the guard replaces any banned word with a fixed line and masks ID and phone numbers, in nested responses too", () => {
    expect(guardPortalText("Your agent is arranging it.")).toBe("Your agent is arranging it.");
    expect(guardPortalText("A sanctions screening hit")).toBe("Your agent can help with that.");
    expect(guardPortalText("risk of default")).toBe("Your agent can help with that.");
    expect(guardPortalText("Emirates ID 784-1990-1234567-1 on file")).not.toContain("1234567");
    const out = guardPortal({ a: ["fine", "the PEP list"], b: { c: "edd needed", d: 5, e: null } });
    expect(out).toEqual({
      a: ["fine", "Your agent can help with that."],
      b: { c: "Your agent can help with that.", d: 5, e: null },
    });
  });

  test("the party assistant resolves a live portal token of either purpose to its own deal and person; a used or replaced one to nothing", async () => {
    const w = await world("INSTALMENTS");
    const docs = await issue(w, w.buyerIds[0]!, "documents");
    const view = await issue(w, w.sellerIds[0]!, "view");
    expect(await resolvePartyToken(ctx(), docs)).toMatchObject({
      kind: "portal",
      dealId: w.dealId,
      partyId: w.buyerIds[0],
      role: "buyer",
    });
    expect(await resolvePartyToken(ctx(), view)).toMatchObject({
      kind: "portal",
      partyId: w.sellerIds[0],
      role: "seller",
    });
    await database.pool.query("update portal_links set used_at = now() where token_hash = $1", [hashLinkToken(docs)]);
    expect(await resolvePartyToken(ctx(), docs)).toBeNull();
    await issue(w, w.sellerIds[0]!, "view");
    expect(await resolvePartyToken(ctx(), view)).toBeNull();
  });

  test("a portal link never changes a deal, unit or listing by itself: only portal events and the person's own upload are written", async () => {
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    const v = await issue(w, w.buyerIds[0]!, "view");
    await portalDocumentsPage(ctx(), t);
    await portalStatus(ctx(), v);
    const types = new Set(
      (
        await database.db
          .select()
          .from(dealEvents)
          .where(and(eq(dealEvents.entityId, w.dealId)))
      ).map((e) => e.type),
    );
    expect([...types].filter((x) => x.startsWith("PORTAL") || x.startsWith("PARTY_DOCUMENT"))).toEqual([
      "PORTAL_LINK_ISSUED",
    ]);
  });

  test("a documents link expires after the policy's documentLinkDays", async () => {
    // Last in the file: a published policy is for good, and every deal made after it is pinned to it.
    await database.db.insert(spaPolicy).values({
      version: 1,
      values: { ...DEFAULT_SPA_POLICY, documentLinkDays: 3 },
      createdBy: "user:x",
      createdAt: clock.now(),
    });
    const w = await world("PARTY_CHECK");
    const t = await issue(w, w.buyerIds[0]!, "documents");
    const [row] = await database.db
      .select()
      .from(portalLinks)
      .where(eq(portalLinks.tokenHash, hashLinkToken(t)));
    expect(row!.expiresAt!.toISOString()).toBe("2026-11-22T06:00:00.000Z");
    clock.set(new Date("2026-11-22T07:00:00Z"));
    expect(await fails(portalDocumentsPage(ctx(), t))).toMatchObject({ status: 410, code: "link_expired" });
  });
});
