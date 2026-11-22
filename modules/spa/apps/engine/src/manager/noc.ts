import { sniffImage } from "@platform/adapters";
import { type CalendarDate, diffDays, isCalendarDate } from "@platform/kernel/dates";
import { newId } from "@platform/kernel/ids";
import type { SpaActor, SpaRole } from "@spa/core";
import {
  BANK_LETTER_KINDS,
  bankLetters,
  dealEvents,
  deals,
  DOCUMENT_KINDS,
  documents,
  nocRecords,
  PARTY_DOCUMENT_KINDS,
  spaApprovals,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { advance } from "./advance.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { dealKycParties } from "./kyc-facts.ts";
import { checkNoc, currentNoc, nocOkFact } from "./noc-facts.ts";
import { mailDealParties } from "./portal.ts";
import { transferBookedMail } from "@spa/helpers";
import { advanceSettled, refreshSettlement, STATEMENT_FIXED_STATES } from "./settlement.ts";

/** Where uploaded files go (C15): a content-addressed store such as `LocalDiskStore`. */
export interface DocumentStore {
  put(bytes: Uint8Array, ext: string): Promise<{ sha256: string; path: string; bytes: number }>;
  /** Reads a stored file back (signing serves and stamps the approved PDF, S54). */
  read?(key: string): Promise<Uint8Array>;
}
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

type Person = { id: string; role: SpaRole };
/** Who enters NOC and bank-letter records and confirms amounts. */
const ENTER_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
/** Who sets the target transfer date (ruling on S47). */
const DATE_ROLES: readonly SpaRole[] = ["sales_manager", "sales_admin", "admin"];
const CHECKER: SpaActor = "system:noc-check";
const WARN_DAYS = 7;

const need = (u: Person, roles: readonly SpaRole[], what: string) => {
  if (!roles.includes(u.role)) throw forbidden(`only ${roles.join(", ")} can ${what}`);
};
const actorOf = (u: Person): SpaActor => `user:${u.id}`;
const calDate = z.string().refine(isCalendarDate, "a date as YYYY-MM-DD");
const invalid = (code: string, e: z.ZodError) =>
  unprocessable(
    code,
    "the input isn't valid",
    e.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  );
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);
/** States in which a NOC is entered and its review opened (S48 widened S47's NOC and FINANCE). */
export const NOC_STATES = new Set(["NOC", "FINANCE", "SETTLEMENT", "TRANSFER"]);

/** A deal, locked. */
async function lockDeal(tx: SpaTx, dealId: string) {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d) throw notFound("deal");
  return d;
}

/** A resale deal, locked. NOC and bank letters exist only on a resale. */
export async function lockResale(tx: SpaTx, dealId: string) {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d) throw notFound("deal");
  if (d.dealType === "primary_offplan") throw unprocessable("not_resale", "only a resale has a NOC or bank letters");
  return d;
}

export function sniffFile(b: Uint8Array): { mime: string; ext: string } | null {
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  if (b.length >= 5 && pdf.every((v, i) => b[i] === v)) return { mime: "application/pdf", ext: "pdf" };
  return sniffImage(b);
}

const UploadInput = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  fileName: z.string().trim().min(1).max(200),
  bytes: z.instanceof(Uint8Array),
  partyId: z.uuid().optional(),
});

/** A company's documents (C20): uploaded for the company party, on any deal type. */
export const COMPANY_DOCUMENT_KINDS = ["trade_licence", "memorandum", "poa", "board_resolution"] as const;
export const PARTY_KINDS: readonly string[] = [...PARTY_DOCUMENT_KINDS, ...COMPANY_DOCUMENT_KINDS];
/** NOC and bank-letter kinds, which only a resale has. */
const RESALE_KINDS: readonly string[] = [
  "noc",
  "liability_letter",
  "release_letter",
  "pre_approval",
  "valuation",
  "final_offer",
  // C20: the ownership document of the resale.
  "title_deed",
  "oqood",
];

