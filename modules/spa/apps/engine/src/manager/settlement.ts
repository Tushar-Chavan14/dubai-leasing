import { newId } from "@platform/kernel/ids";
import type { SpaActor, SpaRole } from "@spa/core";
import { getSalesRulebook, type SalesRulebook, settlementStatement, type StatementLine } from "@spa/rulebook";
import { deals, settlementLines, settlements, spaApprovals, type SpaTx, withSpaTx } from "@spa/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { advance } from "./advance.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, SpaDomainError, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import {
  type Gathered,
  gatherSettlementInputs,
  liveSettlement,
  priceLinesBalance,
  settlementInputHash,
} from "./settlement-facts.ts";

type Person = { id: string; role: SpaRole };
type DealRow = typeof deals.$inferSelect;
const SYSTEM: SpaActor = "system:settlement";
/** Who may read the statement (S48). */
const READ_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "legal", "finance"];
/** Who may ask for the statement to be rebuilt (it is also rebuilt by every change to its inputs). */
const REFRESH_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "finance", "admin"];
/** After the transfer step the statement is fixed: its inputs can't change any more. */
export const STATEMENT_FIXED_STATES: ReadonlySet<string> = new Set([
  "TRANSFER",
  "INSTALMENTS",
  "COMPLETED",
  "HANDED_OVER",
]);

const rulebookFor = (ctx: SpaContext, version: string): SalesRulebook | null =>
  (ctx.rulebook ?? getSalesRulebook)(version);

export type BuildResult =
  | { ok: true; id: string; version: number; created: boolean }
  | { ok: false; reasons: string[] };

/** A line's source record: a letter, the deposit, the deal, a broker or the rulebook (S48). */
function sourceRef(
  l: StatementLine,
  g: Gathered,
  dealId: string,
  rulesVersion: string,
  nextSide: () => string,
): string {
  if (l.code === "commission") return `broker:${nextSide()}`;
  if (l.code.startsWith("fee:")) return `rulebook:${rulesVersion}`;
  if (l.code === "price:deposit") return `deposit:${dealId}`;
  if (l.payer === "bank_buyer") return g.refs.loanLetterId ? `bank_letter:${g.refs.loanLetterId}` : `deal:${dealId}`;
  if (l.code === "price:seller_payoff")
    return g.refs.payoffLetterId ? `bank_letter:${g.refs.payoffLetterId}` : `deal:${dealId}`;
  return `deal:${dealId}`;
}

/** What the statement would be today, and why it can't be built, without storing anything. */
async function evaluate(ctx: SpaContext, tx: SpaTx, d: DealRow) {
  const rb = rulebookFor(ctx, d.rulesVersion);
  const g = await gatherSettlementInputs(tx, d);
  if (!rb) return { ok: false as const, g, reasons: [`The rulebook ${d.rulesVersion} isn't available.`] };
  const r = settlementStatement(g.input, rb);
  const reasons = [...g.missing, ...(r.ok ? [] : r.reasons)];
  if (!r.ok || reasons.length) return { ok: false as const, g, reasons: reasons.length ? reasons : ["Not buildable."] };
  return { ok: true as const, g, rb, statement: r, hash: settlementInputHash(d, g) };
}

/** Pending `settlement_approval` of these statements are cancelled (nobody should approve what no longer holds). */
async function cancelPending(tx: SpaTx, dealId: string, approvalIds: (string | null)[]): Promise<void> {
  const ids = approvalIds.filter((x): x is string => !!x);
  if (!ids.length) return;
  await tx.db
    .update(spaApprovals)
    .set({ status: "cancelled" })
    .where(
      and(
        inArray(spaApprovals.id, ids),
        eq(spaApprovals.entityId, dealId),
        eq(spaApprovals.gate, "settlement_approval"),
        eq(spaApprovals.status, "pending"),
      ),
    );
}

