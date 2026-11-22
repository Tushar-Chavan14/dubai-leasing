import { newId } from "@platform/kernel/ids";
import { compareNames } from "@platform/kernel/names";
import type { SpaActor, SpaRole } from "@spa/core";
import {
  dealEvents,
  dealParties,
  deals,
  documentReads,
  documents,
  PAYMENT_METHODS,
  paymentPlanRows,
  payments,
  parties,
  type PaymentStatus,
  withSpaTx,
} from "@spa/db";
import { interpretReceipt, type ReadFields } from "@spa/helpers";
import { and, desc, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { currentEscrowAccount } from "./escrow.ts";
import { enqueueAmlScreening } from "./aml-screening.ts";
import { heldDocumentIds } from "./helper-modes.ts";
import { planCoverage } from "./payment-facts.ts";
import { closeTask, openTask } from "./tasks.ts";

type Person = { id: string; role: SpaRole };
/** Who registers a receipt, sets the project and marks a milestone: the people who run the deal, and finance for receipts. */
const SALES_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
const REGISTER_ROLES: readonly SpaRole[] = [...SALES_ROLES, "finance"];
/** Who reads the payments of a deal. Compliance roles see the payer check; nobody else does (S50, tipping-off). */
const READ_ROLES: readonly SpaRole[] = [...REGISTER_ROLES, "compliance_officer", "mlro"];
const COMPLIANCE_ROLES: readonly SpaRole[] = ["compliance_officer", "mlro"];
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);
const actorOf = (u: Person): SpaActor => `user:${u.id}`;
const need = (u: Person, roles: readonly SpaRole[], what: string) => {
  if (!roles.includes(u.role)) throw forbidden(`only ${roles.join(", ")} can ${what}`);
};

const RegisterInput = z.object({
  documentId: z.uuid(),
  seq: z.number().int().min(1),
  method: z.enum(PAYMENT_METHODS as [string, ...string[]]).default("transfer"),
});

/** The only words staff see about a payment that needs a look (S55): no reason, nothing about the payer check. */
const NOTES: Readonly<Record<string, string>> = {
  payer_review: "Payer name needs review",
  instruction_found: "The receipt needs a person's check",
  not_escrow: "Not paid into the project's escrow account",
  no_escrow_account: "The project has no escrow account on file",
  account_unreadable: "The receiving account couldn't be read",
};

/**
 * Registers a transfer receipt against one plan row (S55). Code reads the stored copy of the receipt and checks it:
 * `into_escrow` is the receipt's IBAN equal to the project's current escrow account; `payer_is_buyer` is the payer's
 * name equal (exact or typo-class) to a buyer of the deal. No amount counts here: a payment waits as `read` for
 * finance to confirm. A payment not into the escrow account is `not_counted` and can never be counted; a payer who is
 * not a buyer is `needs_review` (the payer joins the screening subjects, S50, seen only by compliance).
 */