/**
 * Stores an uploaded file for a deal (S47, S49): PDF or image by its first bytes (never the declared type), at most
 * 10 MB, hashed. The event carries the hash and kind, not the file name. A later upload of the same kind supersedes.
 */
export async function uploadDocument(
  ctx: SpaContext,
  store: DocumentStore,
  dealId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string; sha256: string }> {
  // A transfer receipt (S55) is uploaded by finance too, for any deal type, and there are many: none supersedes another.
  const receipt = (input as { kind?: unknown } | null)?.kind === "payment_receipt";
  need(user, receipt ? [...ENTER_ROLES, "finance"] : ENTER_ROLES, "upload documents");
  return storeDealDocument(ctx, store, dealId, input, actorOf(user));
}

/**
 * The upload itself, for any actor (C35, S67): a user checked by `uploadDocument`, or a party acting through a portal
 * link, whose caller has already settled which party and which kinds. `event` names the event type and adds to its payload.
 */
export async function storeDealDocument(
  ctx: SpaContext,
  store: DocumentStore,
  dealId: string,
  input: unknown,
  actor: SpaActor,
  event: { type: string; payload?: Record<string, unknown> } = { type: "DOCUMENT_UPLOADED" },
): Promise<{ id: string; sha256: string }> {
  const receipt = (input as { kind?: unknown } | null)?.kind === "payment_receipt";
  const parsed = UploadInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_file", parsed.error);
  const f = parsed.data;
  const forParty = PARTY_KINDS.includes(f.kind);
  if (!forParty && !receipt && !RESALE_KINDS.includes(f.kind))
    throw unprocessable("unsupported_kind", "this kind of document isn't uploaded here yet");
  if (forParty && !f.partyId) throw unprocessable("party_required", "say whose document it is");
  const type = f.bytes.byteLength > MAX_DOCUMENT_BYTES ? null : sniffFile(f.bytes);
  if (!type) throw unprocessable("invalid_file", "a PDF or an image (JPEG, PNG, WebP) up to 10 MB");
  const stored = await store.put(f.bytes, type.ext);
  return withSpaTx(ctx.database, async (tx) => {
    // A person's identity documents belong to any deal type; a NOC or bank letter only to a resale.
    const d = forParty || receipt ? await lockDeal(tx, dealId) : await lockResale(tx, dealId);
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} takes no more documents`);
    if (forParty && !(await dealKycParties(tx.db, dealId)).some((p) => p.partyId === f.partyId))
      throw unprocessable("party_not_on_deal", "that party isn't on this deal");
    const [previous] = receipt
      ? []
      : await tx.db
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(
              eq(documents.dealId, dealId),
              eq(documents.kind, f.kind),
              forParty ? eq(documents.partyId, f.partyId!) : undefined,
            ),
          )
          .orderBy(desc(documents.uploadedAt), desc(documents.id))
          .limit(1);
    const id = newId();
    await tx.db.insert(documents).values({
      id,
      dealId,
      partyId: f.partyId ?? null,
      kind: f.kind,
      fileName: f.fileName.replace(/^.*[\\/]/, ""),
      mime: type.mime,
      sizeBytes: stored.bytes,
      sha256: stored.sha256,
      storageKey: stored.path,
      supersedesId: previous?.id ?? null,
      uploadedBy: actor,
      uploadedAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: event.type,
      actor,
      rulesVersion: d.rulesVersion,
      payload: {
        documentId: id,
        kind: f.kind,
        sha256: stored.sha256,
        sizeBytes: stored.bytes,
        ...(forParty ? { partyId: f.partyId } : {}),
        ...event.payload,
      },
    });
    return { id, sha256: stored.sha256 };
  });
}

/** Sets the day the transfer is planned for. A NOC must be valid on it (S47). Re-checks the NOC. */
export async function setTargetTransferDate(
  ctx: SpaContext,
  dealId: string,
  date: unknown,
  user: Person,
): Promise<void> {
  need(user, DATE_ROLES, "set the target transfer date");
  const parsed = calDate.safeParse(date);
  if (!parsed.success || parsed.data < ctx.clock.today())
    throw unprocessable("invalid_date", "the target transfer date must be today or later");
  await withSpaTx(ctx.database, async (tx) => {
    const d = await lockResale(tx, dealId);
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} can't change its target date`);
    await tx.db.update(deals).set({ targetTransferOn: parsed.data }).where(eq(deals.id, dealId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "TARGET_TRANSFER_DATE_SET",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: { from: d.targetTransferOn, to: parsed.data },
    });
    await evaluateNoc(ctx, dealId, tx);
  });
  // The people on the deal hear the day, with their status link (C35, S67). A new date is a new mail.
  await mailDealParties(ctx, dealId, `transfer_booked:${parsed.data}`, (i) =>
    transferBookedMail({ ...i, transferOn: parsed.data }),
  ).catch(() => undefined);
}

