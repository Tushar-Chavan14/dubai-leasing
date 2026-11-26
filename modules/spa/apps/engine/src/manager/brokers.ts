import { dealMachine, type SpaActor } from "@spa/core";
import { bpsOfFloor } from "@spa/rulebook";
import { dealBrokers, deals, parties, type SpaDb, spaApprovals, type SpaTx, withSpaTx } from "@spa/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { proposeApproval } from "./approvals.ts";
import { overrideApproved } from "./commission.ts";
import { policyAt } from "./policy.ts";
import { refreshSettlement, STATEMENT_FIXED_STATES } from "./settlement.ts";

const Broker = z.object({
  side: z.enum(["seller", "buyer"]),
  agencyPartyId: z.uuid(),
  agentName: z.string().trim().min(1).max(200),
  orn: z.string().trim().min(1).max(40),
  brn: z.string().trim().min(1).max(40),
  /** Overrides the pinned policy's side commission. */
  commissionBps: z.number().int().min(0).max(10_000).optional(),
});

/** One broker per side (S18, confirm). The commission defaults to the deal's pinned policy; the side pays it. */
export async function setBroker(
  ctx: SpaContext,
  dealId: string,
  input: unknown,
  actor: SpaActor,
  /** Internal: starting a deal sets its broker inside the same transaction (M6). */
  opts: { tx?: SpaTx } = {},
): Promise<void> {
  const parsed = Broker.safeParse(input);
  if (!parsed.success) throw unprocessable("invalid_broker", "the broker details aren't valid");
  const b = parsed.data;
  const run = async (tx: SpaTx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if ((dealMachine.terminal as readonly string[]).includes(d.state))
      throw conflict("deal_closed", `a broker can't be set on a ${d.state} deal`);
    // The settlement statement is fixed from the transfer step on (S48).
    if (STATEMENT_FIXED_STATES.has(d.state))
      throw conflict("statement_fixed", `a broker can't be set once the deal is in ${d.state}`);
    const [agency] = await tx.db.select({ kind: parties.kind }).from(parties).where(eq(parties.id, b.agencyPartyId));
    if (agency?.kind !== "company") throw unprocessable("agency_not_company", "the agency is a company party");
    const [existing] = await tx.db
      .select()
      .from(dealBrokers)
      .where(and(eq(dealBrokers.dealId, dealId), eq(dealBrokers.side, b.side)));
    if (existing) throw conflict("broker_exists", `the ${b.side}'s broker is already set`);
    const policy = await policyAt(tx.db, d.policyVersion);
    const policyBps = b.side === "seller" ? policy.commission.sellerSideBps : policy.commission.buyerSideBps;
    const commissionBps = b.commissionBps ?? policyBps;
    // A % other than the policy's waits for the sales manager (S40 amendment); until approved, the policy % applies.
    const needsApproval = commissionBps !== policyBps;
    const approval = needsApproval
      ? await proposeApproval(
          ctx,
          {
            gate: "price_out_of_range",
            entity: { kind: "deal", id: dealId },
            dedupeKey: `${dealId}:broker_commission:${b.side}`,
            title: `${b.side === "seller" ? "Seller" : "Buyer"}'s broker commission ${commissionBps} bps (policy ${policyBps})`,
            proposal: { side: b.side, commissionBps, policyBps },
            proposedBy: actor,
          },
          tx,
        )
      : null;
    await tx.db.insert(dealBrokers).values({
      dealId,
      ...b,
      commissionBps,
      payer: b.side,
      commissionApprovalId: approval?.id ?? null,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "BROKER_SET",
      actor,
      rulesVersion: d.rulesVersion,
      payload: {
        side: b.side,
        commissionBps,
        policyBps,
        pendingApproval: needsApproval,
        policyVersion: d.policyVersion,
      },
    });
    // S48: a new commission line changes the statement, so a live one goes stale and is rebuilt.
    await refreshSettlement(ctx, tx, dealId, actor);
  };
  await (opts.tx ? run(opts.tx) : withSpaTx(ctx.database, run));
}

/** Commission lines for the settlement statement (C16): amount by code from the price and the broker's %. */
export async function brokerCommissions(db: SpaDb, dealId: string) {
  const [d] = await db
    .select({ price: deals.priceFils, policyVersion: deals.policyVersion })
    .from(deals)
    .where(eq(deals.id, dealId));
  if (!d) return [];
  const policy = await policyAt(db, d.policyVersion);
  const rows = await db
    .select({
      broker: dealBrokers,
      approval: {
        status: spaApprovals.status,
        gate: spaApprovals.gate,
        entityId: spaApprovals.entityId,
        proposal: spaApprovals.proposal,
      },
    })
    .from(dealBrokers)
    .leftJoin(spaApprovals, eq(spaApprovals.id, dealBrokers.commissionApprovalId))
    .where(eq(dealBrokers.dealId, dealId));
  return rows
    .map(({ broker, approval }) => {
      const policyBps = broker.side === "seller" ? policy.commission.sellerSideBps : policy.commission.buyerSideBps;
      // Only the policy %, or an override whose approval was approved, is ever used (S40 amendment).
      const ok = broker.commissionBps === policyBps || overrideApproved(approval, { id: dealId }, broker);
      return { ...broker, commissionBps: ok ? broker.commissionBps : policyBps };
    })
    .toSorted((a, b) => (a.side === b.side ? 0 : a.side === "seller" ? -1 : 1))
    .map((r) => ({
      side: r.side,
      payer: r.payer,
      payee: "broker" as const,
      label: `${r.side === "seller" ? "Seller's" : "Buyer's"} agent commission`,
      amountFils: bpsOfFloor(d.price, r.commissionBps),
      source: `deal broker (${r.commissionBps} bps, policy v${d.policyVersion})`,
    }));
}
