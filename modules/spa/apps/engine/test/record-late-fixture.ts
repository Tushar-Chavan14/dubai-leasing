import { newId } from "@platform/kernel";
import {
  agreements,
  bankLetters,
  deals,
  documentReads,
  documents,
  helperRuns,
  nocRecords,
  parties,
  paymentPlanRows,
  payments,
  registrations,
  riskAssessments,
  settlementLines,
  settlements,
  signatures,
  signingEnvelopes,
  spaTemplates,
  spaTemplateVersions,
  type SpaDatabase,
  withSpaTx,
} from "@spa/db";
import { eq } from "drizzle-orm";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import { dealInDraft, markScreened } from "./prepare-fixtures.ts";
import { buildWorld, EID, NOW, PASSPORT, PHONE, type World } from "./reads-fixture.ts";

export const IBAN = "AE070331234567890123456";
/** Personal numbers planted where a section reads free text: a view must mask them again on the way out. */
export const LEAK = `Passport ${PASSPORT}, Emirates ID ${EID}, phone ${PHONE}, account ${IBAN}`;
/** File facts and link facts that no section may carry. */
export const FILE_NAME = "private-scan-file-name.pdf";
export const STORAGE_KEY = "ab/storage-key-private-0123456789.pdf";
export const SHA = "c0ffee".repeat(10) + "abcd";
export const LINK_HASH = "link-token-hash-private-value";
export const SIGNER_EMAIL = "private.signer@example.test";
export const FILE_FACTS = [FILE_NAME, STORAGE_KEY, SHA, LINK_HASH, SIGNER_EMAIL, "application/pdf"];

export interface LateWorld extends World {
  /** A resale (off-plan, plan taken over, buyer mortgage) in TRANSFER with a row in every table a section reads. */
  late: { dealId: string; buyer: string; seller: string };
  /** A resale in NOC: later steps not reached. */
  early: { dealId: string };
  /** A resale without a mortgage in TRANSFER. */
  noBank: { dealId: string };
  /** A primary deal in REGISTRATION with an Oqood attempt. */
  reg: { dealId: string };
}

const setState = (database: SpaDatabase, dealId: string, state: string) =>
  database.db
    .update(deals)
    .set({ state: state as never })
    .where(eq(deals.id, dealId));