const UnitInput = z.object({
  unitNo: z.string().trim().min(1).max(40),
  projectCode: z.string().trim().min(1).max(40).nullable().optional(),
});

/** Records the unit and project a resale's NOC is matched against, and the project's NOC rule (S47). */
export async function setDealUnit(ctx: SpaContext, dealId: string, input: unknown, user: Person): Promise<void> {
  need(user, ENTER_ROLES, "set the unit");
  const parsed = UnitInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_unit", parsed.error);
  await withSpaTx(ctx.database, async (tx) => {
    const d = await lockResale(tx, dealId);
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} can't change its unit`);
    const projectCode = parsed.data.projectCode ?? null;
    await tx.db.update(deals).set({ unitNo: parsed.data.unitNo, projectCode }).where(eq(deals.id, dealId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "DEAL_UNIT_SET",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: { unitNo: parsed.data.unitNo, projectCode },
    });
    await evaluateNoc(ctx, dealId, tx);
  });
}

const NocInput = z
  .object({
    documentId: z.uuid(),
    unitNo: z.string().trim().min(1).max(40),
    sellerNames: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
    issuedOn: calDate,
    expiresOn: calDate,
    serviceChargesCleared: z.boolean(),
    /** Typed by the person entering the record, who thereby confirms it. */
    paidFils: z.number().int().min(0).optional(),
    /** What a reader saw (C20): kept, never used for a decision. */
    paidReadFils: z.number().int().min(0).optional(),
  })
  .refine((n) => n.expiresOn >= n.issuedOn, { message: "expires before it was issued", path: ["expiresOn"] });

/**
 * A person enters the developer NOC (S47). It replaces the previous one. The checks run by code: all clear and the deal
 * moves on; a blocker opens `noc_review` (sales admin).
 */
export async function recordNoc(
  ctx: SpaContext,
  dealId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string; status: "matched" | "review"; codes: string[] }> {
  need(user, ENTER_ROLES, "enter a NOC");
  const parsed = NocInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_noc", parsed.error);
  const n = parsed.data;
  return withSpaTx(ctx.database, async (tx) => {
    const d = await lockResale(tx, dealId);
    // S48: a replacement is also entered in SETTLEMENT or TRANSFER, where an expired NOC would otherwise block for good.
    if (!NOC_STATES.has(d.state))
      throw conflict("not_in_noc", `a NOC is entered while the deal is in NOC, SETTLEMENT or TRANSFER, not ${d.state}`);
    const today = ctx.clock.today();
    if (n.expiresOn < today) throw unprocessable("noc_expired", "this NOC has already expired: ask for a new one");
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, n.documentId));
    if (!doc || doc.dealId !== dealId || doc.kind !== "noc")
      throw unprocessable("invalid_document", "upload the NOC to this deal first");
    return storeNoc(ctx, tx, d, n, {
      source: "manual",
      actor: actorOf(user),
      paidConfirmedBy: n.paidFils === undefined ? null : user.id,
    });
  });
}

