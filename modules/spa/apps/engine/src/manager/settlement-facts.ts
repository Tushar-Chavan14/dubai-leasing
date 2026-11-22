import { createHash } from "node:crypto";
import type { SettlementInput } from "@spa/rulebook";
import { bankLetters, type deals, deposits, settlementLines, settlements, type SpaTx } from "@spa/db";
import { and, eq, like, sql } from "drizzle-orm";
import { brokerCommissions } from "./brokers.ts";

type DealRow = typeof deals.$inferSelect;

/** What a statement is built from, read by code from the records (S48). */
export interface Gathered {
  input: SettlementInput;
  /** The letter rows the amounts came from: a re-confirmed amount is a new row, so it changes the hash. */
  refs: { payoffLetterId: string | null; loanLetterId: string | null };
  /** The broker side of each commission, in order. */
  commissionSides: ("seller" | "buyer")[];
  policyVersion: number;
  /** Inputs that don't exist at all (a mortgage with no letter). An unconfirmed amount is not here: the rulebook refuses it. */
  missing: string[];
}

/**
 * The statement's inputs (S48), all by code. Price from the deal; the deposit while the cheque is held; the seller's
 * payoff and the buyer's loan from the current letter, `confirmed` only when a person confirmed the amount; commissions
 * by `bpsOfFloor` on the price (the policy % or an approved override), the payer from the broker row.
 */
export async function gatherSettlementInputs(tx: SpaTx, d: DealRow): Promise<Gathered> {
  const [dep] = await tx.db.select().from(deposits).where(eq(deposits.dealId, d.id));
  const letters = await tx.db
    .select()
    .from(bankLetters)
    .where(and(eq(bankLetters.dealId, d.id), eq(bankLetters.status, "current")));
  const missing: string[] = [];
  const pick = (kind: string, wanted: boolean, who: string) => {
    if (!wanted) return { amount: null, id: null };
    const l = letters.find((x) => x.kind === kind);
    if (!l) {
      missing.push(`The ${who} has no ${kind.replace("_", " ")} on file.`);
      return { amount: null, id: null };
    }
    const confirmed = l.amountFils !== null && l.confirmedBy !== null && l.confirmedAt !== null;
    // An unconfirmed amount is passed as such (the typed or read value, never used): the rulebook refuses it.
    return { amount: { amountFils: l.amountFils ?? l.amountReadFils ?? 0, confirmed }, id: l.id };
  };
  const payoff = pick("liability_letter", d.sellerMortgage, "seller's mortgage");
  const loan = pick("final_offer", d.buyerMortgage, "buyer's mortgage");
  const commissions = await brokerCommissions(tx.db, d.id);
  return {
    input: {
      dealType: d.dealType as "resale_ready" | "resale_offplan",
      priceFils: d.priceFils,
      depositHeldFils: dep?.status === "held" ? dep.amountFils : 0,
      buyerLoan: loan.amount,
      sellerPayoff: payoff.amount,
      commissions: commissions.map((c) => ({
        payer: c.payer,
        payee: c.payee,
        label: c.label,
        amountFils: c.amountFils,
        source: c.source,
      })),
    },
    refs: { payoffLetterId: payoff.id, loanLetterId: loan.id },
    commissionSides: commissions.map((c) => c.side),
    policyVersion: d.policyVersion,
    missing,
  };
}

/** JSON with sorted keys, so the same inputs always hash the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** sha256 of the canonical inputs, the rulebook and policy versions and the letter row ids (S48). */
export function settlementInputHash(d: DealRow, g: Gathered): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        dealId: d.id,
        rulesVersion: d.rulesVersion,
        policyVersion: g.policyVersion,
        input: g.input,
        refs: g.refs,
        commissionSides: g.commissionSides,
      }),
    )
    .digest("hex");
}

/** The statement being worked on: the deal's one proposed or approved version. */
export async function liveSettlement(tx: SpaTx, dealId: string) {
  const [s] = await tx.db
    .select()
    .from(settlements)
    .where(and(eq(settlements.dealId, dealId), sql`${settlements.status} in ('proposed', 'approved')`));
  return s ?? null;
}

/** Do the statement's price lines add up exactly to its price, and is that the deal's price? */
export async function priceLinesBalance(tx: SpaTx, s: typeof settlements.$inferSelect, dealPrice: number) {
  const [{ sum } = { sum: "0" }] = await tx.db
    .select({ sum: sql<string>`coalesce(sum(${settlementLines.amountFils}), 0)::text` })
    .from(settlementLines)
    .where(and(eq(settlementLines.settlementId, s.id), like(settlementLines.code, "price:%")));
  return s.priceFils === dealPrice && BigInt(sum) === BigInt(s.priceFils);
}

/**
 * The `statementBalanced` fact (S48), fail-closed. True only when the deal's live statement is approved, its inputs
 * hash the same today (nothing changed since: no re-confirmed letter, no broker change), and its price lines add up to
 * the deal's price. No statement, a stale one or one still waiting for finance is false, never "balanced".
 */
export async function statementBalancedFact(tx: SpaTx, d: DealRow): Promise<boolean> {
  if (d.dealType === "primary_offplan") return false;
  const s = await liveSettlement(tx, d.id);
  if (s?.status !== "approved") return false;
  const g = await gatherSettlementInputs(tx, d);
  if (g.missing.length || s.inputHash !== settlementInputHash(d, g)) return false;
  return priceLinesBalance(tx, s, d.priceFils);
}
