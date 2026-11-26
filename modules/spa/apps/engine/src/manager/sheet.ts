import { createHash } from "node:crypto";
import { dealMachine, PaymentPlan, type SpaPolicy, type SpaRole, hasAnyRole } from "@spa/core";
import {
  agreements,
  bankLetters,
  companyDetails,
  dealBrokers,
  dealParties,
  deals,
  listings,
  parties,
  paymentPlanRows,
  signatories,
  type SpaTx,
  spaApprovals,
  units,
  withSpaTx,
} from "@spa/db";
import { moneyInWords, type PlanRow, sortPlan, type SpaValues } from "@spa/helpers";
import { bpsOfFloor, getSalesRulebook, registrationFee, type SalesRulebook, validatePlan } from "@spa/rulebook";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { overrideApproved } from "./commission.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DealRow } from "./facts.ts";
import { policyAt } from "./policy.ts";
import { canonicalJson } from "./settlement-facts.ts";

/** Who types the payment plan (S51): the people who enter the other deal records (S47). */
const PLAN_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];

export const rulebookFor = (ctx: SpaContext, version: string): SalesRulebook | null =>
  (ctx.rulebook ?? getSalesRulebook)(version);

interface PartyRec {
  partyId: string;
  order: number;
  shareBps: number | null;
  kind: "person" | "company";
  name: string;
  nationality: string | null;
  passportNo: string | null;
  emiratesIdNo: string | null;
  email: string;
  phone: string | null;
  licenceNo: string | null;
  signatory: { partyId: string; name: string; title: string } | null;
}
interface BrokerRec {
  side: "seller" | "buyer";
  agencyPartyId: string;
  agencyName: string;
  agentName: string;
  orn: string;
  brn: string;
  commissionBps: number;
  /** The linked approval is an approved `price_out_of_range` of this deal, this side and this % (review 13). */
  overrideApproved: boolean;
}

/**
 * The records an agreement is printed from, exactly as stored (S51). Nothing here is computed from the rulebook, so
 * the hash of these inputs (plus the rulebook and policy versions, which never change for a deal) says whether the
 * deal moved since the agreement was prepared. Read only this deal's records.
 */
export interface SheetInputs {
  deal: {
    id: string;
    type: string;
    priceFils: number;
    rulesVersion: string;
    policyVersion: number;
    targetTransferOn: string | null;
    unitNo: string | null;
  };
  unit: { id: string; code: string } | null;
  ownership: { listingId: string; kind: string; ref: string } | null;
  buyers: PartyRec[];
  sellers: PartyRec[];
  brokers: BrokerRec[];
  plan: { seq: number; label: string; dueOn: string | null; milestone: string | null; amountFils: number }[];
  loan: { letterId: string; amountFils: number } | null;
}