export async function registerPayment(
  ctx: SpaContext,
  dealId: string,
  input: unknown,
  user: Person,
  opts: { boss?: Pick<PgBoss, "send"> } = {},
): Promise<{ id: string; status: PaymentStatus; reasonCode: string | null }> {
  need(user, REGISTER_ROLES, "register a payment");
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_payment",
      "the payment isn't valid",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  const p = parsed.data;
  const result = await withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} takes no more payments`);
    const [row] = await tx.db
      .select()
      .from(paymentPlanRows)
      .where(and(eq(paymentPlanRows.dealId, dealId), eq(paymentPlanRows.seq, p.seq)));
    if (!row) throw unprocessable("no_plan_row", "the deal has no such payment plan row");
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, p.documentId));
    if (!doc || doc.dealId !== dealId || doc.kind !== "payment_receipt")
      throw unprocessable("not_a_receipt", "that isn't a payment receipt of this deal");
    const [again] = await tx.db.select({ id: payments.id }).from(payments).where(eq(payments.documentId, doc.id));
    if (again) throw conflict("already_registered", "this receipt is already registered");
    // A read held for a person's check (review mode, S59) doesn't count: it is skipped until released.
    const heldDocs = await heldDocumentIds(tx, dealId);
    const [read] = heldDocs.has(doc.id)
      ? []
      : await tx.db
          .select()
          .from(documentReads)
          .where(and(eq(documentReads.documentId, doc.id), eq(documentReads.profile, "payment_receipt")))
          .orderBy(desc(documentReads.readAt), desc(documentReads.id))
          .limit(1);
    if (!read)
      throw conflict("not_read", "the receipt hasn't been read yet, or its read is waiting for a person's check");
    const r = interpretReceipt(read.fields as ReadFields);

    // Into the escrow account? Only the project's current account counts; no account means no payment counts.
    const escrow = await currentEscrowAccount(tx.db, d.projectCode);
    const intoEscrow = !!escrow && !!r.accountIban && r.accountIban === escrow.iban;
    // The payer is a buyer? Exact or typo-class match against a buyer of this deal.
    const buyers = await tx.db
      .select({ id: parties.id, name: parties.fullNameEn })
      .from(dealParties)
      .innerJoin(parties, eq(parties.id, dealParties.partyId))
      .where(and(eq(dealParties.dealId, dealId), eq(dealParties.role, "buyer")));
    const buyer = r.payerName
      ? buyers.find((b) => {
          const m = compareNames(r.payerName!, b.name);
          return m === "exact" || m === "typo_class";
        })
      : undefined;

    let status: PaymentStatus = "read";
    let reasonCode: string | null = null;
    if (!intoEscrow) {
      status = "not_counted";
      reasonCode = !escrow ? "no_escrow_account" : !r.accountIban ? "account_unreadable" : "not_escrow";
    } else if (read.instructionFound) {
      status = "needs_review";
      reasonCode = "instruction_found";
    } else if (!buyer) {
      status = "needs_review";
      reasonCode = "payer_review";
    }
    const id = newId();
    await tx.db.insert(payments).values({
      id,
      dealId,
      seq: p.seq,
      documentId: doc.id,
      readId: read.id,
      status,
      method: p.method as never,
      amountReadFils: r.amountReadFils,
      paidOn: r.paidOn,
      payerNameRead: r.payerName,
      payerPartyId: buyer?.id ?? null,
      accountReadMasked: r.accountMasked,
      intoEscrow,
      payerIsBuyer: !!buyer,
      reasonCode,
      registeredBy: actorOf(user),
      createdAt: ctx.clock.now(),
    });
    // The event says what happened to the payment, never who the payer was or why a review was needed.
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "PAYMENT_REGISTERED",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: {
        paymentId: id,
        documentId: doc.id,
        seq: p.seq,
        method: p.method,
        status,
        amountReadFils: r.amountReadFils,
        account: r.accountMasked,
      },
    });
    const detail = { paymentId: id, seq: p.seq };
    if (status === "not_counted")
      await openTask(ctx, tx, {
        dealId,
        kind: "payment_not_escrow",
        role: "finance",
        title: "A payment was not made into the project's escrow account",
        detail: { ...detail, reason: reasonCode },
        dedupeKey: `${id}:not_escrow`,
      });
    else if (status === "needs_review")
      await openTask(ctx, tx, {
        dealId,
        kind: "payment_review",
        role: "finance",
        title: reasonCode === "payer_review" ? "Payer name needs review" : "A receipt needs a person's check",
        detail,
        dedupeKey: `${id}:payment_review`,
      });
    else
      await openTask(ctx, tx, {
        dealId,
        kind: "confirm_amount",
        role: "finance",
        title: "Confirm the amount on a transfer receipt",
        detail,
        dedupeKey: `${id}:confirm_amount`,
      });
    return { id, status, reasonCode, screen: !buyer };
  });
  // A payer who isn't a buyer is a new screening subject: ask for a screening (a queue that is down changes nothing).
  if (result.screen && opts.boss)
    await enqueueAmlScreening(ctx, opts.boss, { dealId, trigger: "manual", subject: result.id }).catch((e: unknown) =>
      console.warn(`could not queue a screening: ${e instanceof Error ? e.message : e}`),
    );
  return { id: result.id, status: result.status, reasonCode: result.reasonCode };
}

/**
 * Finance confirms what was paid (S55): the person types the amount, which may differ from the read one, and only
 * then does the payment count. Refused for a payment that is not into the escrow account (422 `not_escrow`), however
 * it is asked. The event records the read amount, the confirmed amount and whether they differ.
 */
export async function confirmPayment(
  ctx: SpaContext,
  paymentId: string,
  amountFils: unknown,
  user: Person,
  opts: { boss?: Pick<PgBoss, "send"> } = {},
): Promise<{ status: "counted"; amountFils: number; differsFromRead: boolean }> {
  need(user, ["finance"], "confirm a payment");
  if (typeof amountFils !== "number" || !Number.isSafeInteger(amountFils) || amountFils <= 0)
    throw unprocessable("invalid_amount", "the amount must be a whole number of fils above zero");
  const out = await withSpaTx(ctx.database, async (tx) => {
    const [pay] = await tx.db.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!pay) throw notFound("payment");
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, pay.dealId)).for("update");
    if (!d) throw notFound("deal");
    if (pay.status === "counted") throw conflict("already_counted", "this payment is already confirmed");
    if (pay.status === "not_counted" || !pay.intoEscrow)
      throw unprocessable("not_escrow", "a payment not made into the project's escrow account can't be counted");
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} takes no more payments`);
    const now = ctx.clock.now();
    await tx.db
      .update(payments)
      .set({ status: "counted", amountFils, confirmedBy: actorOf(user), confirmedAt: now })
      .where(eq(payments.id, paymentId));
    const differsFromRead = pay.amountReadFils !== amountFils;
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: pay.dealId },
      type: "PAYMENT_CONFIRMED",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: {
        paymentId,
        seq: pay.seq,
        method: pay.method,
        amountReadFils: pay.amountReadFils,
        amountFils,
        differsFromRead,
      },
    });
    await closeTask(ctx, tx, `${paymentId}:confirm_amount`, actorOf(user));
    await closeTask(ctx, tx, `${paymentId}:payment_review`, actorOf(user));
    return { dealId: pay.dealId, method: pay.method, differsFromRead };
  });
  // Cash changes the party's cash total: screen again so the cash rule sees it.
  if (out.method === "cash" && opts.boss)
    await enqueueAmlScreening(ctx, opts.boss, { dealId: out.dealId, trigger: "manual" }).catch((e: unknown) =>
      console.warn(`could not queue a screening: ${e instanceof Error ? e.message : e}`),
    );
  return { status: "counted", amountFils, differsFromRead: out.differsFromRead };
}