/**
 * Builds the next version of a resale's statement (S48) and opens `settlement_approval` for finance. Everything is by
 * code from confirmed amounts; a missing or unconfirmed input or a pending rulebook value returns the reasons and
 * stores nothing. The deal must be in `SETTLEMENT`. Safe to run twice: an unchanged live statement is returned as is.
 */
export async function buildSettlement(
  ctx: SpaContext,
  dealId: string,
  actor: SpaActor,
  tx: SpaTx,
): Promise<BuildResult> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d) throw notFound("deal");
  if (d.dealType === "primary_offplan") throw unprocessable("not_resale", "only a resale has a settlement statement");
  if (d.state !== "SETTLEMENT")
    throw conflict("not_in_settlement", `a statement is built in SETTLEMENT, not ${d.state}`);
  const live = await liveSettlement(tx, dealId);
  const e = await evaluate(ctx, tx, d);
  if (!e.ok) return { ok: false, reasons: e.reasons };
  if (live) {
    if (live.inputHash === e.hash) return { ok: true, id: live.id, version: live.version, created: false };
    throw conflict("statement_live", "a statement is already waiting; refresh it instead");
  }
  const [{ max } = { max: 0 }] = await tx.db
    .select({ max: sql<number>`coalesce(max(${settlements.version}), 0)::int` })
    .from(settlements)
    .where(eq(settlements.dealId, dealId));
  const id = newId();
  const version = max + 1;
  const { statement: st, g, hash } = e;
  await tx.db.insert(settlements).values({
    id,
    dealId,
    version,
    status: "proposed",
    rulesVersion: d.rulesVersion,
    policyVersion: d.policyVersion,
    input: { ...g.input, refs: g.refs, commissionSides: g.commissionSides },
    inputHash: hash,
    priceFils: d.priceFils,
    buyerPaysFils: st.buyerPaysFils,
    sellerReceivesFils: st.sellerReceivesFils,
    createdBy: actor,
    createdAt: ctx.clock.now(),
  });
  const sides = g.commissionSides.filter((_, i) => (g.input.commissions[i]?.amountFils ?? 0) > 0);
  const nextSide = () => sides.shift() ?? "unknown";
  await tx.db.insert(settlementLines).values(
    st.lines.map((l, i) => ({
      settlementId: id,
      seq: i + 1,
      code: l.code,
      payer: l.payer,
      payee: l.payee,
      label: l.label,
      amountFils: l.amountFils,
      source: l.source,
      sourceRef: sourceRef(l, g, dealId, d.rulesVersion, nextSide),
    })),
  );
  const approval = await proposeApproval(
    ctx,
    {
      gate: "settlement_approval",
      entity: { kind: "deal", id: dealId },
      dedupeKey: `${id}:settlement_approval`,
      title: `Settlement statement v${version}`,
      proposal: {
        settlementId: id,
        version,
        inputHash: hash,
        priceFils: d.priceFils,
        buyerPaysFils: st.buyerPaysFils,
        sellerReceivesFils: st.sellerReceivesFils,
      },
      proposedBy: SYSTEM,
    },
    tx,
  );
  await tx.db.update(settlements).set({ approvalId: approval.id }).where(eq(settlements.id, id));
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: dealId },
    type: "SETTLEMENT_PROPOSED",
    actor,
    rulesVersion: d.rulesVersion,
    payload: { settlementId: id, version, inputHash: hash, approvalId: approval.id, lines: st.lines.length },
  });
  return { ok: true, id, version, created: true };
}

/**
 * Rebuilds the statement after an input changed (S48): a live statement whose inputs no longer hash the same becomes
 * `stale` (an approval of it no longer counts; a pending one is cancelled) and a new version is built. Without a live
 * statement (never built, or finance rejected it) it just builds. Outside `SETTLEMENT` there is nothing to refresh.
 */
