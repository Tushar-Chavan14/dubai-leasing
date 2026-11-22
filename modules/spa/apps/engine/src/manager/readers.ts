import { newId } from "@platform/kernel/ids";
import { maskPii } from "@platform/kernel/pii";
import type { Llm } from "@platform/llm";
import type { SpaActor, SpaRole } from "@spa/core";
import {
  BANK_LETTER_KINDS,
  bankLetters,
  type DocumentKind,
  documentReads,
  documents,
  deals,
  helperRuns,
  nocRecords,
  spaApprovals,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import {
  documentReader,
  interpretLetter,
  interpretNoc,
  READER_PROMPT_VERSION,
  type ReadFields,
  type ReadProfile,
} from "@spa/helpers";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { DOCUMENT_READ_JOB } from "../jobs.ts";
import { driveAfter } from "./drive.ts";
import { afterHelperResult, requireHelperOn } from "./helper-modes.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { lockResale, NOC_STATES, storeBankLetter, storeNoc } from "./noc.ts";

export { DOCUMENT_READ_JOB };
export const documentReadJobKey = (documentId: string) => `${documentId}:read`;

const READER: SpaActor = "system:document-reader";
type Person = { id: string; role: SpaRole };
/** Who starts a read: the sales team and admin (as for KYC). */
export const READ_START_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
export const needSales = (u: Person, what: string) => {
  if (!READ_START_ROLES.includes(u.role)) throw forbidden(`only ${READ_START_ROLES.join(", ")} can ${what}`);
};

/** What the reader reads, by the kind a document was uploaded as. `valuation` and person IDs are read elsewhere or not. */
export const PROFILE_OF_KIND: Partial<Record<DocumentKind, ReadProfile>> = {
  noc: "noc",
  liability_letter: "liability_letter",
  release_letter: "release_letter",
  pre_approval: "pre_approval",
  final_offer: "final_offer",
  trade_licence: "trade_licence",
  memorandum: "moa",
  poa: "poa",
  board_resolution: "board_resolution",
  title_deed: "title_deed",
  oqood: "oqood",
  // C22 (S55): read only; `registerPayment` checks the copy by code. The read applies nothing by itself.
  payment_receipt: "payment_receipt",
};

/** What the readers need from outside: a local model and the stored file's bytes. Documents never leave this machine. */
export interface ReaderDeps {
  llm: Llm;
  readFile: (storageKey: string) => Promise<Uint8Array>;
}

type DocRow = typeof documents.$inferSelect;
type ReadRow = typeof documentReads.$inferSelect;
export type ReadOutcome = { ok: true; row: ReadRow } | { ok: false; reasons: string[] };

const findRead = async (db: SpaTx["db"] | SpaContext["database"]["db"], documentId: string) =>
  (
    await db
      .select()
      .from(documentReads)
      .where(and(eq(documentReads.documentId, documentId), eq(documentReads.promptVersion, READER_PROMPT_VERSION)))
  )[0];

/**
 * The reader's copy of one document: found if this document was already read under this prompt, else read now by the
 * vision model (no transaction is open while it works) and stored with a `helper_runs` row. A model that fails twice
 * stores only a `needs_human` run: nothing else changes (rule 6).
 */
export async function ensureRead(ctx: SpaContext, deps: ReaderDeps, doc: DocRow): Promise<ReadOutcome> {
  const profile = PROFILE_OF_KIND[doc.kind];
  if (!profile) return { ok: false, reasons: ["This kind of document isn't read."] };
  const before = await findRead(ctx.database.db, doc.id);
  if (before) return { ok: true, row: before };
  const [deal] = await ctx.database.db.select().from(deals).where(eq(deals.id, doc.dealId));
  if (!deal) throw notFound("deal");
  const run = await documentReader(deps.llm, () => deps.readFile(doc.storageKey)).run({
    runId: newId(),
    entity: { kind: "document", id: doc.id },
    step: "read",
    context: { docId: doc.id, profile },
    rulesVersion: deal.rulesVersion,
    now: ctx.clock.now().toISOString(),
  });
  return withSpaTx(ctx.database, async (tx): Promise<ReadOutcome> => {
    // Another worker may have stored the same read while the model was working.
    const again = await findRead(tx.db, doc.id);
    if (again) return { ok: true, row: again };
    const runId = newId();
    const data = run.status === "ok" ? run.data : undefined;
    await tx.db.insert(helperRuns).values({
      id: runId,
      helper: "spa_document_reader",
      dealId: doc.dealId,
      entityKind: "document",
      entityId: doc.id,
      status: data ? "ok" : "needs_human",
      result: maskPii({ profile, instructionFound: data?.instructionFound ?? false }),
      reasons: maskPii(
        data?.instructionFound ? ["Text on the document reads like an instruction. It was ignored."] : run.reasons,
      ),
      modelTag: deps.llm.visionModelName ?? null,
      promptVersion: READER_PROMPT_VERSION,
      rulesVersion: deal.rulesVersion,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    if (!data) return { ok: false, reasons: run.reasons };
    const [row] = await tx.db
      .insert(documentReads)
      .values({
        id: newId(),
        documentId: doc.id,
        profile,
        fields: data.fields,
        modelTag: deps.llm.visionModelName ?? null,
        promptVersion: READER_PROMPT_VERSION,
        instructionFound: data.instructionFound,
        runId,
        readAt: ctx.clock.now(),
      })
      .returning();
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: doc.dealId },
      type: "DOCUMENT_READ",
      actor: READER,
      rulesVersion: deal.rulesVersion,
      payload: { documentId: doc.id, kind: doc.kind, profile, instructionFound: data.instructionFound },
    });
    return { ok: true, row: row! };
  });
}

