import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { PgBoss } from "pg-boss";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { extractPdf, normalizeWs } from "@platform/readers/pdf/extract";
import {
  agreements,
  companyDetails,
  dealEvents,
  deals,
  deposits,
  helperRuns,
  outboundMessages,
  parties,
  signatories,
  signatures,
  signingEnvelopes,
  type SpaDatabase,
  withSpaTx,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { supersedeAgreementOnCancel } from "../src/manager/agreement-cancel.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import { recordDeposit } from "../src/manager/deposits.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { prepareAgreement } from "../src/manager/prepare.ts";
import {
  finishSigning,
  inviteSigners,
  listSigning,
  openSigning,
  remindSigner,
  resendSigningLink,
  signingLinkDocument,
  signingLinkSummary,
  signWithLink,
} from "../src/manager/signing.ts";
import { allSignedFact } from "../src/manager/signing-facts.ts";
import { addTemplateVersion, createTemplate } from "../src/manager/templates.ts";
import { broker, dealInDraft, markScreened, mouTpl, RB, seedUsers, sign, toData, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let users: Record<string, U> = {};
let mailer = new FakeMailer();
let rulebook: NonNullable<SpaContext["rulebook"]> = () => RB;
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const files = new Map<string, Uint8Array>();
const store = {
  async put(bytes: Uint8Array, ext: string) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${sha256.slice(0, 2)}/${sha256}.${ext}`;
    files.set(path, bytes);
    return { sha256, path, bytes: bytes.byteLength };
  },
  async read(key: string) {
    const b = files.get(key);
    if (!b) throw new Error("no such file");
    return b;
  },
};
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const ctx = (): SpaContext => ({
  database,
  clock,
  facts: failClosedFacts,
  rulebook,
  mail: { mailer, webBaseUrl: "https://spa.example.test" },
  // Entering SIGNING opens the envelope in the same transaction (S54).
  onDealEntered: async (e, tx) => {
    if (e.to === "SIGNING") await openSigning(ctx(), tx, e.dealId);
  },
});
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const tokenOf = (m: { text: string }) => /\/b\/([\w-]+)\/sign/.exec(m.text)![1]!;
const sentTo = (email: string) => mailer.sent.filter((m) => m.to === email && /\/b\/[\w-]+\/sign/.test(m.text));
const boss = () => {
  const sent: { name: string; data: unknown; opts: { singletonKey?: string } | undefined }[] = [];
  const send = async (name: string, data: unknown, opts?: { singletonKey?: string }) => (
    sent.push({ name, data, opts }),
    "job"
  );
  return { sent, send: send as unknown as Pick<PgBoss, "send">["send"] };
};
const META = { ip: "203.0.113.9", userAgent: "test-agent" };

/** A ready resale: two buyers, one broker line and a company seller, deposit held, approved and in SIGNING. */
async function world(o: { deposit?: boolean; openOnEnter?: boolean } = {}) {
  const tpl = mouTpl();
  tpl.sections.push({ id: "s4", number: "ARTICLE 4", heading: "BROKER", paragraphs: ["Broker: {{b10}}"] });
  tpl.blanks.push(sign("b10", "Broker"));
  const t = await createTemplate(ctx(), { name: "mou", documentKind: "mou" }, users.admin!);
  const v = await addTemplateVersion(
    ctx(),
    { templateId: t.id, docId: "doc-1", docHash: "a".repeat(64), data: toData(tpl) },
    users.admin!,
  );
  await decideApproval(ctx(), v.approvalId, users.legal!, { decision: "approve" });
  const d = await dealInDraft(ctx(), database, {
    type: "resale_ready",
    unitNo: "B-7",
    buyers: ["Buyer One", "Buyer Two"],
    sellers: ["Seller Company"],
  });
  // The seller becomes a company with a signatory.
  const sellerId = d.sellerIds[0]!;
  await database.db.update(parties).set({ kind: "company" }).where(eq(parties.id, sellerId));
  await database.db.insert(companyDetails).values({
    partyId: sellerId,
    tradeName: "Seller Company",
    licenceNo: "LIC-9",
    licenceExpiresOn: "2027-12-31",
    issuingAuthority: "Fictional Authority",
  });
  const signerId = newId();
  await database.db.insert(parties).values({
    id: signerId,
    kind: "person",
    fullNameEn: "Sam Signatory",
    email: "sam.signatory@example.test",
    passportNo: "X0000009",
    nationality: "Fictionalian",
    createdAt: new Date("2026-11-19T06:00:00Z"),
  });
  await database.db.insert(signatories).values({
    id: newId(),
    companyPartyId: sellerId,
    personPartyId: signerId,
    title: "Director",
    authority: "board_resolution",
    documentId: newId(),
  });
  await broker(database, d.dealId, "seller", "Agency One");
  await markScreened(database, d.dealId);
  if (o.deposit !== false)
    await database.db.insert(deposits).values({
      dealId: d.dealId,
      amountFils: 20_000_000,
      chequeLast4: "1234",
      bank: "Fictional Bank",
      chequeOn: "2026-11-19",
      holder: "Buyer One",
      status: "held",
      recordedAt: new Date("2026-11-19T06:00:00Z"),
    });
  const prepared = await prepareAgreement(ctx(), { store }, d.dealId);
  if (!prepared.ok) throw new Error(`prepare stopped: ${prepared.reasons.join("; ")}`);
  const [ag] = await database.db.select().from(agreements).where(eq(agreements.dealId, d.dealId));
  await decideApproval(ctx(), ag!.approvalId!, users.legal!, { decision: "approve" });
  return { ...d, signerId, agreementId: ag!.id, docHash: ag!.docHash };
}
const envelopeOf = async (dealId: string) =>
  (await database.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.dealId, dealId)))[0];
const sigsOf = async (envelopeId: string) =>
  database.db.select().from(signatures).where(eq(signatures.envelopeId, envelopeId)).orderBy(asc(signatures.seq));
const stateOf = async (id: string) => (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.state;
const factOf = (dealId: string) =>
  withSpaTx(database, async (tx) =>
    allSignedFact(tx, (await tx.db.select().from(deals).where(eq(deals.id, dealId)))[0]!),
  );
/** Everyone's link as emailed, in signing order. */
const linksOf = async (envelopeId: string) => {
  const out: { seq: number; role: string; name: string; email: string; token: string }[] = [];
  for (const s of await sigsOf(envelopeId)) {
    const m = sentTo(s.email).at(-1);
    out.push({ seq: s.seq, role: s.role, name: s.nameOnAgreement, email: s.email, token: tokenOf(m!) });
  }
  return out;
};
const signAs = (token: string, name: string, q: Partial<{ consent: boolean }> = {}) =>
  signWithLink(ctx(), boss(), token, { typedName: name, consent: q.consent ?? true }, META);

describe.skipIf(!url)("signing (C28, S54)", () => {
  beforeEach(async () => {
    files.clear();
    mailer = new FakeMailer();
    rulebook = () => RB;
    clock.set(new Date("2026-11-19T06:00:00Z"));
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
    database = undefined as never;
  });

  test("entering SIGNING builds one envelope for the approved agreement, in order: buyers, broker, seller", async () => {
    const w = await world();
    expect(await stateOf(w.dealId)).toBe("SIGNING");
    const env = (await envelopeOf(w.dealId))!;
    expect([env.agreementId, env.docHash, env.status]).toEqual([w.agreementId, w.docHash, "open"]);
    const rows = await sigsOf(env.id);
    expect(rows.map((r) => [r.seq, r.role, r.nameOnAgreement])).toEqual([
      [1, "purchaser", "Buyer One"],
      [2, "purchaser", "Buyer Two"],
      [3, "broker", "Agency One Agent"],
      [4, "seller", "Sam Signatory"],
    ]);
    expect(rows[3]!.partyId).toBe(w.signerId);
    expect(rows[3]!.email).toBe("sam.signatory@example.test");
    // The C14 anchors of the approved render sit on each signer's row.
    for (const r of rows) expect((r.anchor as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
    // Nothing was emailed yet, and the links are not usable until they are issued.
    expect(mailer.sent).toHaveLength(0);
  });

  test("opening signing again is a no-op: one open envelope per agreement", async () => {
    const w = await world();
    const again = await withSpaTx(database, (tx) => openSigning(ctx(), tx, w.dealId));
    expect(again).toMatchObject({ ok: true });
    expect(await database.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.dealId, w.dealId))).toHaveLength(
      1,
    );
  });

  test("a deal that changed after approval opens no envelope", async () => {
    // Build the world without the hook, move the price, then ask to open signing.
    const saved = ctx;
    const noHook = (): SpaContext => ({ ...saved(), onDealEntered: async () => {} });
    const tpl = mouTpl();
    const t = await createTemplate(noHook(), { name: "mou", documentKind: "mou" }, users.admin!);
    const v = await addTemplateVersion(
      noHook(),
      { templateId: t.id, docId: "doc-1", docHash: "a".repeat(64), data: toData(tpl) },
      users.admin!,
    );
    await decideApproval(noHook(), v.approvalId, users.legal!, { decision: "approve" });
    const d = await dealInDraft(noHook(), database, { type: "resale_ready", unitNo: "B-7" });
    await markScreened(database, d.dealId);
    expect((await prepareAgreement(noHook(), { store }, d.dealId)).ok).toBe(true);
    const [ag] = await database.db.select().from(agreements).where(eq(agreements.dealId, d.dealId));
    await decideApproval(noHook(), ag!.approvalId!, users.legal!, { decision: "approve" });
    expect(await envelopeOf(d.dealId)).toBeUndefined();
    await database.pool.query("update parties set email = 'moved@example.test' where id = $1", [d.buyerIds[0]]);
    const r = await withSpaTx(database, (tx) => openSigning(noHook(), tx, d.dealId));
    expect(r).toEqual({ ok: false, reason: "agreement_changed" });
    expect(await envelopeOf(d.dealId)).toBeUndefined();
    const runs = await database.db.select().from(helperRuns).where(eq(helperRuns.dealId, d.dealId));
    expect(runs.some((x) => x.helper === "spa_signing" && x.status === "needs_human")).toBe(true);
    expect(
      await database.db
        .select()
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, d.dealId), eq(dealEvents.type, "SIGNING_STOPPED"))),
    ).toHaveLength(1);
  });

  test("inviting emails each signer a link valid 14 days; the token is only in the email; inviting twice sends nothing new", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    const r = await inviteSigners(ctx(), env.id);
    expect(r.sent).toBe(4);
    expect(mailer.sent).toHaveLength(4);
    expect(mailer.sent[0]!.subject).toMatch(/^Sign your MOU · /);
    const links = await linksOf(env.id);
    expect(new Set(links.map((l) => l.token)).size).toBe(4);
    const rows = await sigsOf(env.id);
    for (const s of rows) expect(s.linkExpiresAt.toISOString()).toBe("2026-12-03T06:00:00.000Z");
    const dump = JSON.stringify([
      rows,
      (await database.pool.query("select * from outbound_messages")).rows,
      (await database.pool.query("select * from deal_events")).rows,
    ]);
    for (const l of links) expect(dump).not.toContain(l.token);
    const out = await database.db.select().from(outboundMessages);
    expect(out).toHaveLength(4);
    for (const m of out) {
      expect([m.status, m.purpose, m.template]).toEqual(["sent", "link", "sign_link"]);
      expect(m.bodySha256).toHaveLength(64);
      expect(m.smtpResponse).toContain("250");
    }
    expect((await inviteSigners(ctx(), env.id)).sent).toBe(0);
    expect(mailer.sent).toHaveLength(4);
  });

  test("the link page shows whose turn it is; the document is the approved PDF", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [b1, b2] = await linksOf(env.id);
    const s1 = await signingLinkSummary(ctx(), b1!.token);
    expect(s1).toMatchObject({
      role: "purchaser",
      name: "Buyer One",
      yourTurn: true,
      document: "MOU",
      position: 1,
      of: 4,
    });
    expect(JSON.stringify(s1)).not.toMatch(/aml|launder|sanction/i);
    expect((await signingLinkSummary(ctx(), b2!.token))!.yourTurn).toBe(false);
    const pdf = await signingLinkDocument(ctx(), { store }, b2!.token);
    expect(sha(pdf)).toBe(w.docHash);
    expect(await signingLinkSummary(ctx(), "nope")).toBeNull();
  });

  test("a link works once, in turn, with the name as written; a replay, a wrong name, no consent and an early signer are refused", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [b1, b2, , seller] = await linksOf(env.id);
    expect(await fails(signAs(seller!.token, "Sam Signatory"))).toEqual({ status: 409, code: "not_your_turn" });
    expect(await fails(signAs(b2!.token, "Buyer Two"))).toEqual({ status: 409, code: "not_your_turn" });
    expect(await fails(signAs(b1!.token, "Somebody Else"))).toEqual({ status: 422, code: "name_mismatch" });
    expect(await fails(signAs(b1!.token, "Buyer One", { consent: false }))).toMatchObject({ status: 422 });
    expect((await sigsOf(env.id))[0]!.signedAt).toBeNull();
    // Case and spacing are a typo-class match.
    const ok = await signAs(b1!.token, "  buyer  one ");
    expect(ok.signed).toBe(true);
    const [row] = await sigsOf(env.id);
    expect([row!.typedName, row!.consent, row!.ip, row!.userAgent]).toEqual([
      "buyer  one",
      true,
      META.ip,
      META.userAgent,
    ]);
    expect(row!.signedAt!.toISOString()).toBe("2026-11-19T06:00:00.000Z");
    expect(row!.linkUsedAt).not.toBeNull();
    expect(await fails(signAs(b1!.token, "Buyer One"))).toEqual({ status: 410, code: "link_used" });
    expect(await database.db.select().from(signatures).where(eq(signatures.envelopeId, env.id))).toHaveLength(4);
    expect((await sigsOf(env.id)).filter((s) => s.signedAt)).toHaveLength(1);
    expect(await fails(signingLinkDocument(ctx(), { store }, b1!.token))).toEqual({ status: 410, code: "link_used" });
  });

  test("an expired link is refused (410) and a resend gives a new one", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [b1] = await linksOf(env.id);
    clock.set(new Date("2026-12-04T06:00:00Z"));
    expect(await fails(signAs(b1!.token, "Buyer One"))).toEqual({ status: 410, code: "link_expired" });
    const [row] = await sigsOf(env.id);
    await resendSigningLink(ctx(), w.dealId, row!.id, users.officer!);
    const fresh = sentTo(row!.email).at(-1)!;
    expect(sentTo(row!.email)).toHaveLength(2);
    expect(tokenOf(fresh)).not.toBe(b1!.token);
    expect((await signAs(tokenOf(fresh), "Buyer One")).signed).toBe(true);
  });

  test("a resend kills the old link; only sales roles may resend; a signed signer can't be resent", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [b1] = await linksOf(env.id);
    const [row] = await sigsOf(env.id);
    expect(await fails(resendSigningLink(ctx(), w.dealId, row!.id, users.finance!))).toMatchObject({ status: 403 });
    await resendSigningLink(ctx(), w.dealId, row!.id, users.manager!);
    expect(await signingLinkSummary(ctx(), b1!.token)).toBeNull();
    expect(await fails(signAs(b1!.token, "Buyer One"))).toEqual({ status: 404, code: "not_found" });
    const newest = tokenOf(sentTo(row!.email).at(-1)!);
    await signAs(newest, "Buyer One");
    expect(await fails(resendSigningLink(ctx(), w.dealId, row!.id, users.manager!))).toMatchObject({ status: 409 });
    const out = await database.db.select().from(outboundMessages).where(eq(outboundMessages.entityId, row!.id));
    expect(out.map((m) => m.milestone).toSorted()).toEqual(["link:1", "link:2"]);
  });

  test("the reminder goes to the signer whose turn it is, carries no link, and stops once signed or superseded", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [r1, r2] = await sigsOf(env.id);
    const links = await linksOf(env.id);
    mailer.sent.length = 0;
    const b = boss();
    expect(await remindSigner(ctx(), b, { signatureId: r1!.id, n: 1 })).toMatchObject({ status: "sent" });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toMatch(/^Reminder: sign your MOU · /);
    expect(mailer.sent[0]!.text).not.toMatch(/https?:\/\//);
    expect(mailer.sent[0]!.text + mailer.sent[0]!.html).not.toMatch(/aml|launder|sanction/i);
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]!.name).toBe("spa.signing.remind");
    expect(b.sent[0]!.opts!.singletonKey).toBe(`${r1!.id}:remind:2`);
    // The same reminder is never sent twice (safe to run twice).
    expect(await remindSigner(ctx(), boss(), { signatureId: r1!.id, n: 1 })).toMatchObject({ status: "skipped" });
    expect(mailer.sent).toHaveLength(1);
    // Out of turn: no mail, but the chain goes on.
    const b2 = boss();
    expect(await remindSigner(ctx(), b2, { signatureId: r2!.id, n: 1 })).toMatchObject({ status: "not_their_turn" });
    expect(mailer.sent).toHaveLength(1);
    expect(b2.sent).toHaveLength(1);
    // Signed: stops, nothing queued.
    await signAs(links[0]!.token, "Buyer One");
    const b3 = boss();
    expect(await remindSigner(ctx(), b3, { signatureId: r1!.id, n: 2 })).toMatchObject({ status: "stopped" });
    expect(b3.sent).toHaveLength(0);
    // Superseded: stops.
    await withSpaTx(database, (tx) => supersedeAgreementOnCancel(ctx(), tx, w.dealId, "system"));
    const b4 = boss();
    expect(await remindSigner(ctx(), b4, { signatureId: r2!.id, n: 2 })).toMatchObject({ status: "stopped" });
    expect(b4.sent).toHaveLength(0);
  });

  test("a cancelled or superseded agreement supersedes its envelope and kills its links", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [b1] = await linksOf(env.id);
    await withSpaTx(database, (tx) => supersedeAgreementOnCancel(ctx(), tx, w.dealId, "system"));
    expect((await envelopeOf(w.dealId))!.status).toBe("superseded");
    expect(await fails(signAs(b1!.token, "Buyer One"))).toEqual({ status: 410, code: "link_superseded" });
    expect(await fails(signingLinkDocument(ctx(), { store }, b1!.token))).toEqual({
      status: 410,
      code: "link_superseded",
    });
    expect(await factOf(w.dealId)).toBe(false);
  });

  test("everyone signs in order; finishing stamps the PDF, stores its hash, advances ALL_SIGNED and emails the signed copy", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const links = await linksOf(env.id);
    const b = boss();
    for (const [i, l] of links.entries()) {
      expect(await factOf(w.dealId)).toBe(false);
      clock.set(new Date(`2026-11-19T${String(7 + i).padStart(2, "0")}:00:00Z`));
      const r = await signWithLink(ctx(), b, l.token, { typedName: l.name, consent: true }, META);
      expect(r.signed).toBe(true);
    }
    // The last signature queued the finish job once.
    expect(b.sent.filter((s) => s.name === "spa.signing.finish")).toHaveLength(1);
    expect(b.sent.find((s) => s.name === "spa.signing.finish")!.opts!.singletonKey).toBe(`${env.id}:finish`);
    // Signed but not finished: the fact is still false and the deal is still in SIGNING.
    expect(await factOf(w.dealId)).toBe(false);
    expect(await stateOf(w.dealId)).toBe("SIGNING");

    mailer.sent.length = 0;
    const r = await finishSigning(ctx(), { store }, env.id);
    expect(r).toMatchObject({ finished: true, advanced: true });
    const done = (await envelopeOf(w.dealId))!;
    expect(done.status).toBe("complete");
    expect(done.signedDocHash).toHaveLength(64);
    expect(done.signedDocHash).not.toBe(w.docHash);
    const signedBytes = files.get(done.storageKey!)!;
    expect(sha(signedBytes)).toBe(done.signedDocHash!);
    const pdf = await extractPdf(signedBytes);
    if (!pdf.ok) throw new Error("not a text pdf");
    const text = normalizeWs(pdf.text);
    for (const s of [
      "Signature record",
      w.docHash,
      "Purchaser: Buyer One",
      "Purchaser: Buyer Two",
      "Broker: Agency One Agent",
      "Seller: Sam Signatory",
      "Typed name: Sam Signatory",
      "2026-11-19T10:00:00.000Z",
    ])
      expect(text).toContain(s);
    // The typed names are stamped on the signature lines too (more than the record page alone holds).
    expect(text.split("Sam Signatory").length).toBeGreaterThan(3);
    expect(await stateOf(w.dealId)).toBe("NOC");
    expect(await factOf(w.dealId)).toBe(true);
    const ev = await database.db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.entityId, w.dealId), eq(dealEvents.type, "ALL_SIGNED")));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.actor).toBe("system:signing");
    // The signed copy went to every signer, with the PDF attached and its hash kept.
    expect(mailer.sent).toHaveLength(4);
    expect(mailer.sent.every((m) => m.subject.startsWith("Your signed MOU · "))).toBe(true);
    const copies = await database.db.select().from(outboundMessages).where(eq(outboundMessages.purpose, "receipt"));
    expect(copies).toHaveLength(4);
    for (const c of copies) expect(c.attachmentSha256s).toEqual([done.signedDocHash!]);
    // Running it again changes nothing and sends nothing.
    mailer.sent.length = 0;
    expect(await finishSigning(ctx(), { store }, env.id)).toMatchObject({ finished: false });
    expect(mailer.sent).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, w.dealId), eq(dealEvents.type, "ALL_SIGNED"))),
    ).toHaveLength(1);
    // A changed deal makes the fact false again.
    await database.pool.query("update parties set email = 'moved@example.test' where id = $1", [w.buyerIds[0]]);
    expect(await factOf(w.dealId)).toBe(false);
  });

  test("finishing early is refused; the resale deposit guard still applies", async () => {
    const w = await world({ deposit: false });
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    expect(await finishSigning(ctx(), { store }, env.id)).toMatchObject({
      finished: false,
      reason: "not_everyone_signed",
    });
    for (const l of await linksOf(env.id)) await signAs(l.token, l.name);
    const first = await finishSigning(ctx(), { store }, env.id);
    expect(first).toMatchObject({ finished: true, advanced: false });
    expect(await stateOf(w.dealId)).toBe("SIGNING");
    expect((await envelopeOf(w.dealId))!.status).toBe("complete");
    expect(
      await database.db
        .select()
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, w.dealId), eq(dealEvents.type, "SIGNING_ADVANCE_BLOCKED"))),
    ).toHaveLength(1);
    // The deposit is held; the job runs again and the deal moves on.
    await database.db.insert(deposits).values({
      dealId: w.dealId,
      amountFils: 20_000_000,
      chequeLast4: "1234",
      bank: "Fictional Bank",
      chequeOn: "2026-11-19",
      holder: "Buyer One",
      status: "held",
      recordedAt: new Date("2026-11-19T06:00:00Z"),
    });
    expect(await finishSigning(ctx(), { store }, env.id)).toMatchObject({ advanced: true });
    expect(await stateOf(w.dealId)).toBe("NOC");
  });

  test("a deposit recorded after everyone signed queues the finish job, once; before that it queues nothing (C28 gap)", async () => {
    const cheque = { chequeNo: "001234", bank: "Fictional Bank", chequeOn: "2026-11-19", holder: "Buyer One" };
    // Nobody has signed yet: recording the deposit queues nothing.
    const early = await world({ deposit: false });
    const earlyBoss = boss();
    await recordDeposit(ctx(), early.dealId, cheque, `user:${users.officer!.id}`, { boss: earlyBoss });
    expect(earlyBoss.sent).toEqual([]);

    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    const w = await world({ deposit: false });
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    for (const l of await linksOf(env.id)) await signAs(l.token, l.name);
    expect(await finishSigning(ctx(), { store }, env.id)).toMatchObject({ finished: true, advanced: false });
    expect(await stateOf(w.dealId)).toBe("SIGNING");
    const b = boss();
    await recordDeposit(ctx(), w.dealId, cheque, `user:${users.officer!.id}`, { boss: b });
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]).toMatchObject({
      name: "spa.signing.finish",
      data: { envelopeId: env.id },
      opts: { singletonKey: `${env.id}:finish` },
    });
    // The job runs and the deal moves on; recording a deposit never advances it by itself.
    expect(await finishSigning(ctx(), { store }, env.id)).toMatchObject({ advanced: true });
    expect(await stateOf(w.dealId)).toBe("NOC");
    // A queue that is down never undoes the deposit.
    const down = { send: async () => Promise.reject(new Error("queue down")) } as unknown as Pick<PgBoss, "send">;
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    const again = await world({ deposit: false });
    const links = await envelopeOf(again.dealId);
    await inviteSigners(ctx(), links!.id);
    for (const l of await linksOf(links!.id)) await signAs(l.token, l.name);
    expect(await recordDeposit(ctx(), again.dealId, cheque, `user:${users.officer!.id}`, { boss: down })).toMatchObject(
      {
        amountFils: expect.any(Number),
      },
    );
  });

  test("staff read the signing status without links or addresses", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const s = await listSigning(ctx(), w.dealId, users.officer!);
    expect(s!.envelope).toMatchObject({ status: "open" });
    expect(s!.signers.map((x) => [x.seq, x.role, x.signed, x.mail])).toEqual([
      [1, "purchaser", false, "sent"],
      [2, "purchaser", false, "sent"],
      [3, "broker", false, "sent"],
      [4, "seller", false, "sent"],
    ]);
    const dump = JSON.stringify(s);
    expect(dump).not.toMatch(/example\.test|token|hash/i);
    expect(await fails(listSigning(ctx(), w.dealId, { id: "x", role: "mlro" }))).toMatchObject({ status: 403 });
  });
});

describe.skipIf(!url)("signing routes (C28, S54)", () => {
  const SECRET = "s".repeat(40);
  const NOW = Date.now();
  beforeEach(async () => {
    files.clear();
    mailer = new FakeMailer();
    clock.set(new Date("2026-11-19T06:00:00Z"));
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  const app = (b = boss()) =>
    createApp({
      database,
      jobs: { boss: b as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      rulebook: () => RB,
      documents: store,
      mail: { mailer, webBaseUrl: "https://spa.example.test" },
    });
  const as = (u: { id: string }) => ({ authorization: `Bearer ${issueToken(SECRET, u.id, NOW)}` });
  const json = (body: unknown, extra: Record<string, string> = {}) => ({
    method: "POST",
    headers: { "content-type": "application/json", ...extra },
    body: JSON.stringify(body),
  });

  test("public link routes: summary, PDF, sign (name, consent, replay) and the resend route", async () => {
    const w = await world();
    const env = (await envelopeOf(w.dealId))!;
    await inviteSigners(ctx(), env.id);
    const [b1, b2] = await linksOf(env.id);
    const a = app();
    const sum = await a.request(`/public/sign-links/${b1!.token}`);
    expect(sum.status).toBe(200);
    expect(await sum.json()).toMatchObject({ yourTurn: true, role: "purchaser" });
    const doc = await a.request(`/public/sign-links/${b1!.token}/document`);
    expect(doc.status).toBe(200);
    expect(doc.headers.get("content-type")).toBe("application/pdf");
    expect(sha(new Uint8Array(await doc.arrayBuffer()))).toBe(w.docHash);
    expect((await a.request("/public/sign-links/nope")).status).toBe(404);
    expect(
      (await a.request(`/public/sign-links/${b2!.token}/sign`, json({ typedName: "Buyer Two", consent: true }))).status,
    ).toBe(409);
    expect(
      (await a.request(`/public/sign-links/${b1!.token}/sign`, json({ typedName: "Wrong Name", consent: true })))
        .status,
    ).toBe(422);
    expect((await a.request(`/public/sign-links/${b1!.token}/sign`, json({ typedName: "Buyer One" }))).status).toBe(
      400,
    );
    const ok = await a.request(
      `/public/sign-links/${b1!.token}/sign`,
      json(
        { typedName: "Buyer One", consent: true },
        { "user-agent": "route-agent", "x-forwarded-for": "198.51.100.7" },
      ),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ signed: true });
    expect((await sigsOf(env.id))[0]).toMatchObject({ userAgent: "route-agent" });
    expect(
      (await a.request(`/public/sign-links/${b1!.token}/sign`, json({ typedName: "Buyer One", consent: true }))).status,
    ).toBe(410);
    // Resend: a sales role may; the old link dies.
    const row = (await sigsOf(env.id))[1]!;
    const denied = await a.request(
      `/api/deals/${w.dealId}/signing/resend`,
      json({ signatureId: row.id }, as(users.finance!)),
    );
    expect(denied.status).toBe(403);
    const res = await a.request(
      `/api/deals/${w.dealId}/signing/resend`,
      json({ signatureId: row.id }, as(users.officer!)),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain("/b/");
    expect((await a.request(`/public/sign-links/${b2!.token}`)).status).toBe(404);
    const status = await a.request(`/api/deals/${w.dealId}/signing`, { headers: as(users.officer!) });
    expect(status.status).toBe(200);
  });
});