export async function gatherSheetInputs(tx: SpaTx, d: DealRow): Promise<SheetInputs> {
  const rows = await tx.db
    .select({ link: dealParties, party: parties })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(dealParties.dealId, d.id), ne(dealParties.role, "broker")))
    .orderBy(asc(dealParties.role), asc(dealParties.order));
  const rec = async ({ link, party: p }: (typeof rows)[number]): Promise<PartyRec> => {
    let licenceNo: string | null = null;
    let signatory: PartyRec["signatory"] = null;
    if (p.kind === "company") {
      const [c] = await tx.db.select().from(companyDetails).where(eq(companyDetails.partyId, p.id));
      licenceNo = c?.licenceNo ?? null;
      const [s] = await tx.db
        .select({ partyId: signatories.personPartyId, title: signatories.title, name: parties.fullNameEn })
        .from(signatories)
        .innerJoin(parties, eq(parties.id, signatories.personPartyId))
        .where(eq(signatories.companyPartyId, p.id))
        .orderBy(asc(signatories.id))
        .limit(1);
      signatory = s ?? null;
    }
    return {
      partyId: p.id,
      order: link.order,
      shareBps: link.shareBps,
      kind: p.kind,
      name: p.fullNameEn,
      nationality: p.nationality,
      passportNo: p.passportNo,
      emiratesIdNo: p.emiratesIdNo,
      email: p.email,
      phone: p.phone,
      licenceNo,
      signatory,
    };
  };
  const buyers: PartyRec[] = [];
  const sellers: PartyRec[] = [];
  for (const r of rows) (r.link.role === "buyer" ? buyers : sellers).push(await rec(r));
  const brokerRows = await tx.db
    .select({
      b: dealBrokers,
      agency: parties.fullNameEn,
      approval: {
        status: spaApprovals.status,
        gate: spaApprovals.gate,
        entityId: spaApprovals.entityId,
        proposal: spaApprovals.proposal,
      },
    })
    .from(dealBrokers)
    .innerJoin(parties, eq(parties.id, dealBrokers.agencyPartyId))
    .leftJoin(spaApprovals, eq(spaApprovals.id, dealBrokers.commissionApprovalId))
    .where(eq(dealBrokers.dealId, d.id))
    .orderBy(asc(dealBrokers.side));
  const plan = await tx.db
    .select()
    .from(paymentPlanRows)
    .where(eq(paymentPlanRows.dealId, d.id))
    .orderBy(asc(paymentPlanRows.seq));
  let unit: SheetInputs["unit"] = null;
  if (d.unitId) {
    const [u] = await tx.db.select().from(units).where(eq(units.id, d.unitId));
    unit = u ? { id: u.id, code: u.code } : null;
  }
  let ownership: SheetInputs["ownership"] = null;
  if (d.listingId) {
    const [l] = await tx.db.select().from(listings).where(eq(listings.id, d.listingId));
    if (l?.ownershipKind && l.ownershipRef) ownership = { listingId: l.id, kind: l.ownershipKind, ref: l.ownershipRef };
  }
  // Only a loan amount a person confirmed (the letter row's own confirmation columns).
  const [loan] = await tx.db
    .select()
    .from(bankLetters)
    .where(and(eq(bankLetters.dealId, d.id), eq(bankLetters.kind, "final_offer"), eq(bankLetters.status, "current")));
  return {
    deal: {
      id: d.id,
      type: d.dealType,
      priceFils: d.priceFils,
      rulesVersion: d.rulesVersion,
      policyVersion: d.policyVersion,
      targetTransferOn: d.targetTransferOn,
      unitNo: d.unitNo,
    },
    unit,
    ownership,
    buyers,
    sellers,
    brokers: brokerRows.map(({ b, agency, approval }) => ({
      side: b.side,
      agencyPartyId: b.agencyPartyId,
      agencyName: agency,
      agentName: b.agentName,
      orn: b.orn,
      brn: b.brn,
      commissionBps: b.commissionBps,
      overrideApproved: overrideApproved(approval, { id: d.id }, b),
    })),
    plan: plan.map((r) => ({
      seq: r.seq,
      label: r.label,
      dueOn: r.dueOn,
      milestone: r.milestone,
      amountFils: r.amountFils,
    })),
    loan:
      loan && loan.amountFils !== null && loan.confirmedBy !== null && loan.confirmedAt !== null
        ? { letterId: loan.id, amountFils: loan.amountFils }
        : null,
  };
}

export const sheetInputHash = (i: SheetInputs): string => createHash("sha256").update(canonicalJson(i)).digest("hex");

/** What the `agreementPrepared` fact compares to: the hash of this deal's inputs now. */
export async function currentSheetHash(tx: SpaTx, d: DealRow): Promise<string> {
  return sheetInputHash(await gatherSheetInputs(tx, d));
}

export interface DealSheet {
  purchasers: SpaValues[];
  sellers: SpaValues[];
  values: SpaValues;
  plan: PlanRow[];
  /** Where each printed value came from: `deal`, `party:<id>`, `unit:<id>`, `listing:<id>`, `letter:<id>`, `plan:<n>`, `policy:<v>`, `rulebook:<v>:<rule>`, `code:<key>`. Never a value. */
  sources: Record<string, string>;
  /** Keys that could not be computed, with the reason (a pending rulebook value). Never a value. */
  unavailable: Record<string, string>;
  /** Groups the template has one block for but the deal has several of (two brokers). */
  ambiguous: string[];
  valuesHash: string;
}