export interface ReadResult {
  /** `applied`: the read fed the NOC or bank-letter records. `review`: a person must look (`noc_review`). `read`: kept, nothing applied. */
  status: "applied" | "review" | "read" | "needs_human";
  applied?: boolean;
  reasons?: string[];
}

/** One `noc_review` for a NOC the reader couldn't turn into a record (unreadable or already expired); once per reason. */
async function reviewUnusableNoc(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  doc: DocRow,
  reason: "unreadable" | "expired" | "instruction",
  unreadable: string[],
): Promise<void> {
  const dedupeKey = `${doc.id}:noc_review:${reason}`;
  // Whatever happened to an earlier review of this document, a repeated read doesn't open another.
  const [seen] = await tx.db
    .select({ id: spaApprovals.id })
    .from(spaApprovals)
    .where(eq(spaApprovals.dedupeKey, dedupeKey));
  if (seen) return;
  await proposeApproval(
    ctx,
    {
      gate: "noc_review",
      entity: { kind: "deal", id: dealId },
      dedupeKey,
      title:
        reason === "expired"
          ? "NOC already expired"
          : reason === "instruction"
            ? "NOC carries instruction-like text"
            : "NOC couldn't be read",
      proposal: { documentId: doc.id, reason, unreadable },
      reasons: [
        reason === "expired"
          ? "The NOC's expiry date is in the past: ask the developer for a new one."
          : reason === "instruction"
            ? "Text on the NOC reads like an instruction. It was ignored: check the NOC itself and confirm or enter it by hand."
            : `The NOC couldn't be read clearly (${unreadable.join(", ")}): enter it by hand.`,
      ],
      proposedBy: READER,
    },
    tx,
  );
}