export interface StoredNoc {
  documentId: string;
  unitNo: string;
  sellerNames: string[];
  issuedOn: string;
  expiresOn: string;
  serviceChargesCleared: boolean;
  paidFils?: number | undefined;
  paidReadFils?: number | undefined;
}

/**
 * Stores a NOC as the deal's current one, superseding the old (S47, S52), runs the checks by code and moves the deal
 * on. A person's entry (`manual`) may carry a confirmed `paidFils`; a reader's (`reader`) never does: it carries only
 * `paidReadFils`, so a read amount stays unconfirmed until a person confirms it. The caller holds the deal lock.
 */
export async function storeNoc(
  ctx: SpaContext,
  tx: SpaTx,
  d: typeof deals.$inferSelect,
  n: StoredNoc,
  by: {
    source: "manual" | "reader";
    actor: SpaActor;
    paidConfirmedBy: string | null;
    /** Reasons a person must look that the field checks can't see (a reader's `instruction_found`, S52 amendment). */
    reviewCodes?: string[];
  },
): Promise<{ id: string; status: "matched" | "review"; codes: string[] }> {
  const dealId = d.id;
  const today = ctx.clock.today();
  const row = {
    unitNo: n.unitNo,
    sellerNames: n.sellerNames,
    expiresOn: n.expiresOn,
    serviceChargesCleared: n.serviceChargesCleared,
    paidFils: n.paidFils ?? null,
    paidReadFils: n.paidReadFils ?? null,
  };
  const codes: string[] = [...(await checkNoc(tx, d, row, today)), ...(by.reviewCodes ?? [])];
  const old = await tx.db
    .select({ id: nocRecords.id })
    .from(nocRecords)
    .where(and(eq(nocRecords.dealId, dealId), ne(nocRecords.status, "superseded")));
  for (const o of old) {
    await tx.db.update(nocRecords).set({ status: "superseded" }).where(eq(nocRecords.id, o.id));
    await cancelReviews(tx, dealId, o.id);
  }
  await cancelUnreadableReviews(tx, dealId);
  const id = newId();
  const status = codes.length ? "review" : "matched";
  await tx.db.insert(nocRecords).values({
    id,
    dealId,
    documentId: n.documentId,
    source: by.source,
    ...row,
    issuedOn: n.issuedOn,
    paidConfirmedBy: by.paidConfirmedBy,
    status,
    mismatches: codes,
    enteredBy: by.actor,
    enteredAt: ctx.clock.now(),
  });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: dealId },
    type: "NOC_RECORDED",
    actor: by.actor,
    rulesVersion: d.rulesVersion,
    payload: {
      recordId: id,
      documentId: n.documentId,
      source: by.source,
      status,
      codes,
      supersedes: old.map((o) => o.id),
    },
  });
  await evaluateNoc(ctx, dealId, tx);
  return { id, status, codes };
}

/** A reader's "couldn't read it" and "instruction-like text" reviews (no record behind them) are cancelled once a NOC is stored for the deal (S52). */
async function cancelUnreadableReviews(tx: SpaTx, dealId: string): Promise<void> {
  await tx.db
    .update(spaApprovals)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(spaApprovals.gate, "noc_review"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, dealId),
        eq(spaApprovals.status, "pending"),
        sql`${spaApprovals.proposal}->>'reason' in ('unreadable', 'expired', 'instruction')`,
      ),
    );
}

/** Pending `noc_review` approvals of a record (optionally except those for these blockers) are cancelled. */
async function cancelReviews(tx: SpaTx, dealId: string, recordId: string, keepCodes?: string): Promise<void> {
  const pending = await tx.db
    .select({ id: spaApprovals.id, proposal: spaApprovals.proposal })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.gate, "noc_review"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, dealId),
        eq(spaApprovals.status, "pending"),
      ),
    );
  const stale = pending.filter(
    (p) =>
      p.proposal.nocRecordId === recordId &&
      (keepCodes === undefined || [...((p.proposal.codes as string[]) ?? [])].toSorted().join(",") !== keepCodes),
  );
  if (stale.length)
    await tx.db
      .update(spaApprovals)
      .set({ status: "cancelled" })
      .where(
        inArray(
          spaApprovals.id,
          stale.map((s) => s.id),
        ),
      );
}