/** A deal's payments (S55). Compliance roles also see the payer check; everyone else sees a neutral note only. */
export async function listPayments(ctx: SpaContext, dealId: string, user: Person) {
  need(user, READ_ROLES, "read payments");
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  return paymentsView(ctx, dealId, user.role);
}

/** The payments with no role check; only a compliance role gets the payer check (the caller has checked the role). */
export async function paymentsView(ctx: SpaContext, dealId: string, role: SpaRole) {
  const rows = await ctx.database.db
    .select()
    .from(payments)
    .where(eq(payments.dealId, dealId))
    .orderBy(payments.createdAt, payments.id);
  const compliance = COMPLIANCE_ROLES.includes(role);
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    status: r.status,
    method: r.method,
    amountReadFils: r.amountReadFils,
    amountFils: r.amountFils,
    paidOn: r.paidOn,
    account: r.accountReadMasked,
    intoEscrow: r.intoEscrow,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    note: r.reasonCode ? (NOTES[r.reasonCode] ?? null) : null,
    ...(compliance ? { payerName: r.payerNameRead, payerIsBuyer: r.payerIsBuyer, reasonCode: r.reasonCode } : {}),
  }));
}

/** Sets the project a deal's payments are checked against, on any deal type (S55; `setDealUnit` is resale-only). */
export async function setDealProject(
  ctx: SpaContext,
  dealId: string,
  projectCode: unknown,
  user: Person,
): Promise<void> {
  need(user, SALES_ROLES, "set the project");
  const code = z.string().trim().min(1).max(40).safeParse(projectCode);
  if (!code.success) throw unprocessable("invalid_project", "give the project code");
  await withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} can't change its project`);
    await tx.db.update(deals).set({ projectCode: code.data }).where(eq(deals.id, dealId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "DEAL_PROJECT_SET",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: { from: d.projectCode, to: code.data },
    });
  });
}

/**
 * A staff member records that a milestone instalment's milestone has been reached (S55). A milestone row has no due
 * date, so it gets no reminder and is never overdue by date; instead staff get one task. Once per milestone.
 */
export async function recordMilestoneReached(
  ctx: SpaContext,
  dealId: string,
  seq: number,
  user: Person,
): Promise<{ created: boolean }> {
  need(user, SALES_ROLES, "record a milestone");
  return withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} has no open milestones`);
    const [row] = await tx.db
      .select()
      .from(paymentPlanRows)
      .where(and(eq(paymentPlanRows.dealId, dealId), eq(paymentPlanRows.seq, seq)));
    if (!row) throw notFound("payment plan row");
    if (row.dueOn || !row.milestone)
      throw unprocessable("not_a_milestone", "only an instalment due at a milestone is marked reached");
    const cover = (await planCoverage(tx.db, dealId)).find((c) => c.seq === seq);
    if (cover && cover.paidFils >= cover.amountFils) throw conflict("already_paid", "this instalment is already paid");
    const key = `${dealId}:milestone:${seq}`;
    const [seen] = await tx.db
      .select({ id: dealEvents.id })
      .from(dealEvents)
      .where(
        and(
          eq(dealEvents.entityId, dealId),
          eq(dealEvents.type, "MILESTONE_REACHED"),
          sql`${dealEvents.payload}->>'key' = ${key}`,
        ),
      );
    if (seen) return { created: false };
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "MILESTONE_REACHED",
      actor: actorOf(user),
      rulesVersion: d.rulesVersion,
      payload: { key, seq, milestone: row.milestone },
    });
    const t = await openTask(ctx, tx, {
      dealId,
      kind: "milestone_reached",
      role: "sales_officer",
      title: `Milestone reached: ${row.label}. Ask the buyer for the instalment`,
      detail: { seq },
      dedupeKey: key,
    });
    return { created: t.created };
  });
}