async function applyNoc(ctx: SpaContext, doc: DocRow, row: ReadRow): Promise<ReadResult> {
  return withSpaTx(ctx.database, async (tx): Promise<ReadResult> => {
    const d = await lockResale(tx, doc.dealId);
    if (!NOC_STATES.has(d.state))
      return { status: "read", applied: false, reasons: [`The deal is in ${d.state}: a NOC is entered in NOC.`] };
    const [dup] = await tx.db.select({ id: nocRecords.id }).from(nocRecords).where(eq(nocRecords.documentId, doc.id));
    if (dup) return { status: "read", applied: false, reasons: ["This NOC is already recorded."] };
    const p = interpretNoc(row.fields as ReadFields);
    if (p.unreadable.length) {
      await reviewUnusableNoc(ctx, tx, doc.dealId, doc, "unreadable", p.unreadable);
      return { status: "review", applied: false, reasons: p.unreadable };
    }
    if (p.expiresOn! < ctx.clock.today()) {
      await reviewUnusableNoc(ctx, tx, doc.dealId, doc, "expired", []);
      return { status: "review", applied: false };
    }
    await storeNoc(
      ctx,
      tx,
      d,
      {
        documentId: doc.id,
        unitNo: p.unitNo!,
        sellerNames: p.sellerNames,
        issuedOn: p.issuedOn!,
        expiresOn: p.expiresOn!,
        serviceChargesCleared: p.serviceChargesCleared!,
        // Only what was read. `paid_fils` stays null until a person confirms it.
        paidReadFils: p.paidReadFils ?? undefined,
      },
      {
        source: "reader",
        actor: READER,
        paidConfirmedBy: null,
        // Instruction-like text can never leave a reader's NOC "matched": it goes to a person (S52 amendment).
        ...(row.instructionFound ? { reviewCodes: ["instruction_found"] } : {}),
      },
    );
    if (row.instructionFound) {
      await reviewUnusableNoc(ctx, tx, doc.dealId, doc, "instruction", []);
      return { status: "review", applied: true, reasons: ["instruction_found"] };
    }
    // Review mode (S59): a clean read waits for a person's "looks right" before the record counts (scope: the kind).
    await afterHelperResult(ctx, tx, {
      helper: "spa_document_reader",
      scope: doc.kind,
      dealId: doc.dealId,
      runId: row.runId,
      status: "ok",
    });
    return { status: "applied" };
  });
}

/** A receipt's read applies nothing by itself; in review mode (S59) it waits for a person before a payment may use it. */
async function holdReceiptRead(ctx: SpaContext, doc: DocRow, row: ReadRow): Promise<ReadResult> {
  const { held } = await withSpaTx(ctx.database, (tx) =>
    afterHelperResult(ctx, tx, {
      helper: "spa_document_reader",
      scope: "payment_receipt",
      dealId: doc.dealId,
      runId: row.runId,
      status: "ok",
    }),
  );
  return {
    status: "read",
    applied: false,
    ...(held ? { reasons: ["The read is waiting for a person's check."] } : {}),
  };
}

const LETTER_KINDS = ["liability_letter", "release_letter", "pre_approval", "final_offer"] as const;
type LetterKind = (typeof LETTER_KINDS)[number];