export async function refreshSettlement(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  actor: SpaActor = SYSTEM,
): Promise<BuildResult | null> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d || d.dealType === "primary_offplan" || d.state !== "SETTLEMENT") return null;
  const live = await liveSettlement(tx, dealId);
  if (live) {
    const e = await evaluate(ctx, tx, d);
    if (e.ok && live.inputHash === e.hash) return { ok: true, id: live.id, version: live.version, created: false };
    await tx.db
      .update(settlements)
      .set({ status: "stale", decidedAt: ctx.clock.now() })
      .where(eq(settlements.id, live.id));
    await cancelPending(tx, dealId, [live.approvalId]);
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "SETTLEMENT_STALE",
      actor,
      rulesVersion: d.rulesVersion,
      payload: { settlementId: live.id, version: live.version, wasStatus: live.status },
    });
  }
  return buildSettlement(ctx, dealId, actor, tx);
}

/** A person asks for the statement to be rebuilt (e.g. after finance rejected it). A no-op when nothing changed. */
export async function requestSettlementRefresh(ctx: SpaContext, dealId: string, user: Person): Promise<BuildResult> {
  if (!REFRESH_ROLES.includes(user.role)) throw forbidden(`only ${REFRESH_ROLES.join(", ")} can rebuild the statement`);
  return withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId));
    if (!d) throw notFound("deal");
    if (d.dealType === "primary_offplan") throw unprocessable("not_resale", "only a resale has a settlement statement");
    if (d.state !== "SETTLEMENT")
      throw conflict("not_in_settlement", `a statement is built in SETTLEMENT, not ${d.state}`);
    return (await refreshSettlement(ctx, tx, dealId, `user:${user.id}`))!;
  });
}

/**
 * Finance's decision on a statement (S48), called inside `decideApproval`'s transaction before the approval row is
 * written. Approving needs the statement still proposed, its inputs hashing the same today and its price lines adding
 * up: otherwise 422 `settlement_stale` or `settlement_unbalanced`. Editing is refused (the numbers are code's).
 * Rejecting retires the statement; a refresh builds the next one.
 */
export async function checkSettlementDecision(
  tx: SpaTx,
  approval: { id: string; entityId: string },
  decision: "approve" | "reject" | "edit",
): Promise<void> {
  if (decision === "edit")
    throw unprocessable("edit_not_allowed", "a settlement statement is approved or rejected, not edited");
  if (decision === "reject") return;
  const [s] = await tx.db.select().from(settlements).where(eq(settlements.approvalId, approval.id));
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, approval.entityId)).for("update");
  if (!s || !d || s.status !== "proposed" || d.state !== "SETTLEMENT")
    throw unprocessable("settlement_stale", "this statement is no longer the current one; ask for a new one");
  const g = await gatherSettlementInputs(tx, d);
  if (g.missing.length || s.inputHash !== settlementInputHash(d, g))
    throw unprocessable("settlement_stale", "an input changed since this statement was built; ask for a new one");
  if (!(await priceLinesBalance(tx, s, d.priceFils)))
    throw unprocessable("settlement_unbalanced", "the price lines don't add up to the price");
}

/** After the approval row is written: the statement follows the decision. Returns whether it was approved. */
export async function applySettlementDecision(
  tx: SpaTx,
  ctx: SpaContext,
  approval: { id: string; entityId: string },
  decision: "approve" | "reject",
): Promise<void> {
  await tx.db
    .update(settlements)
    .set({ status: decision === "approve" ? "approved" : "superseded", decidedAt: ctx.clock.now() })
    .where(and(eq(settlements.approvalId, approval.id), eq(settlements.status, "proposed")));
}

/**
 * Moves a deal on to `TRANSFER` when finance approved a fresh statement (S48): the approval is consumed by the step.
 * A refusal by the guards (e.g. the NOC expired, S48) leaves the approval standing; the next check retries.
 */