/**
 * Re-checks the deal's current NOC against the deal as it is now and moves things on (S47). A blocker no approval
 * covers opens `noc_review`, once per record and set of blockers (never again after a rejection); a review for blockers
 * that no longer apply is cancelled. An expired NOC opens nothing: approving it could not help. Then the steps the
 * facts allow run as `system:noc-check`. Safe to run twice.
 */
export async function evaluateNoc(ctx: SpaContext, dealId: string, tx?: SpaTx): Promise<void> {
  const run = async (t: SpaTx) => {
    const [d] = await t.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    const today = ctx.clock.today();
    const cur = await currentNoc(t, d, today);
    if (cur && NOC_STATES.has(d.state)) {
      const key = [...cur.codes].toSorted().join(",");
      await cancelReviews(t, dealId, cur.record.id, key);
      if (cur.codes.length && cur.record.expiresOn >= today && !(await nocOkFact(t, d, today))) {
        const dedupeKey = `${cur.record.id}:noc_review:${key}`;
        const [rejected] = await t.db
          .select({ id: spaApprovals.id })
          .from(spaApprovals)
          .where(
            and(
              eq(spaApprovals.entityId, dealId),
              eq(spaApprovals.status, "rejected"),
              sql`${spaApprovals.dedupeKey} = ${dedupeKey}`,
            ),
          );
        if (!rejected)
          await proposeApproval(
            ctx,
            {
              gate: "noc_review",
              entity: { kind: "deal", id: dealId },
              dedupeKey,
              title: "NOC needs review",
              proposal: { nocRecordId: cur.record.id, codes: cur.codes },
              reasons: cur.codes,
              proposedBy: CHECKER,
            },
            t,
          );
      }
    }
    await advanceResale(ctx, t, dealId);
  };
  return tx ? run(tx) : withSpaTx(ctx.database, run);
}

/**
 * The steps the facts allow (S47): `NOC_OK`, then `FINANCE_OK`, as `system:noc-check`. Entering `SETTLEMENT` builds the
 * statement; in `SETTLEMENT` the statement is kept fresh and an approved one moves the deal on (S48).
 */
export async function advanceResale(ctx: SpaContext, tx: SpaTx, dealId: string): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId));
    if (!d) return;
    const f = await ctx.facts.deal(tx, d, ctx.clock.today(), { amlListVersion: ctx.amlListVersion });
    const event =
      d.state === "NOC" && f.nocOk ? "NOC_OK" : d.state === "FINANCE" && f.bankLettersConfirmed ? "FINANCE_OK" : null;
    if (!event) break;
    await advance(ctx, { kind: "deal", id: dealId }, event, { actor: CHECKER, tx });
  }
  await refreshSettlement(ctx, tx, dealId);
  await advanceSettled(ctx, tx, dealId);
}

const LetterInput = z
  .object({
    side: z.enum(["seller", "buyer"]),
    kind: z.enum(["liability_letter", "release_letter", "pre_approval", "valuation", "final_offer"]),
    documentId: z.uuid(),
    issuedOn: calDate,
    validUntil: calDate.optional(),
    /** The amount typed from the letter, shown beside it: never used until a person confirms it. */
    amountReadFils: z.number().int().positive().optional(),
  })
  .refine((l) => (BANK_LETTER_KINDS[l.side] as readonly string[]).includes(l.kind), {
    message: "this letter doesn't belong to that side",
    path: ["kind"],
  })
  .refine((l) => !l.validUntil || l.validUntil >= l.issuedOn, {
    message: "valid until is before issue",
    path: ["validUntil"],
  });