async function applyLetter(ctx: SpaContext, doc: DocRow, row: ReadRow): Promise<ReadResult> {
  const kind = doc.kind as LetterKind;
  const side = (BANK_LETTER_KINDS.seller as readonly string[]).includes(kind) ? "seller" : "buyer";
  return withSpaTx(ctx.database, async (tx): Promise<ReadResult> => {
    const d = await lockResale(tx, doc.dealId);
    const [dup] = await tx.db
      .select({ id: bankLetters.id })
      .from(bankLetters)
      .where(eq(bankLetters.documentId, doc.id));
    if (dup) return { status: "read", applied: false, reasons: ["This letter is already recorded."] };
    if (side === "seller" ? !d.sellerMortgage : !d.buyerMortgage)
      return { status: "read", applied: false, reasons: [`The ${side} has no mortgage on this deal.`] };
    // A release letter comes after the transfer (S15); the others while the deal waits for the NOC or the bank.
    const states = kind === "release_letter" ? ["COMPLETED"] : ["NOC", "FINANCE"];
    if (!states.includes(d.state))
      return { status: "read", applied: false, reasons: [`A ${kind} isn't entered in ${d.state}.`] };
    const p = interpretLetter(row.fields as ReadFields);
    if (p.unreadable.length) {
      const reasons = [
        `The ${kind.replace("_", " ")} couldn't be read clearly (${p.unreadable.join(", ")}): enter it by hand.`,
      ];
      await tx.db.insert(helperRuns).values({
        id: newId(),
        helper: "spa_document_reader",
        dealId: doc.dealId,
        entityKind: "document",
        entityId: doc.id,
        status: "needs_human",
        result: { task: "enter_letter", kind },
        reasons,
        modelTag: row.modelTag,
        promptVersion: READER_PROMPT_VERSION,
        rulesVersion: d.rulesVersion,
        visibility: "staff",
        createdAt: ctx.clock.now(),
      });
      return { status: "read", applied: false, reasons };
    }
    // The amount goes in as `amount_read_fils` only. `amount_fils` needs a person (`confirmBankAmount`).
    const { id } = await storeBankLetter(
      ctx,
      tx,
      d,
      {
        side,
        kind,
        documentId: doc.id,
        issuedOn: p.issuedOn!,
        validUntil: p.validUntil ?? undefined,
        amountReadFils: p.amountReadFils ?? undefined,
      },
      READER,
    );
    await afterHelperResult(ctx, tx, {
      helper: "spa_document_reader",
      scope: doc.kind,
      dealId: doc.dealId,
      runId: row.runId,
      status: "ok",
    });
    // The confirmation task for the agent (a `helper_runs` row until the task list exists, C30).
    await tx.db.insert(helperRuns).values({
      id: newId(),
      helper: "spa_document_reader",
      dealId: doc.dealId,
      entityKind: "bank_letter",
      entityId: id,
      status: "needs_human",
      result: {
        task: "confirm_amount",
        letterId: id,
        kind,
        amountRead: p.amountReadFils !== null,
        // Instruction-like text on the letter (S52 amendment): the task says to check the letter itself.
        instructionFound: row.instructionFound,
      },
      reasons: [
        `Confirm the amount on the ${kind.replace("_", " ")} against the letter: nothing counts until a person does.`,
        ...(row.instructionFound
          ? ["Text on the letter reads like an instruction. It was ignored: check the letter itself."]
          : []),
      ],
      modelTag: row.modelTag,
      promptVersion: READER_PROMPT_VERSION,
      rulesVersion: d.rulesVersion,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    return { status: "applied" };
  });
}

/**
 * Reads one uploaded document (S52) and, for a NOC or a bank letter, feeds the C15 records. The model copies text;
 * code parses it and decides. A NOC read writes `source = reader` with only `paid_read_fils`; a letter read writes only
 * `amount_read_fils`: neither amount counts until a person confirms it. Safe to run twice: the read is kept, and a
 * document already recorded is not recorded again.
 */
export async function readDocument(
  ctx: SpaContext,
  deps: ReaderDeps,
  input: { documentId: string },
): Promise<ReadResult> {
  const r = await readDocumentOnce(ctx, deps, input);
  const [doc] = await ctx.database.db
    .select({ dealId: documents.dealId })
    .from(documents)
    .where(eq(documents.id, input.documentId));
  if (doc) await driveAfter(ctx, doc.dealId);
  return r;
}

async function readDocumentOnce(ctx: SpaContext, deps: ReaderDeps, input: { documentId: string }): Promise<ReadResult> {
  const [doc] = await ctx.database.db.select().from(documents).where(eq(documents.id, input.documentId));
  if (!doc) throw notFound("document");
  // Off for this kind (S59): a read queued before the switch is not made either, and the agent has a task.
  if (PROFILE_OF_KIND[doc.kind]) await requireHelperOn(ctx, "spa_document_reader", doc.kind, doc.dealId);
  const read = await ensureRead(ctx, deps, doc);
  if (!read.ok)
    return { status: read.reasons[0]?.startsWith("This kind") ? "read" : "needs_human", reasons: read.reasons };
  if (doc.kind === "noc") return applyNoc(ctx, doc, read.row);
  if (doc.kind === "payment_receipt") return holdReceiptRead(ctx, doc, read.row);
  if ((LETTER_KINDS as readonly string[]).includes(doc.kind)) return applyLetter(ctx, doc, read.row);
  return { status: "read", applied: false };
}

/** Queues a read of one document: one job per document, safe to send twice (rule 7). */
export async function enqueueDocumentRead(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  documentId: string,
  user?: Person,
): Promise<{ key: string; jobId: string | null; queued: boolean }> {
  if (user) needSales(user, "start a document read");
  const [doc] = await ctx.database.db
    .select({ kind: documents.kind, dealId: documents.dealId })
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!doc) throw notFound("document");
  if (!PROFILE_OF_KIND[doc.kind]) throw unprocessable("not_readable", "this kind of document isn't read by the reader");
  await requireHelperOn(ctx, "spa_document_reader", doc.kind, doc.dealId);
  const key = documentReadJobKey(documentId);
  const jobId = await boss.send(DOCUMENT_READ_JOB, { documentId }, { singletonKey: key });
  return { key, jobId, queued: jobId !== null };
}
