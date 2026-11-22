import type { SpaActor } from "@spa/core";
import { bpsOfFloor } from "@spa/rulebook";
import { deals, deposits, signatures, signingEnvelopes, spaApprovals, withSpaTx } from "@spa/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { SIGNING_FINISH_JOB } from "../jobs.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { policyAt } from "./policy.ts";

const Cheque = z.object({
  chequeNo: z
    .string()
    .trim()
    .regex(/^\d{4,20}$/, "digits only"),
  bank: z.string().trim().min(1).max(120),
  chequeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  holder: z.string().trim().min(1).max(200),
});
/** States in which the deposit may still be recorded: before signing is complete (S18); never during an AML hold (S40 amendment: no tipping-off, no money moves). */
const RECORDABLE = new Set(["OFFER_AGREED", "PARTY_CHECK", "AGREEMENT_DRAFT", "LEGAL_REVIEW", "SIGNING"]);
/** After the transfer was issued (S18: the cheque goes to the seller only then). */
const TRANSFERRED = new Set(["COMPLETED", "INSTALMENTS", "HANDED_OVER"]);

/**
 * Records a resale's deposit cheque (S18, S40). The amount is the pinned policy's deposit % of the price, by code. When
 * the deal waits in `SIGNING` with every signature signed (the finish job was blocked by the missing deposit, S54), the
 * finish job is queued again so the deal isn't stuck (S55); a queue that is down never undoes the deposit.
 */
export async function recordDeposit(
  ctx: SpaContext,
  dealId: string,
  input: unknown,
  actor: SpaActor,
  opts: { boss?: Pick<PgBoss, "send"> } = {},
): Promise<{ amountFils: number }> {
  const parsed = Cheque.safeParse(input);
  if (!parsed.success) throw unprocessable("invalid_cheque", "the cheque details aren't valid");
  const c = parsed.data;
  const recorded = await withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (d.dealType === "primary_offplan") throw unprocessable("not_resale", "only a resale has a security deposit");
    const [existing] = await tx.db.select().from(deposits).where(eq(deposits.dealId, dealId));
    if (existing) throw conflict("deposit_exists", "the deposit is already recorded");
    if (!RECORDABLE.has(d.state)) throw conflict("too_late", `the deposit can't be recorded in ${d.state}`);
    const policy = await policyAt(tx.db, d.policyVersion);
    const amountFils = bpsOfFloor(d.priceFils, policy.depositBps);
    if (amountFils <= 0) throw unprocessable("no_deposit", "the policy sets no deposit");
    await tx.db.insert(deposits).values({
      dealId,
      amountFils,
      chequeLast4: c.chequeNo.slice(-4),
      bank: c.bank,
      chequeOn: c.chequeOn,
      holder: c.holder,
      recordedAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "DEPOSIT_RECORDED",
      actor,
      rulesVersion: d.rulesVersion,
      payload: { amountFils, policyVersion: d.policyVersion, bank: c.bank, chequeOn: c.chequeOn },
    });
    // Every signature signed and the deal still in SIGNING: only the deposit was missing.
    let finish: string | null = null;
    if (d.state === "SIGNING") {
      const [env] = await tx.db
        .select({ id: signingEnvelopes.id })
        .from(signingEnvelopes)
        .where(and(eq(signingEnvelopes.dealId, dealId), ne(signingEnvelopes.status, "superseded")));
      if (env) {
        const open = await tx.db
          .select({ id: signatures.id })
          .from(signatures)
          .where(and(eq(signatures.envelopeId, env.id), isNull(signatures.signedAt)))
          .limit(1);
        if (!open.length) finish = env.id;
      }
    }
    return { amountFils, finish };
  });
  if (recorded.finish && opts.boss)
    await opts.boss
      .send(
        SIGNING_FINISH_JOB,
        { envelopeId: recorded.finish },
        { singletonKey: `${recorded.finish}:finish`, retryLimit: 5 },
      )
      .catch((err: unknown) => console.warn(`could not queue the signing finish: ${(err as Error).message}`));
  return { amountFils: recorded.amountFils };
}