/** A person records a bank letter (S47). No amount counts yet; `confirmBankAmount` does that. */
export async function recordBankLetter(
  ctx: SpaContext,
  dealId: string,
  input: unknown,
  user: Person,
): Promise<{ id: string }> {
  need(user, ENTER_ROLES, "enter a bank letter");
  const parsed = LetterInput.safeParse(input);
  if (!parsed.success) throw invalid("invalid_letter", parsed.error);
  const l = parsed.data;
  return withSpaTx(ctx.database, async (tx) => {
    const d = await lockResale(tx, dealId);
    if (l.side === "seller" ? !d.sellerMortgage : !d.buyerMortgage)
      throw unprocessable("no_mortgage", `the ${l.side} has no mortgage on this deal`);
    // A release letter comes after the transfer (S15); the others while the deal waits for the NOC or the bank.
    const states = l.kind === "release_letter" ? ["COMPLETED"] : ["NOC", "FINANCE"];
    if (!states.includes(d.state)) throw conflict("wrong_state", `a ${l.kind} can't be entered in ${d.state}`);
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, l.documentId));
    if (!doc || doc.dealId !== dealId || doc.kind !== l.kind)
      throw unprocessable("invalid_document", `upload the ${l.kind} to this deal first`);
    return storeBankLetter(ctx, tx, d, l, actorOf(user));
  });
}

export interface StoredLetter {
  side: "seller" | "buyer";
  kind: "liability_letter" | "release_letter" | "pre_approval" | "valuation" | "final_offer";
  documentId: string;
  issuedOn: string;
  validUntil?: string | undefined;
  amountReadFils?: number | undefined;
}

/**
 * Stores a bank letter as the current one of its kind (S47, S52). Only the amount as read or typed (`amount_read_fils`):
 * `amount_fils` stays empty until `confirmBankAmount` records a person. The caller holds the deal lock and has checked
 * the deal's state and mortgage.
 */
export async function storeBankLetter(
  ctx: SpaContext,
  tx: SpaTx,
  d: typeof deals.$inferSelect,
  l: StoredLetter,
  actor: SpaActor,
): Promise<{ id: string }> {
  const dealId = d.id;
  await supersedeLetter(tx, dealId, l.kind);
  const id = newId();
  await tx.db.insert(bankLetters).values({
    id,
    dealId,
    side: l.side,
    kind: l.kind,
    documentId: l.documentId,
    issuedOn: l.issuedOn,
    validUntil: l.validUntil ?? null,
    amountReadFils: l.amountReadFils ?? null,
    enteredBy: actor,
    enteredAt: ctx.clock.now(),
  });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: dealId },
    type: "BANK_LETTER_RECORDED",
    actor,
    rulesVersion: d.rulesVersion,
    payload: { letterId: id, kind: l.kind, side: l.side, documentId: l.documentId, validUntil: l.validUntil ?? null },
  });
  await advanceResale(ctx, tx, dealId);
  return { id };
}

async function supersedeLetter(tx: SpaTx, dealId: string, kind: string): Promise<void> {
  await tx.db
    .update(bankLetters)
    .set({ status: "superseded" })
    .where(and(eq(bankLetters.dealId, dealId), eq(bankLetters.kind, kind as never), eq(bankLetters.status, "current")));
}

/** Letters whose validity gates a step: the person confirming the amount confirms the end date too (review 5). */
const DATED_KINDS: ReadonlySet<string> = new Set(["liability_letter", "pre_approval", "final_offer"]);

/**
 * A person confirms the amount and the end date on a bank letter (S47, review 5). Only now does it count. It writes a
 * new row (the old one is superseded) whose `valid_until` is what the person typed, never what a reader saw; the event
 * records the confirmed values beside what was read, and whether they differ. A liability letter, pre-approval and final
 * offer need the date (422 `valid_until_required`).
 */
