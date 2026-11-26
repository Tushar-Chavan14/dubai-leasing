import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY } from "@spa/core";
import {
  bankLetters,
  dealEvents,
  deals,
  documents,
  listingParties,
  listings,
  nocRecords,
  parties,
  type SpaDatabase,
  spaApprovals,
  spaUsers,
  withSpaTx,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  confirmBankAmount,
  type DocumentStore,
  nocExpirySweep,
  recordBankLetter,
  recordNoc,
  setDealUnit,
  setTargetTransferDate,
  uploadDocument,
} from "../src/manager/noc.ts";
import { markScreened } from "./prepare-fixtures.ts";
import { publishPolicy } from "../src/manager/policy.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts });
const users: Record<
  string,
  { id: string; role: "sales_officer" | "sales_manager" | "sales_admin" | "admin" | "finance" | "legal" }
> = {};
const officer = () => users.officer!;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const store: DocumentStore = {
  async put(bytes, ext) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { sha256, path: `${sha256.slice(0, 2)}/${sha256}.${ext}`, bytes: bytes.byteLength };
  },
};
const PDF = new TextEncoder().encode("%PDF-1.4 fictional NOC");

async function party(name: string) {
  const id = newId();
  await database.db.insert(parties).values({
    id,
    kind: "person",
    fullNameEn: name,
    email: `${id.slice(-6)}@example.test`,
    passportNo: "X0000001",
    createdAt: new Date("2026-11-19T06:00:00Z"),
  });
  return id;
}
/** A resale in `NOC` (forced: the earlier steps are other chunks), unit A-101, sellers "Seller One" and "Seller Two". */
async function resaleInNoc(
  o: { type?: "resale_ready" | "resale_offplan"; seller?: boolean; buyer?: boolean; price?: number } = {},
) {
  const listingId = newId();
  await database.db.insert(listings).values({ id: listingId, state: "ACTIVE", permitExpiresOn: "2027-05-01" });
  const s1 = await party("Seller One");
  const s2 = await party("Seller Two");
  await database.db.insert(listingParties).values([
    { listingId, partyId: s1, order: 1 },
    { listingId, partyId: s2, order: 2 },
  ]);
  const buyer = await party("Buyer");
  const d = await createDeal(
    ctx(),
    {
      dealType: o.type ?? "resale_ready",
      sellerMortgage: o.seller ?? false,
      buyerMortgage: o.buyer ?? false,
      planTakenOver: false,
      listingId,
      priceFils: o.price ?? 200_000_000,
      parties: [
        { role: "buyer", partyId: buyer, order: 1 },
        { role: "seller", partyId: s1, order: 1 },
        { role: "seller", partyId: s2, order: 2 },
      ],
    },
    "system",
  );
  await database.db.update(deals).set({ state: "NOC" }).where(eq(deals.id, d.id));
  await markScreened(database, d.id);
  await setDealUnit(ctx(), d.id, { unitNo: "A-101", projectCode: "P1" }, officer());
  return d.id;
}
const state = async (id: string) => (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.state;
const doc = (dealId: string, kind = "noc") =>
  uploadDocument(ctx(), store, dealId, { kind: kind as never, fileName: "f.pdf", bytes: PDF }, officer());
const nocInput = async (dealId: string, o: Record<string, unknown> = {}) => ({
  documentId: (await doc(dealId)).id,
  unitNo: "A-101",
  sellerNames: ["Seller One", "Seller Two"],
  issuedOn: "2026-11-01",
  expiresOn: "2027-03-01",
  serviceChargesCleared: true,
  ...o,
});
const events = async (dealId: string, type: string) =>
  database.db
    .select()
    .from(dealEvents)
    .where(and(eq(dealEvents.entityId, dealId), eq(dealEvents.type, type)));
const pendingReviews = async (dealId: string) =>
  database.db
    .select()
    .from(spaApprovals)
    .where(
      and(eq(spaApprovals.entityId, dealId), eq(spaApprovals.gate, "noc_review"), eq(spaApprovals.status, "pending")),
    );

describe.skipIf(!url)("NOC and bank letters (C15)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const [k, role] of Object.entries({
      officer: "sales_officer",
      manager: "sales_manager",
      salesadmin: "sales_admin",
      admin: "admin",
      finance: "finance",
      legal: "legal",
    } as const)) {
      users[k] = { id: newId(), role };
      await database.db.insert(spaUsers).values({ ...users[k]!, email: `${k}@spa-demo.test`, name: k });
    }
  });

  test("upload: PDF or image by its first bytes, a size cap, a role; the file is hashed; the event has no file name", async () => {
    const id = await resaleInNoc();
    const r = await doc(id);
    const [row] = await database.db.select().from(documents).where(eq(documents.id, r.id));
    expect([row?.kind, row?.mime, row?.sha256]).toEqual([
      "noc",
      "application/pdf",
      createHash("sha256").update(PDF).digest("hex"),
    ]);
    const text = new TextEncoder().encode("not a pdf");
    expect(
      await fails(uploadDocument(ctx(), store, id, { kind: "noc", fileName: "a.pdf", bytes: text }, officer())),
    ).toEqual({
      status: 422,
      code: "invalid_file",
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    expect(
      await fails(uploadDocument(ctx(), store, id, { kind: "noc", fileName: "a.pdf", bytes: big }, officer())),
    ).toEqual({
      status: 422,
      code: "invalid_file",
    });
    expect(
      await fails(uploadDocument(ctx(), store, id, { kind: "noc", fileName: "a.pdf", bytes: PDF }, users.finance!)),
    ).toEqual({
      status: 403,
      code: "forbidden",
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    expect(
      (await uploadDocument(ctx(), store, id, { kind: "noc", fileName: "scan.png", bytes: png }, officer())).id,
    ).toBeString();
    const ev = await events(id, "DOCUMENT_UPLOADED");
    expect(ev).toHaveLength(2);
    expect(JSON.stringify(ev[0]!.payload)).not.toContain("f.pdf");
  });

  test("target transfer date: sales manager, sales admin or admin only; not in the past", async () => {
    const id = await resaleInNoc();
    expect(await fails(setTargetTransferDate(ctx(), id, "2027-01-15", officer()))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(setTargetTransferDate(ctx(), id, "2027-01-15", users.finance!))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(setTargetTransferDate(ctx(), id, "2026-11-18", users.manager!))).toEqual({
      status: 422,
      code: "invalid_date",
    });
    for (const u of [users.manager!, users.salesadmin!, users.admin!])
      await setTargetTransferDate(ctx(), id, "2027-01-15", u);
    expect((await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.targetTransferOn).toBe("2027-01-15");
    expect(await events(id, "TARGET_TRANSFER_DATE_SET")).toHaveLength(3);
  });

  test("a matching NOC advances a deal with no mortgage to SETTLEMENT as system:noc-check", async () => {
    const id = await resaleInNoc();
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    const r = await recordNoc(ctx(), id, await nocInput(id), officer());
    expect(r).toMatchObject({ status: "matched", codes: [] });
    expect(await state(id)).toBe("SETTLEMENT");
    const [ev] = await events(id, "NOC_OK");
    expect([ev?.actor, ev?.toState]).toEqual(["system:noc-check", "SETTLEMENT"]);
    expect(await pendingReviews(id)).toHaveLength(0);
  });

  test("a NOC that expires before the target date opens noc_review; only a sales admin decides, not the proposer", async () => {
    const id = await resaleInNoc();
    await setTargetTransferDate(ctx(), id, "2027-04-01", users.manager!);
    const r = await recordNoc(ctx(), id, await nocInput(id), officer());
    expect(r).toMatchObject({ status: "review", codes: ["expired_before_transfer"] });
    expect(await state(id)).toBe("NOC");
    const [rev] = await pendingReviews(id);
    expect([rev?.approverRole, rev?.proposedBy]).toEqual(["sales_admin", "system:noc-check"]);
    expect(await fails(decideApproval(ctx(), rev!.id, officer(), { decision: "approve" }))).toMatchObject({
      status: 403,
    });
    expect(await fails(decideApproval(ctx(), rev!.id, users.admin!, { decision: "approve" }))).toMatchObject({
      status: 403,
    });
    expect(await state(id)).toBe("NOC");
    await decideApproval(ctx(), rev!.id, users.salesadmin!, { decision: "approve" });
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("a deal with no target date can't pass a NOC without review; entering it again keeps one open review", async () => {
    const id = await resaleInNoc();
    const r = await recordNoc(ctx(), id, await nocInput(id), officer());
    expect(r.codes).toEqual(["no_target_date"]);
    expect(await pendingReviews(id)).toHaveLength(1);
    // The same codes on a corrected NOC: the old review is cancelled, one open review remains.
    await recordNoc(ctx(), id, await nocInput(id), officer());
    expect(await pendingReviews(id)).toHaveLength(1);
    expect(await database.db.select().from(nocRecords).where(eq(nocRecords.dealId, id))).toHaveLength(2);
    expect(
      await database.db
        .select()
        .from(nocRecords)
        .where(and(eq(nocRecords.dealId, id), eq(nocRecords.status, "superseded"))),
    ).toHaveLength(1);
  });

  test("setting the target date later re-checks a matched NOC: the deal waits in NOC until it is reviewed", async () => {
    const id = await resaleInNoc({ seller: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id), officer());
    expect(await state(id)).toBe("FINANCE");
    // A move later than the NOC's expiry changes what was checked; while the deal is in FINANCE nothing moves back,
    // but the open NOC is flagged for review.
    await setTargetTransferDate(ctx(), id, "2027-06-01", users.manager!);
    expect(await pendingReviews(id)).toHaveLength(1);
  });

  test("an expired NOC leaves nocOk false even with an approved review", async () => {
    const id = await resaleInNoc();
    await setTargetTransferDate(ctx(), id, "2027-04-01", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id, { expiresOn: "2026-12-01" }), officer());
    const [rev] = await pendingReviews(id);
    clock.set(new Date("2026-12-05T06:00:00Z"));
    await decideApproval(ctx(), rev!.id, users.salesadmin!, { decision: "approve" });
    expect(await state(id)).toBe("NOC");
    const facts = await withSpaTx(database, async (tx) =>
      failClosedFacts.deal(tx, (await tx.db.select().from(deals).where(eq(deals.id, id)))[0]!, clock.today()),
    );
    expect(facts.nocOk).toBe(false);
  });

  test("a NOC already past its expiry can't be entered", async () => {
    const id = await resaleInNoc();
    expect(await fails(recordNoc(ctx(), id, await nocInput(id, { expiresOn: "2026-11-18" }), officer()))).toEqual({
      status: 422,
      code: "noc_expired",
    });
  });

  test("a seller name or unit that differs is a mismatch; the names are matched one to one", async () => {
    const id = await resaleInNoc();
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    expect((await recordNoc(ctx(), id, await nocInput(id, { sellerNames: ["Seller One"] }), officer())).codes).toEqual([
      "seller_names_mismatch",
    ]);
    expect((await recordNoc(ctx(), id, await nocInput(id, { unitNo: "B-202" }), officer())).codes).toEqual([
      "unit_mismatch",
    ]);
    expect(await state(id)).toBe("NOC");
  });

  test("a NOC document must be this deal's NOC upload; roles that enter records are limited", async () => {
    const id = await resaleInNoc();
    const other = await resaleInNoc();
    const foreign = await doc(other);
    expect(await fails(recordNoc(ctx(), id, await nocInput(id, { documentId: foreign.id }), officer()))).toEqual({
      status: 422,
      code: "invalid_document",
    });
    const letter = await doc(id, "liability_letter");
    expect(await fails(recordNoc(ctx(), id, await nocInput(id, { documentId: letter.id }), officer()))).toEqual({
      status: 422,
      code: "invalid_document",
    });
    expect(await fails(recordNoc(ctx(), id, await nocInput(id), users.legal!))).toEqual({
      status: 403,
      code: "forbidden",
    });
  });

  test("off-plan resale: paid below the policy minimum goes to review; a read-only amount is unconfirmed", async () => {
    const id = await resaleInNoc({ type: "resale_offplan", price: 200_000_000 });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    expect((await recordNoc(ctx(), id, await nocInput(id, { paidFils: 79_999_999 }), officer())).codes).toEqual([
      "below_minimum_paid",
    ]);
    expect((await recordNoc(ctx(), id, await nocInput(id, { paidReadFils: 90_000_000 }), officer())).codes).toEqual([
      "paid_unconfirmed",
    ]);
    const [cur] = await database.db
      .select()
      .from(nocRecords)
      .where(and(eq(nocRecords.dealId, id), eq(nocRecords.status, "review")));
    expect([cur?.paidFils, cur?.paidReadFils]).toEqual([null, 90_000_000]);
    expect(await state(id)).toBe("NOC");
    const ok = await recordNoc(ctx(), id, await nocInput(id, { paidFils: 80_000_000 }), officer());
    expect(ok.status).toBe("matched");
    expect(await state(id)).toBe("SETTLEMENT");
    const [row] = await database.db.select().from(nocRecords).where(eq(nocRecords.id, ok.id));
    expect(row?.paidConfirmedBy).toBe(officer().id);
  });

  test("the minimum paid comes from the project's rule in the policy pinned on the deal", async () => {
    await publishPolicy(
      ctx(),
      {
        ...DEFAULT_SPA_POLICY,
        nocRules: [...DEFAULT_SPA_POLICY.nocRules, { projectCode: "P1", minPaidBps: 1000, validityDays: 30 }],
      },
      users.admin!,
    );
    const id = await resaleInNoc({ type: "resale_offplan", price: 200_000_000 });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    expect((await recordNoc(ctx(), id, await nocInput(id, { paidFils: 20_000_000 }), officer())).status).toBe(
      "matched",
    );
  });

  test("seller mortgage: NOC moves to FINANCE; an unconfirmed amount never passes; a person's confirmation does", async () => {
    const id = await resaleInNoc({ seller: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id), officer());
    expect(await state(id)).toBe("FINANCE");
    const l = await recordBankLetter(
      ctx(),
      id,
      {
        side: "seller",
        kind: "liability_letter",
        documentId: (await doc(id, "liability_letter")).id,
        issuedOn: "2026-11-10",
        validUntil: "2027-02-01",
        amountReadFils: 90_000_000,
      },
      officer(),
    );
    expect(await state(id)).toBe("FINANCE");
    const [row] = await database.db.select().from(bankLetters).where(eq(bankLetters.id, l.id));
    expect([row?.amountFils, row?.amountReadFils]).toEqual([null, 90_000_000]);
    const c = await confirmBankAmount(ctx(), l.id, 89_500_000, officer(), "2027-02-01");
    expect(await state(id)).toBe("SETTLEMENT");
    const rows = await database.db.select().from(bankLetters).where(eq(bankLetters.dealId, id));
    expect(rows.map((r) => r.status).toSorted()).toEqual(["current", "superseded"]);
    const [cur] = rows.filter((r) => r.status === "current");
    expect([cur?.id, cur?.amountFils, cur?.amountReadFils, cur?.confirmedBy]).toEqual([
      c.id,
      89_500_000,
      90_000_000,
      officer().id,
    ]);
    const [ev] = await events(id, "BANK_AMOUNT_CONFIRMED");
    expect(ev?.payload).toMatchObject({ amountFils: 89_500_000, amountReadFils: 90_000_000, differs: true });
    expect(ev?.actor).toBe(`user:${officer().id}`);
  });

  test("a liability letter that expires before the target date doesn't count", async () => {
    const id = await resaleInNoc({ seller: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id), officer());
    const l = await recordBankLetter(
      ctx(),
      id,
      {
        side: "seller",
        kind: "liability_letter",
        documentId: (await doc(id, "liability_letter")).id,
        issuedOn: "2026-11-10",
        validUntil: "2027-01-10",
      },
      officer(),
    );
    await confirmBankAmount(ctx(), l.id, 1_000, officer(), "2027-01-10");
    expect(await state(id)).toBe("FINANCE");
    const l2 = await recordBankLetter(
      ctx(),
      id,
      {
        side: "seller",
        kind: "liability_letter",
        documentId: (await doc(id, "liability_letter")).id,
        issuedOn: "2026-11-11",
        validUntil: "2027-01-15",
      },
      officer(),
    );
    await confirmBankAmount(ctx(), l2.id, 1_000, officer(), "2027-01-15");
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("buyer mortgage needs a pre-approval and a final offer, each confirmed; a valuation doesn't gate", async () => {
    const id = await resaleInNoc({ buyer: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id), officer());
    const send = async (kind: "pre_approval" | "final_offer" | "valuation") =>
      recordBankLetter(
        ctx(),
        id,
        { side: "buyer", kind, documentId: (await doc(id, kind)).id, issuedOn: "2026-11-10" },
        officer(),
      );
    const pre = await send("pre_approval");
    const val = await send("valuation");
    await confirmBankAmount(ctx(), pre.id, 150_000_000, officer(), "2027-02-01");
    await confirmBankAmount(ctx(), val.id, 210_000_000, officer());
    expect(await state(id)).toBe("FINANCE");
    const fin = await send("final_offer");
    expect(await state(id)).toBe("FINANCE");
    await confirmBankAmount(ctx(), fin.id, 150_000_000, officer(), "2027-02-01");
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("bank letters: the side must have a mortgage, the document the right kind, and only the listed roles confirm", async () => {
    const id = await resaleInNoc({ seller: true });
    expect(
      await fails(
        recordBankLetter(
          ctx(),
          id,
          {
            side: "buyer",
            kind: "pre_approval",
            documentId: (await doc(id, "pre_approval")).id,
            issuedOn: "2026-11-10",
          },
          officer(),
        ),
      ),
    ).toEqual({ status: 422, code: "no_mortgage" });
    expect(
      await fails(
        recordBankLetter(
          ctx(),
          id,
          { side: "seller", kind: "liability_letter", documentId: (await doc(id, "noc")).id, issuedOn: "2026-11-10" },
          officer(),
        ),
      ),
    ).toEqual({ status: 422, code: "invalid_document" });
    expect(
      await fails(
        recordBankLetter(
          ctx(),
          id,
          {
            side: "buyer",
            kind: "liability_letter" as never,
            documentId: (await doc(id, "liability_letter")).id,
            issuedOn: "2026-11-10",
          },
          officer(),
        ),
      ),
    ).toMatchObject({ status: 422 });
    const l = await recordBankLetter(
      ctx(),
      id,
      {
        side: "seller",
        kind: "liability_letter",
        documentId: (await doc(id, "liability_letter")).id,
        issuedOn: "2026-11-10",
      },
      officer(),
    );
    expect(await fails(confirmBankAmount(ctx(), l.id, 100, users.finance!))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(confirmBankAmount(ctx(), l.id, 0, officer()))).toMatchObject({ status: 422 });
    expect(await fails(confirmBankAmount(ctx(), l.id, 1.5, officer()))).toMatchObject({ status: 422 });
  });

  test("confirming takes the dates: the person's validUntil is what counts, the read one is only recorded (review 5)", async () => {
    const id = await resaleInNoc({ seller: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id), officer());
    const l = await recordBankLetter(
      ctx(),
      id,
      {
        side: "seller",
        kind: "liability_letter",
        documentId: (await doc(id, "liability_letter")).id,
        issuedOn: "2026-11-10",
        validUntil: "2027-03-01",
      },
      officer(),
    );
    expect(await fails(confirmBankAmount(ctx(), l.id, 1_000, officer()))).toEqual({
      status: 422,
      code: "valid_until_required",
    });
    expect(await fails(confirmBankAmount(ctx(), l.id, 1_000, officer(), "next week"))).toMatchObject({ status: 422 });
    const c = await confirmBankAmount(ctx(), l.id, 1_000, officer(), "2027-01-10");
    expect(await state(id)).toBe("FINANCE"); // the person says it ends before the target date
    const [cur] = await database.db.select().from(bankLetters).where(eq(bankLetters.id, c.id));
    expect(cur?.validUntil).toBe("2027-01-10");
    const [ev] = await events(id, "BANK_AMOUNT_CONFIRMED");
    expect(ev?.payload).toMatchObject({
      validUntil: "2027-01-10",
      validUntilRead: "2027-03-01",
      validUntilDiffers: true,
    });
    await confirmBankAmount(ctx(), c.id, 1_000, officer(), "2027-02-01");
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("buyer letters count only with a person-confirmed validity on or after the target date and today (review 8)", async () => {
    const id = await resaleInNoc({ buyer: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id), officer());
    const send = async (kind: "pre_approval" | "final_offer") =>
      recordBankLetter(
        ctx(),
        id,
        { side: "buyer", kind, documentId: (await doc(id, kind)).id, issuedOn: "2026-11-10", validUntil: "2027-06-01" },
        officer(),
      );
    const pre = await send("pre_approval");
    const fin = await send("final_offer");
    const preC = await confirmBankAmount(ctx(), pre.id, 150_000_000, officer(), "2027-01-14");
    await confirmBankAmount(ctx(), fin.id, 150_000_000, officer(), "2027-06-01");
    expect(await state(id)).toBe("FINANCE"); // the pre-approval ends the day before the target date
    await confirmBankAmount(ctx(), preC.id, 150_000_000, officer(), "2027-01-15");
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("expiry job: a warning 7 days before expiry, once per NOC; running it twice writes one event", async () => {
    const id = await resaleInNoc({ seller: true });
    await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
    await recordNoc(ctx(), id, await nocInput(id, { expiresOn: "2027-01-20" }), officer());
    clock.set(new Date("2027-01-12T06:00:00Z"));
    expect((await nocExpirySweep(ctx())).warned).toEqual([]);
    clock.set(new Date("2027-01-13T06:00:00Z"));
    expect((await nocExpirySweep(ctx())).warned).toEqual([id]);
    expect((await nocExpirySweep(ctx())).warned).toEqual([]);
    const ev = await events(id, "NOC_EXPIRY_WARNING");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ expiresOn: "2027-01-20", daysLeft: 7, key: `${id}:noc_expiry:2027-01-20` });
    expect(ev[0]!.actor).toBe("system:noc-expiry");
  });
});

describe.skipIf(!url)("NOC and bank letter routes (C15)", () => {
  const SECRET = "s".repeat(40);
  const NOW = Date.now();
  const FAR = "2099-06-30";
  let withStore = true;
  const app = () =>
    createApp({
      database,
      jobs: { boss: { send: async () => "job-1" } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      ...(withStore ? { documents: store } : {}),
    });
  const as = (u: { id: string } | null): Record<string, string> =>
    u ? { authorization: `Bearer ${issueToken(SECRET, u.id, NOW)}` } : {};
  const json = (u: { id: string } | null, body: unknown, method = "POST") => ({
    method,
    headers: { "content-type": "application/json", ...as(u) },
    body: JSON.stringify(body),
  });
  const upload = (u: { id: string } | null, bytes: Uint8Array, kind = "noc", name = "noc.pdf") => {
    const form = new FormData();
    form.set("file", new File([bytes], name));
    form.set("kind", kind);
    return { method: "POST", headers: as(u), body: form };
  };
  beforeEach(async () => {
    withStore = true;
    clock.set(new Date("2026-11-19T06:00:00Z"));
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const [k, role] of Object.entries({
      officer: "sales_officer",
      manager: "sales_manager",
      salesadmin: "sales_admin",
      finance: "finance",
      legal: "legal",
    } as const)) {
      users[k] = { id: newId(), role };
      await database.db.insert(spaUsers).values({ ...users[k]!, email: `${k}@spa-demo.test`, name: k });
    }
  });

  afterAll(async () => {
    await database?.close();
  });

  test("every route needs a signed-in user", async () => {
    const id = await resaleInNoc();
    const a = app();
    expect((await a.request(`/api/deals/${id}/noc`, json(null, {}))).status).toBe(401);
    expect((await a.request(`/api/deals/${id}/documents`, upload(null, PDF))).status).toBe(401);
    expect((await a.request(`/api/deals/${id}/target-transfer-date`, json(null, { date: FAR }, "PUT"))).status).toBe(
      401,
    );
    expect((await a.request(`/api/bank-letters/${id}/confirm-amount`, json(null, { amountFils: 1 }))).status).toBe(401);
    expect((await a.request(`/api/noc-records/${id}/confirm`, json(null, {}))).status).toBe(401);
  });

  test("upload: officer yes, finance and legal no, a text file and a missing store refused", async () => {
    const id = await resaleInNoc();
    const a = app();
    expect((await a.request(`/api/deals/${id}/documents`, upload(users.officer!, PDF))).status).toBe(201);
    expect((await a.request(`/api/deals/${id}/documents`, upload(users.finance!, PDF))).status).toBe(403);
    expect((await a.request(`/api/deals/${id}/documents`, upload(users.legal!, PDF))).status).toBe(403);
    const bad = await a.request(
      `/api/deals/${id}/documents`,
      upload(users.officer!, new TextEncoder().encode("hello")),
    );
    expect([bad.status, ((await bad.json()) as { code: string }).code]).toEqual([422, "invalid_file"]);
    expect((await a.request(`/api/deals/not-a-uuid/documents`, upload(users.officer!, PDF))).status).toBe(400);
    withStore = false;
    expect((await app().request(`/api/deals/${id}/documents`, upload(users.officer!, PDF))).status).toBe(503);
  });

  test("target date: manager and sales admin yes, officer, finance and legal no", async () => {
    const id = await resaleInNoc();
    const a = app();
    const put = (u: { id: string }) =>
      a.request(`/api/deals/${id}/target-transfer-date`, json(u, { date: FAR }, "PUT"));
    expect((await put(users.officer!)).status).toBe(403);
    expect((await put(users.finance!)).status).toBe(403);
    expect((await put(users.legal!)).status).toBe(403);
    expect((await put(users.manager!)).status).toBe(200);
    expect((await put(users.salesadmin!)).status).toBe(200);
    expect(
      (await a.request(`/api/deals/${id}/target-transfer-date`, json(users.manager!, { date: "2001-01-01" }, "PUT")))
        .status,
    ).toBe(422);
  });

  test("NOC: officer enters it and a matching one moves the deal; finance and legal can't; a bad body is 422", async () => {
    const id = await resaleInNoc();
    const a = app();
    await a.request(`/api/deals/${id}/target-transfer-date`, json(users.manager!, { date: FAR }, "PUT"));
    const documentId = (
      (await (await a.request(`/api/deals/${id}/documents`, upload(users.officer!, PDF))).json()) as { id: string }
    ).id;
    const body = {
      documentId,
      unitNo: "A-101",
      sellerNames: ["Seller One", "Seller Two"],
      issuedOn: "2026-11-01",
      expiresOn: "2099-12-31",
      serviceChargesCleared: true,
    };
    expect((await a.request(`/api/deals/${id}/noc`, json(users.finance!, body))).status).toBe(403);
    expect((await a.request(`/api/deals/${id}/noc`, json(users.legal!, body))).status).toBe(403);
    expect((await a.request(`/api/deals/${id}/noc`, json(users.officer!, { ...body, sellerNames: [] }))).status).toBe(
      422,
    );
    const ok = await a.request(`/api/deals/${id}/noc`, json(users.officer!, body));
    expect([ok.status, ((await ok.json()) as { status: string }).status]).toEqual([201, "matched"]);
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("bank letters: officer records and confirms; finance can't confirm an amount", async () => {
    const id = await resaleInNoc({ buyer: true });
    const a = app();
    const documentId = (
      (await (
        await a.request(`/api/deals/${id}/documents`, upload(users.officer!, PDF, "pre_approval", "pa.pdf"))
      ).json()) as { id: string }
    ).id;
    const letter = { side: "buyer", kind: "pre_approval", documentId, issuedOn: "2026-11-10" };
    expect((await a.request(`/api/deals/${id}/bank-letters`, json(users.finance!, letter))).status).toBe(403);
    const made = await a.request(`/api/deals/${id}/bank-letters`, json(users.officer!, letter));
    expect(made.status).toBe(201);
    const letterId = ((await made.json()) as { id: string }).id;
    expect(
      (await a.request(`/api/bank-letters/${letterId}/confirm-amount`, json(users.finance!, { amountFils: 100 })))
        .status,
    ).toBe(403);
    expect(
      (await a.request(`/api/bank-letters/${letterId}/confirm-amount`, json(users.officer!, { amountFils: -5 })))
        .status,
    ).toBe(422);
    expect(
      (
        await a.request(
          `/api/bank-letters/${letterId}/confirm-amount`,
          json(users.officer!, { amountFils: 100, validUntil: FAR }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await database.db.select().from(bankLetters).where(eq(bankLetters.dealId, id))).filter(
        (l) => l.amountFils === 100,
      ),
    ).toHaveLength(1);
  });
});
