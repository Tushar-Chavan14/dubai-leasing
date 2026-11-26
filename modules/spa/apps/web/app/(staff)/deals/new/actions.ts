"use server";

import { DealQuote } from "../../../../lib/contracts";
import { engineGet, engineSend } from "../../../../lib/engine";

/**
 * The New deal form's calls (M6, S81): the quote the form shows, and the one call that starts the deal and then types its
 * payment plan. The engine checks the role, every value and every limit; these are conveniences, never the rule.
 */
export interface StartDealResult {
  ok?: boolean;
  id?: string;
  ref?: string;
  /** Gates the engine opened ("price_out_of_range"), with its sentences saying why. */
  gates?: string[];
  reasons?: string[];
  /** The deal exists but its payment plan was refused: the sentences, so it can be set on the deal. */
  planError?: string[];
  error?: string;
  /** Another deal already open on this home. */
  existing?: { id: string; ref: string };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORDS: Record<string, string> = {
  forbidden: "Only a sales role starts a deal.",
  not_found: "That home is no longer there.",
  no_price: "This home has no price-list price. Enter the agreed price.",
  transition_not_allowed: "This home is no longer available.",
  lead_mismatch: "That enquiry is about another home.",
  lead_finished: "That enquiry is already closed or has a deal.",
  developer_party_missing: "The developer's company details aren't on file yet. Add the developer as a company first.",
  no_rulebook: "No sales rules are in force today.",
};

/** The engine's figures for one home at one price and booking (fils). Null when they can't be read. */
export async function quoteAction(unitId: string, priceFils?: number, bookingFils?: number): Promise<DealQuote | null> {
  if (!uuid.test(unitId)) return null;
  const qs = new URLSearchParams({ unitId });
  if (priceFils) qs.set("priceFils", String(priceFils));
  if (bookingFils) qs.set("bookingFils", String(bookingFils));
  return engineGet(`/api/deals/quote?${qs}`, DealQuote).catch(() => null);
}

interface PlanRow {
  label: string;
  shareBps: number;
  dueOn?: string;
  milestone?: string;
}

/** Starts the deal, then types its payment plan. A refused plan never undoes the deal: it is reported to be fixed on it. */
export async function startDealAction(payload: Record<string, unknown>, plan: PlanRow[]): Promise<StartDealResult> {
  const res = await engineSend("/api/deals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as {
    id?: string;
    ref?: string;
    gates?: string[];
    reasons?: string[];
    code?: string;
    error?: string;
  } | null;
  if (res.status !== 201 || !body?.id) {
    if (res.status === 422 && body?.reasons?.length)
      return { error: "Some fields need attention.", reasons: body.reasons };
    if (body?.code === "open_deal_exists" && body.reasons?.length === 2)
      return {
        error: `Deal ${body.reasons[1]} is already open on this home.`,
        existing: { id: body.reasons[0]!, ref: body.reasons[1]! },
      };
    return { error: WORDS[body?.code ?? ""] ?? "The deal wasn't started. Try again." };
  }
  let planError: string[] | undefined;
  if (plan.length) {
    const p = await engineSend(`/api/deals/${body.id}/payment-plan`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instalments: plan }),
    });
    if (p.status !== 200) {
      const out = (await p.json().catch(() => null)) as { reasons?: string[] } | null;
      planError = out?.reasons?.length ? out.reasons : ["The payment plan wasn't saved. Set it on the deal."];
    }
  }
  // No revalidatePath here: it would re-render this page, where the home is now held, and replace the result panel.
  return {
    ok: true,
    id: body.id,
    ...(body.ref ? { ref: body.ref } : {}),
    gates: body.gates ?? [],
    reasons: body.reasons ?? [],
    ...(planError ? { planError } : {}),
  };
}