export async function confirmBankAmount(
  ctx: SpaContext,
  letterId: string,
  amountFils: unknown,
  user: Person,
  validUntil?: unknown,
): Promise<{ id: string }> {
  need(user, ENTER_ROLES, "confirm a bank amount");
  const amount = z.number().int().positive().safeParse(amountFils);
  if (!amount.success) throw unprocessable("invalid_amount", "the amount is a whole number of fils above zero");
  const until = validUntil === undefined ? undefined : calDate.safeParse(validUntil);
  if (until && !until.success) throw unprocessable("invalid_date", "the end date is a date as YYYY-MM-DD");
  return withSpaTx(ctx.database, async (tx) => {
    const [old] = await tx.db.select().from(bankLetters).where(eq(bankLetters.id, letterId)).for("update");
    if (!old) throw notFound("bank letter");
    if (old.status !== "current") throw conflict("superseded", "a newer letter replaced this one");
    const d = await lockResale(tx, old.dealId);
    // The statement is fixed once the deal reaches the transfer step (S48): the payoff and the loan can't move.
    if ((old.kind === "liability_letter" || old.kind === "final_offer") && STATEMENT_FIXED_STATES.has(d.state))
      throw conflict(
        "statement_fixed",
        `a ${old.kind.replace("_", " ")} amount can't change once the deal is in ${d.state}`,
      );
    const confirmedUntil = until?.data ?? (DATED_KINDS.has(old.kind) ? undefined : (old.validUntil ?? undefined));
    if (DATED_KINDS.has(old.kind) && !confirmedUntil)
      throw unprocessable("valid_until_required", `confirm the date this ${old.kind.replace("_", " ")} is valid until`);
    if (confirmedUntil && confirmedUntil < old.issuedOn)
      throw unprocessable("invalid_date", "valid until is before the letter was issued");
    await tx.db.update(bankLetters).set({ status: "superseded" }).where(eq(bankLetters.id, old.id));
    const id = newId();
    const now = ctx.clock.now();
    await tx.db.insert(bankLetters).values({
      id,
      dealId: old.dealId,
      side: old.side,
      kind: old.kind,
      documentId: old.documentId,
      issuedOn: old.issuedOn,
      validUntil: confirmedUntil ?? null,
      amountFils: amount.data,
      amountReadFils: old.amountReadFils,
      confirmedBy: user.id,
      confirmedAt: now,
      enteredBy: old.enteredBy,
      enteredAt: old.enteredAt,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: old.dealId },
      type: "BANK_AMOUNT_CONFIRMED",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: {
        letterId: id,
        supersedes: old.id,
        kind: old.kind,
        side: old.side,
        amountFils: amount.data,
        amountReadFils: old.amountReadFils,
        differs: old.amountReadFils !== null && old.amountReadFils !== amount.data,
        validUntil: confirmedUntil ?? null,
        validUntilRead: old.validUntil,
        validUntilDiffers: old.validUntil !== (confirmedUntil ?? null),
      },
    });
    await advanceResale(ctx, tx, old.dealId);
    return { id };
  });
}

/**
 * A person confirms a NOC a reader wrote (S47, S52 amendment, review 5). Until then a `source = reader` record never
 * passes `nocOk`: the model copied text, so a person looks at the NOC and says the fields are right. Like a bank amount,
 * it writes a new record (the reader's is superseded) with the person as the enterer and `source = manual`; the reader's
 * paid amount stays beside it as read, and counts only if the person types the paid amount too (`paidFils`). The checks
 * run again and a blocker still opens `noc_review`. The event records what it replaced.
 */