/** After the transfer was issued, the brokerage hands the cheque to the seller (S18). */
export async function handDepositToSeller(ctx: SpaContext, dealId: string, actor: SpaActor): Promise<void> {
  await withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (!TRANSFERRED.has(d.state))
      throw conflict("not_transferred", "the cheque goes to the seller only after the transfer");
    const [dep] = await tx.db.select().from(deposits).where(eq(deposits.dealId, dealId)).for("update");
    if (dep?.status !== "held") throw conflict("deposit_not_held", "no deposit cheque is held");
    await tx.db
      .update(deposits)
      .set({ status: "handed_to_seller", closedAt: ctx.clock.now() })
      .where(eq(deposits.dealId, dealId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "DEPOSIT_HANDED_TO_SELLER",
      actor,
      rulesVersion: d.rulesVersion,
    });
  });
}

/** On a cancelled resale, staff propose who gets the cheque (per the MOU); the sales manager decides (S18). */
export async function proposeDepositRelease(
  ctx: SpaContext,
  dealId: string,
  releaseTo: "buyer" | "seller",
  actor: SpaActor,
): Promise<{ id: string }> {
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  if (d.state !== "CANCELLED") throw conflict("not_cancelled", "a deposit is released only on a cancelled deal");
  const [dep] = await ctx.database.db.select().from(deposits).where(eq(deposits.dealId, dealId));
  if (dep?.status !== "held") throw conflict("deposit_not_held", "no deposit cheque is held");
  const [pending] = await ctx.database.db
    .select({ id: spaApprovals.id })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.gate, "deposit_release"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, dealId),
        inArray(spaApprovals.status, ["approved", "edited"]),
        isNull(spaApprovals.consumedByEventId),
      ),
    );
  if (pending) throw conflict("release_approved", "an approved release for this deposit is waiting to be applied");
  const p = await proposeApproval(ctx, {
    gate: "deposit_release",
    entity: { kind: "deal", id: dealId },
    dedupeKey: `${dealId}:deposit_release`,
    title: `Release the deposit cheque to the ${releaseTo}`,
    proposal: { releaseTo, amountFils: dep.amountFils },
    proposedBy: actor,
  });
  return { id: p.id };
}

/** Applies an approved, unused `deposit_release` for this deal. */
export async function releaseDeposit(
  ctx: SpaContext,
  dealId: string,
  approvalId: string,
  actor: SpaActor,
): Promise<void> {
  await withSpaTx(ctx.database, async (tx) => {
    const [dep] = await tx.db.select().from(deposits).where(eq(deposits.dealId, dealId)).for("update");
    if (dep?.status !== "held") throw conflict("deposit_not_held", "no deposit cheque is held");
    const [a] = await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, approvalId)).for("update");
    const usable =
      a &&
      a.gate === "deposit_release" &&
      a.entityKind === "deal" &&
      a.entityId === dealId &&
      (a.status === "approved" || a.status === "edited") &&
      !a.consumedByEventId;
    if (!usable) throw conflict("gate_required", "an approved deposit_release for this deal is required");
    const releaseTo = ((a.editedProposal ?? a.proposal) as { releaseTo?: string }).releaseTo;
    if (releaseTo !== "buyer" && releaseTo !== "seller")
      throw unprocessable("invalid_release", "say who gets the cheque");
    const [d] = await tx.db
      .select({ v: deals.rulesVersion, state: deals.state })
      .from(deals)
      .where(eq(deals.id, dealId));
    if (d?.state !== "CANCELLED") throw conflict("not_cancelled", "a deposit is released only on a cancelled deal");
    await tx.db
      .update(deposits)
      .set({ status: releaseTo === "buyer" ? "returned_to_buyer" : "handed_to_seller", closedAt: ctx.clock.now() })
      .where(eq(deposits.dealId, dealId));
    const eventId = await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "DEPOSIT_RELEASED",
      actor,
      rulesVersion: d?.v ?? null,
      payload: { releaseTo, approvalId },
    });
    await tx.db.update(spaApprovals).set({ consumedByEventId: eventId }).where(eq(spaApprovals.id, approvalId));
  });
}