/** The values by data-sheet key, from the inputs, the deal's pinned rulebook and policy. Pure. */
export function sheetFromInputs(i: SheetInputs, rb: SalesRulebook | null, policy: SpaPolicy): DealSheet {
  const sources: Record<string, string> = {};
  const unavailable: Record<string, string> = {};
  const d = i.deal;
  const set = (target: SpaValues, key: string, value: string | number | null | undefined, source: string, at = key) => {
    if (value === null || value === undefined || value === "") return;
    target[key] = value;
    sources[at] = source;
  };

  const partyValues = (list: PartyRec[], role: "purchaser" | "seller"): SpaValues[] =>
    list.map((p, n) => {
      const v: SpaValues = {};
      const at = (k: string) => `${role}.${n + 1}.${k}`;
      const own = `party:${p.partyId}`;
      set(v, `${role}_name`, p.name, own, at(`${role}_name`));
      set(v, `${role}_share`, p.shareBps, `deal:${d.id}`, at(`${role}_share`));
      if (role === "purchaser") {
        set(v, "purchaser_nationality", p.nationality, own, at("purchaser_nationality"));
        set(v, "purchaser_passport_no", p.passportNo, own, at("purchaser_passport_no"));
        set(v, "purchaser_eid_no", p.emiratesIdNo, own, at("purchaser_eid_no"));
        set(v, "purchaser_email", p.email, own, at("purchaser_email"));
        set(v, "purchaser_phone", p.phone, own, at("purchaser_phone"));
        set(v, "purchaser_licence_no", p.licenceNo, own, at("purchaser_licence_no"));
      } else {
        set(v, "seller_id_no", p.emiratesIdNo ?? p.passportNo, own, at("seller_id_no"));
        set(v, "seller_licence_no", p.licenceNo, own, at("seller_licence_no"));
      }
      if (p.signatory) {
        const s = `party:${p.signatory.partyId}`;
        set(v, `${role}_signatory_name`, p.signatory.name, s, at(`${role}_signatory_name`));
        set(v, `${role}_signatory_title`, p.signatory.title, s, at(`${role}_signatory_title`));
      }
      return v;
    });
  const purchasers = partyValues(i.buyers, "purchaser");
  const sellers = partyValues(i.sellers, "seller");

  const values: SpaValues = {};
  set(values, "price", d.priceFils, "deal");
  if (Number.isSafeInteger(d.priceFils) && d.priceFils >= 0)
    set(values, "price_words", moneyInWords(d.priceFils), "code:price");
  if (rb) {
    const fee = registrationFee(d.priceFils, rb);
    if (fee.ok) set(values, "dld_fee", fee.totalFils, `rulebook:${rb.version}:registrationFee`);
    else unavailable.dld_fee = fee.reasons.join("; ");
  } else unavailable.dld_fee = `The rulebook ${d.rulesVersion} isn't available.`;

  if (d.unitNo) set(values, "unit_no", d.unitNo, "deal");
  else if (i.unit) set(values, "unit_no", i.unit.code, `unit:${i.unit.id}`);

  const plan: PlanRow[] = i.plan.map((r) => ({
    number: r.seq,
    label: r.label,
    dueOn: r.dueOn,
    milestone: r.milestone,
    amountFils: r.amountFils,
  }));
  const sorted = sortPlan(plan);
  if (plan.length) sources.payment_plan = "deal:plan";
  sorted.slice(0, 60).forEach((r, n) => {
    sources[`instalment_${n + 1}_amount`] = `plan:${r.number}`;
    sources[`instalment_${n + 1}_due`] = `plan:${r.number}`;
  });
  if (d.type === "primary_offplan" && sorted[0])
    set(values, "booking_amount", sorted[0].amountFils, `plan:${sorted[0].number}`);

  if (d.type !== "primary_offplan") {
    set(values, "deposit_amount", bpsOfFloor(d.priceFils, policy.depositBps), `policy:${d.policyVersion}`);
    set(values, "transfer_date", d.targetTransferOn, "deal");
    if (i.ownership) {
      const key = i.ownership.kind === "title_deed" ? "title_deed_no" : "oqood_no";
      set(values, key, i.ownership.ref, `listing:${i.ownership.listingId}`);
    }
    if (i.loan) set(values, "loan_amount", i.loan.amountFils, `letter:${i.loan.letterId}`);
  }

  const ambiguous: string[] = [];
  if (i.brokers.length === 1) {
    const b = i.brokers[0]!;
    const policyBps = b.side === "seller" ? policy.commission.sellerSideBps : policy.commission.buyerSideBps;
    // Only the policy %, or an override a manager approved, is ever printed (S40 amendment).
    const approved = b.commissionBps !== policyBps && b.overrideApproved;
    set(values, "broker_agency", b.agencyName, `party:${b.agencyPartyId}`);
    set(values, "broker_agent_name", b.agentName, `broker:${b.side}`);
    set(values, "broker_orn", b.orn, `broker:${b.side}`);
    set(values, "broker_brn", b.brn, `broker:${b.side}`);
    set(
      values,
      "broker_commission",
      approved ? b.commissionBps : policyBps,
      approved ? `broker:${b.side}` : `policy:${d.policyVersion}`,
    );
  } else if (i.brokers.length > 1) ambiguous.push("broker");

  return {
    purchasers,
    sellers,
    values,
    plan,
    sources,
    unavailable,
    ambiguous,
    valuesHash: sheetInputHash(i),
  };
}