export async function buildLateWorld(database: SpaDatabase): Promise<LateWorld> {
  const w = await buildWorld(database);
  const { ctx, users } = w;
  // The held deal's buyer has a risk level (compliance reads it, nobody else).
  await database.db.insert(riskAssessments).values({
    id: newId(),
    dealId: w.held.dealId,
    partyId: w.held.buyer,
    policyVersion: 1,
    rulesVersion: "dubai-sales-2026-01",
    points: 70,
    level: "high",
    flagged: true,
    detail: { why: "planted" },
    createdBy: "system:aml",
    createdAt: NOW,
  });

  const made = await dealInDraft(ctx, database, {
    type: "resale_offplan",
    buyers: ["Buyer Late"],
    sellers: ["Seller Late"],
    buyerMortgage: true,
    unitNo: "U-500",
  });
  const dealId = made.dealId;
  await setState(database, dealId, "TRANSFER");
  await database.db
    .update(parties)
    .set({ fullNameEn: `Buyer Late ${LEAK}` })
    .where(eq(parties.id, made.buyerIds[0]!));

  const doc = async (kind: string, partyId: string | null = null) => {
    const id = newId();
    await database.db.insert(documents).values({
      id,
      dealId,
      partyId,
      kind: kind as never,
      fileName: FILE_NAME,
      mime: "application/pdf",
      sizeBytes: 10,
      sha256: SHA,
      storageKey: STORAGE_KEY,
      uploadedBy: `user:${users.officer!.id}`,
      uploadedAt: NOW,
    });
    return id;
  };
  const passportDoc = await doc("passport", made.buyerIds[0]!);
  const nocDoc = await doc("noc");
  const letterDoc = await doc("pre_approval");
  const receiptDoc = await doc("payment_receipt", made.buyerIds[0]!);

  const run = newId();
  await database.db.insert(helperRuns).values({
    id: run,
    helper: "document_reader",
    dealId,
    entityKind: "deal",
    entityId: dealId,
    status: "ok",
    result: {},
    reasons: [],
    rulesVersion: "dubai-sales-2026-01",
    createdAt: NOW,
  });
  const read = async (documentId: string, profile: "title_deed" | "noc" | "payment_receipt") => {
    const id = newId();
    await database.db.insert(documentReads).values({
      id,
      documentId,
      profile,
      fields: { raw: LEAK },
      promptVersion: `v-${id.slice(-6)}`,
      runId: run,
      readAt: NOW,
    });
    return id;
  };
  await read(passportDoc, "title_deed");
  await read(nocDoc, "noc");
  const receiptRead = await read(receiptDoc, "payment_receipt");

  await database.db.insert(nocRecords).values({
    id: newId(),
    dealId,
    documentId: nocDoc,
    source: "manual",
    unitNo: "U-500",
    sellerNames: ["Seller Late"],
    issuedOn: "2026-11-01",
    expiresOn: "2027-02-01",
    serviceChargesCleared: true,
    paidFils: 5_000_000,
    paidConfirmedBy: users.officer!.id,
    status: "review",
    mismatches: [`Seller name differs: ${LEAK}`],
    enteredBy: `user:${users.officer!.id}`,
    enteredAt: NOW,
  });
  await database.db.insert(bankLetters).values({
    id: newId(),
    dealId,
    side: "buyer",
    kind: "pre_approval",
    documentId: letterDoc,
    issuedOn: "2026-11-02",
    validUntil: "2027-01-02",
    amountFils: 120_000_000,
    amountReadFils: 120_000_000,
    confirmedBy: users.finance!.id,
    confirmedAt: NOW,
    enteredBy: `user:${users.officer!.id}`,
    enteredAt: NOW,
  });
  await database.db.insert(paymentPlanRows).values({
    dealId,
    seq: 1,
    label: "Instalment 1",
    dueOn: "2026-12-01",
    amountFils: 20_000_000,
    enteredBy: "system",
  });
  await database.db.insert(payments).values({
    id: newId(),
    dealId,
    seq: 1,
    documentId: receiptDoc,
    readId: receiptRead,
    status: "needs_review",
    method: "transfer",
    amountReadFils: 20_000_000,
    payerNameRead: `Payer ${LEAK}`,
    accountReadMasked: "AE07***3456",
    intoEscrow: true,
    payerIsBuyer: false,
    reasonCode: "payer_review",
    registeredBy: `user:${users.officer!.id}`,
    createdAt: NOW,
  });

  // Agreement, its envelope and signers.
  const tpl = newId();
  await database.db.insert(spaTemplates).values({
    id: tpl,
    name: `Assignment form ${LEAK}`,
    documentKind: "assignment",
    createdBy: "system",
    createdAt: NOW,
  });
  const tv = newId();
  await database.db.insert(spaTemplateVersions).values({
    id: tv,
    templateId: tpl,
    version: 3,
    docId: "doc",
    docHash: "h",
    sections: {},
    blanks: [],
    look: {},
    partyBlocks: [],
    signatureRoles: {},
    checks: [],
    rulesVersion: "dubai-sales-2026-01",
    status: "approved",
    createdBy: "system",
    createdAt: NOW,
  });
  const agreementId = newId();
  await database.db.insert(agreements).values({
    id: agreementId,
    dealId,
    kind: "assignment",
    version: 2,
    templateVersionId: tv,
    status: "approved",
    docHash: SHA,
    storageKey: STORAGE_KEY,
    valuesHash: "vh",
    fieldSources: {},
    rulesVersion: "dubai-sales-2026-01",
    policyVersion: 1,
    preparedBy: "system:prepare",
    preparedAt: new Date("2026-11-18T21:30:00Z"),
  });
  const envelope = newId();
  await database.db.insert(signingEnvelopes).values({
    id: envelope,
    dealId,
    agreementId,
    docHash: SHA,
    status: "open",
    createdAt: NOW,
  });
  await database.db.insert(signatures).values([
    {
      id: newId(),
      envelopeId: envelope,
      seq: 1,
      role: "seller",
      partyId: made.sellerIds[0]!,
      nameOnAgreement: `Seller Late ${LEAK}`,
      email: SIGNER_EMAIL,
      linkTokenHash: LINK_HASH,
      linkExpiresAt: new Date("2026-11-25T06:00:00Z"),
      linkUsedAt: NOW,
      signedAt: NOW,
      typedName: "Seller Late",
      consent: true,
      ip: "203.0.113.9",
      userAgent: "test-agent",
      anchor: {},
    },
    {
      id: newId(),
      envelopeId: envelope,
      seq: 2,
      role: "purchaser",
      partyId: made.buyerIds[0]!,
      nameOnAgreement: "Buyer Late",
      email: SIGNER_EMAIL,
      linkTokenHash: `${LINK_HASH}-2`,
      linkExpiresAt: new Date("2026-11-18T06:00:00Z"),
      anchor: {},
    },
  ]);

  // Settlement: three price lines that add up, one fee.
  const st = newId();
  await withSpaTx(database, async (tx) => {
    await tx.db.insert(settlements).values({
      id: st,
      dealId,
      version: 1,
      status: "proposed",
      rulesVersion: "dubai-sales-2026-01",
      policyVersion: 1,
      input: {},
      inputHash: "ih",
      priceFils: 200_000_000,
      buyerPaysFils: 208_000_000,
      sellerReceivesFils: 150_000_000,
      createdBy: "system:settlement",
      createdAt: NOW,
    });
    await tx.db.insert(settlementLines).values([
      {
        settlementId: st,
        seq: 1,
        code: "price:payoff",
        payer: "buyer",
        payee: "seller_bank",
        label: `Seller bank payoff ${LEAK}`,
        amountFils: 50_000_000,
        source: "letter",
        sourceRef: `letter-${SHA}`,
      },
      {
        settlementId: st,
        seq: 2,
        code: "price:balance_to_seller",
        payer: "buyer",
        payee: "seller",
        label: "Balance to the seller",
        amountFils: 150_000_000,
        source: "deal: price",
      },
      {
        settlementId: st,
        seq: 3,
        code: "fee:dld",
        payer: "buyer",
        payee: "dld",
        label: "DLD fee",
        amountFils: 8_000_000,
        source: "rulebook",
      },
    ]);
  });

  // A registry attempt on the late deal (trustee) and one on a primary deal (Oqood).
  const attempt = async (id: string, kind: "trustee_transfer" | "oqood_register", gate: never) => {
    const a = await proposeApproval(ctx, {
      gate,
      entity: { kind: "deal", id },
      dedupeKey: `${id}:${kind}`,
      title: "registry",
      proposal: {},
      proposedBy: "system:registry",
    });
    await markScreened(database, id);
    await decideApproval(ctx, a.id, users.salesadmin!, { decision: "approve" });
    await database.db.insert(registrations).values({
      id: newId(),
      dealId: id,
      kind,
      attempt: 1,
      requestId: `${id}:${kind}:1`,
      status: "rejected",
      reasons: [{ code: "INVALID_ID", field: "buyer", message: LEAK }],
      approvalId: a.id,
      payloadHash: "h",
      createdAt: NOW,
    });
  };
  await attempt(dealId, "trustee_transfer", "transfer_submission" as never);

  const reg = await dealInDraft(ctx, database, { type: "primary_offplan", buyers: ["Buyer Reg"] });
  await setState(database, reg.dealId, "REGISTRATION");
  await attempt(reg.dealId, "oqood_register", "oqood_submission" as never);

  const early = await dealInDraft(ctx, database, {
    type: "resale_ready",
    buyers: ["Buyer Early"],
    buyerMortgage: true,
  });
  await setState(database, early.dealId, "NOC");
  const noBank = await dealInDraft(ctx, database, { type: "resale_ready", buyers: ["Buyer NoBank"] });
  await setState(database, noBank.dealId, "TRANSFER");

  return {
    ...w,
    late: { dealId, buyer: made.buyerIds[0]!, seller: made.sellerIds[0]! },
    early: { dealId: early.dealId },
    noBank: { dealId: noBank.dealId },
    reg: { dealId: reg.dealId },
  };
}
export { EID, PASSPORT, PHONE };