export async function confirmNoc(
  ctx: SpaContext,
  recordId: string,
  user: Person,
  paidFils?: unknown,
): Promise<{ id: string; status: "matched" | "review"; codes: string[] }> {
  need(user, ENTER_ROLES, "confirm a NOC");
  const paid = paidFils === undefined ? undefined : z.number().int().min(0).safeParse(paidFils);
  if (paid && !paid.success) throw unprocessable("invalid_amount", "the paid amount is a whole number of fils");
  return withSpaTx(ctx.database, async (tx) => {
    const [old] = await tx.db.select().from(nocRecords).where(eq(nocRecords.id, recordId)).for("update");
    if (!old) throw notFound("NOC record");
    if (old.status === "superseded") throw conflict("superseded", "a newer NOC replaced this one");
    if (old.source !== "reader") throw conflict("not_reader_record", "a person already entered this NOC");
    const d = await lockResale(tx, old.dealId);
    if (!NOC_STATES.has(d.state))
      throw conflict(
        "not_in_noc",
        `a NOC is confirmed while the deal is in NOC, SETTLEMENT or TRANSFER, not ${d.state}`,
      );
    if (old.expiresOn < ctx.clock.today())
      throw unprocessable("noc_expired", "this NOC has already expired: ask for a new one");
    const r = await storeNoc(
      ctx,
      tx,
      d,
      {
        documentId: old.documentId,
        unitNo: old.unitNo,
        sellerNames: old.sellerNames,
        issuedOn: old.issuedOn,
        expiresOn: old.expiresOn,
        serviceChargesCleared: old.serviceChargesCleared,
        paidFils: paid?.data,
        paidReadFils: old.paidReadFils ?? undefined,
      },
      { source: "manual", actor: actorOf(user), paidConfirmedBy: paid ? user.id : null },
    );
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: d.id },
      type: "NOC_CONFIRMED",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: { recordId: r.id, supersedes: old.id, source: old.source },
    });
    return r;
  });
}

/**
 * The daily NOC sweep (S47): a warning event 7 days before a current NOC expires (once per NOC, keyed
 * `<dealId>:noc_expiry:<expires_on>`), one `NOC_EXPIRED` event after, and a re-check of every open NOC. Safe to run twice.
 */
export async function nocExpirySweep(ctx: SpaContext): Promise<{ warned: string[] }> {
  const today = ctx.clock.today();
  const open = await ctx.database.db
    .select({ dealId: nocRecords.dealId, recordId: nocRecords.id, expiresOn: nocRecords.expiresOn })
    .from(nocRecords)
    .innerJoin(deals, eq(deals.id, nocRecords.dealId))
    .where(
      and(ne(nocRecords.status, "superseded"), inArray(deals.state, ["NOC", "FINANCE", "SETTLEMENT", "TRANSFER"])),
    );
  const warned: string[] = [];
  for (const n of open) {
    await withSpaTx(ctx.database, async (tx) => {
      const [d] = await tx.db.select().from(deals).where(eq(deals.id, n.dealId)).for("update");
      if (!d) return;
      const left = diffDays(today, n.expiresOn as CalendarDate);
      const type = left < 0 ? "NOC_EXPIRED" : left <= WARN_DAYS ? "NOC_EXPIRY_WARNING" : null;
      if (type) {
        const key = `${n.dealId}:${type === "NOC_EXPIRED" ? "noc_expired" : "noc_expiry"}:${n.expiresOn}`;
        const [done] = await tx.db
          .select({ id: dealEvents.id })
          .from(dealEvents)
          .where(
            and(
              eq(dealEvents.entityId, n.dealId),
              eq(dealEvents.type, type),
              sql`${dealEvents.payload}->>'key' = ${key}`,
            ),
          );
        if (!done) {
          await appendDealEvent(tx, ctx, {
            entity: { kind: "deal", id: n.dealId },
            type,
            actor: "system:noc-expiry",
            rulesVersion: d.rulesVersion,
            payload: { key, recordId: n.recordId, expiresOn: n.expiresOn, daysLeft: left },
          });
          if (type === "NOC_EXPIRY_WARNING") warned.push(n.dealId);
        }
      }
      await evaluateNoc(ctx, n.dealId, tx);
    }).catch((e) => console.error(`noc sweep: deal ${n.dealId}:`, e instanceof Error ? e.message : e));
  }
  return { warned };
}