/** The deal's data sheet today, read from this deal's records only (S51). */
export async function buildDealSheet(ctx: SpaContext, tx: SpaTx, d: DealRow): Promise<DealSheet> {
  const inputs = await gatherSheetInputs(tx, d);
  return sheetFromInputs(inputs, rulebookFor(ctx, d.rulesVersion), await policyAt(tx.db, d.policyVersion));
}

const CLOSED: readonly string[] = dealMachine.terminal;

/**
 * Sales types the payment plan (S51). The rulebook's `validatePlan` turns the shares into amounts that add up to the
 * price to the fil (a primary deal's booking must meet the minimum). Replaces the earlier rows; fixed while a live
 * agreement prints them.
 */
export async function setPaymentPlan(
  ctx: SpaContext,
  dealId: string,
  input: unknown,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ rows: number }> {
  if (!hasAnyRole(user, PLAN_ROLES)) throw forbidden(`only ${PLAN_ROLES.join(", ")} can set the payment plan`);
  const parsed = PaymentPlan.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_plan",
      "the payment plan isn't valid",
      parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`),
    );
  return withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    if (CLOSED.includes(d.state)) throw conflict("deal_closed", `a plan can't be set on a ${d.state} deal`);
    const [live] = await tx.db
      .select({ id: agreements.id })
      .from(agreements)
      .where(and(eq(agreements.dealId, dealId), ne(agreements.status, "superseded")))
      .limit(1);
    if (live) throw conflict("plan_fixed", "the plan is fixed while an agreement is waiting; ask legal to return it");
    const rb = rulebookFor(ctx, d.rulesVersion);
    if (!rb) throw conflict("no_rulebook", `the rulebook ${d.rulesVersion} isn't available`);
    // M6 (S81): a booking below the rulebook's minimum that a sales manager approved lowers the minimum for this deal to
    // exactly the approved share; nothing else is relaxed.
    const [okBooking] = await tx.db
      .select({ proposal: spaApprovals.proposal })
      .from(spaApprovals)
      .where(
        and(
          eq(spaApprovals.gate, "price_out_of_range"),
          eq(spaApprovals.entityKind, "deal"),
          eq(spaApprovals.entityId, dealId),
          eq(spaApprovals.status, "approved"),
          sql`${spaApprovals.proposal}->>'kind' = 'booking'`,
        ),
      )
      .orderBy(desc(spaApprovals.createdAt))
      .limit(1);
    const approvedBps = okBooking?.proposal.bookingBps;
    const minBookingBps = typeof approvedBps === "number" ? Math.min(rb.minBookingBps, approvedBps) : rb.minBookingBps;
    const r = validatePlan(
      parsed.data,
      d.priceFils,
      { ...rb, minBookingBps },
      { primary: d.dealType === "primary_offplan" },
    );
    if (!r.ok) throw unprocessable("invalid_plan", "the payment plan doesn't hold", r.reasons);
    await tx.db.delete(paymentPlanRows).where(eq(paymentPlanRows.dealId, dealId));
    await tx.db.insert(paymentPlanRows).values(
      parsed.data.instalments.map((x, n) => ({
        dealId,
        seq: n + 1,
        label: x.label,
        dueOn: x.dueOn ?? null,
        milestone: x.milestone ?? null,
        amountFils: r.amountsFils[n]!,
        enteredBy: `user:${user.id}`,
      })),
    );
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "PAYMENT_PLAN_SET",
      actor: `user:${user.id}`,
      rulesVersion: d.rulesVersion,
      payload: { rows: parsed.data.instalments.length },
    });
    return { rows: parsed.data.instalments.length };
  });
}