export async function advanceSettled(ctx: SpaContext, tx: SpaTx, dealId: string): Promise<boolean> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d || d.state !== "SETTLEMENT") return false;
  const live = await liveSettlement(tx, dealId);
  if (live?.status !== "approved" || !live.approvalId) return false;
  const [a] = await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, live.approvalId));
  if (a?.status !== "approved" || a.consumedByEventId) return false;
  try {
    await advance(ctx, { kind: "deal", id: dealId }, "SETTLED", {
      actor: SYSTEM,
      approvalId: a.id,
      payload: { settlementId: live.id, version: live.version },
      tx,
    });
    return true;
  } catch (e) {
    // The guards and the gate check before any write, so the transaction is intact; anything else is a real error.
    if (e instanceof SpaDomainError && (e.code === "guard_failed" || e.code === "gate_required")) return false;
    throw e;
  }
}

/** A cancelled deal's live statement is superseded and its pending approval cancelled (S48; the deposit is S40's). */
export async function supersedeOnCancel(ctx: SpaContext, tx: SpaTx, dealId: string, actor: SpaActor): Promise<void> {
  const live = await liveSettlement(tx, dealId);
  if (!live) return;
  await tx.db
    .update(settlements)
    .set({ status: "superseded", decidedAt: ctx.clock.now() })
    .where(eq(settlements.id, live.id));
  await cancelPending(tx, dealId, [live.approvalId]);
  const [d] = await tx.db.select({ v: deals.rulesVersion }).from(deals).where(eq(deals.id, dealId));
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: dealId },
    type: "SETTLEMENT_SUPERSEDED",
    actor,
    rulesVersion: d?.v ?? null,
    payload: { settlementId: live.id, version: live.version, reason: "deal cancelled" },
  });
}

/** The statement a resale shows (S48): lines with their sources, its status, and why none can be built, if so. */
export async function getSettlement(ctx: SpaContext, dealId: string, user: Person) {
  if (!READ_ROLES.includes(user.role)) throw forbidden("your role can't read the settlement statement");
  const db = ctx.database.db;
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  if (d.dealType === "primary_offplan") throw unprocessable("not_resale", "only a resale has a settlement statement");
  return settlementView(ctx, d);
}

/** The statement with no role check: the caller (a route or a record section) has made it, and the deal is a resale. */
export async function settlementView(ctx: SpaContext, d: typeof deals.$inferSelect) {
  const db = ctx.database.db;
  const dealId = d.id;
  const [s] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.dealId, dealId))
    .orderBy(desc(settlements.version))
    .limit(1);
  const lines = s
    ? await db
        .select()
        .from(settlementLines)
        .where(eq(settlementLines.settlementId, s.id))
        .orderBy(asc(settlementLines.seq))
    : [];
  const history = await db
    .select({ id: settlements.id, version: settlements.version, status: settlements.status })
    .from(settlements)
    .where(eq(settlements.dealId, dealId))
    .orderBy(asc(settlements.version));
  // Why no statement can be built right now (only while there is no live one): a person sees what to fix.
  let reasons: string[] = [];
  if (d.state === "SETTLEMENT" && (!s || (s.status !== "proposed" && s.status !== "approved")))
    reasons = await withSpaTx(ctx.database, async (tx) => {
      const e = await evaluate(ctx, tx, d);
      return e.ok ? [] : e.reasons;
    });
  return {
    deal: { id: d.id, ref: d.ref, state: d.state, priceFils: d.priceFils },
    statement: s
      ? {
          id: s.id,
          version: s.version,
          status: s.status,
          rulesVersion: s.rulesVersion,
          policyVersion: s.policyVersion,
          inputHash: s.inputHash,
          priceFils: s.priceFils,
          buyerPaysFils: s.buyerPaysFils,
          sellerReceivesFils: s.sellerReceivesFils,
          approvalId: s.approvalId,
          createdAt: s.createdAt.toISOString(),
          decidedAt: s.decidedAt?.toISOString() ?? null,
          lines: lines.map((l) => ({
            seq: l.seq,
            code: l.code,
            payer: l.payer,
            payee: l.payee,
            label: l.label,
            amountFils: l.amountFils,
            source: l.source,
            sourceRef: l.sourceRef,
          })),
        }
      : null,
    history,
    reasons,
  };
}
