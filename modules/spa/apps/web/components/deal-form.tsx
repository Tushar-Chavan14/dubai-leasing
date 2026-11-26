"use client";

import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { FormAlert } from "@platform/ui/action-form";
import { Button } from "@platform/ui/button";
import { type FieldErrors, splitReasons } from "@platform/ui/field-errors";
import { FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "@platform/ui/form";
import { useActionForm } from "@platform/ui/use-action-form";
import { BuyersInput, DealBrokerInput } from "@spa/core";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { quoteAction, type StartDealResult, startDealAction } from "../app/(staff)/deals/new/actions";
import { parseAedToFils } from "../lib/catalogue";
import type { DealQuote } from "../lib/contracts";
import { filsToAedInput, formatMoneyFils, shareLabel } from "../lib/format";
import { blankParty, type PartyRow, partyPayload, PartyRows, pctToBps } from "./party-rows";
import { FormSection } from "./unit-form";

export interface DealFormUnit {
  id: string;
  code: string;
  title: string;
}
export interface DealFormLead {
  id: string;
  name: string;
  email: string;
}

export interface PlanRow {
  label: string;
  share: string;
  dueOn: string;
  milestone: string;
}

const INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;
const S6 = "grid grid-cols-6 items-start gap-x-4 gap-y-4";
const W2 = "col-span-6 @[560px]:col-span-2";
const W3 = "col-span-6 @[560px]:col-span-3";
const FEE_PAYER: Record<string, string> = {
  buyer: "The buyer pays it",
  seller: "The seller pays it",
  split: "Split between buyer and seller",
};
const text = (v: string): string | undefined => (v.trim() === "" ? undefined : v.trim());
const pct = (bps: number) => shareLabel(bps) ?? "0%";

/** The plan's first draft: the booking at the rulebook's minimum share (the engine's), the rest on handover. */
function defaultPlan(bookingMinBps: number): PlanRow[] {
  return [
    { label: "Booking", share: String(bookingMinBps / 100), dueOn: "", milestone: "On booking" },
    { label: "Handover", share: String((10_000 - bookingMinBps) / 100), dueOn: "", milestone: "On handover" },
  ];
}

/**
 * The New deal form (M6, S81): Home, Buyers, Price and booking with the engine's live quote, Payment plan, Broker and
 * Mortgage. Every limit shown comes from the engine's quote (rulebook and policy); the only arithmetic here is dirhams to
 * fils. A price or booking outside the limits still starts the deal: it opens a gate for a sales manager.
 */
export function DealForm({
  unit,
  quote: initialQuote,
  lead,
  plan: initialPlan,
}: {
  unit: DealFormUnit;
  quote: DealQuote;
  lead?: DealFormLead | null;
  /** A different first draft of the plan (rows of share %, as typed); the default is the booking and the handover. */
  plan?: PlanRow[];
}) {
  const [buyers, setBuyers] = useState<PartyRow[]>(() => [
    { ...blankParty(), name: lead?.name ?? "", email: lead?.email ?? "" },
  ]);
  const [price, setPrice] = useState(() =>
    initialQuote.listPriceFils ? filsToAedInput(initialQuote.listPriceFils) : "",
  );
  const [booking, setBooking] = useState(() =>
    initialQuote.bookingMinFils ? filsToAedInput(initialQuote.bookingMinFils) : "",
  );
  const [plan, setPlan] = useState<PlanRow[]>(() => initialPlan ?? defaultPlan(initialQuote.bookingMinBps));
  const [useBroker, setUseBroker] = useState(false);
  const [broker, setBroker] = useState({
    agencyName: "",
    agencyEmail: "",
    agentName: "",
    orn: "",
    brn: "",
    commission: "",
  });
  const [mortgage, setMortgage] = useState(false);
  const [quote, setQuote] = useState<DealQuote>(initialQuote);
  const [result, setResult] = useState<StartDealResult>({});
  const [busy, startTransition] = useTransition();

  const priceFils = price.trim() ? parseAedToFils(price) : undefined;
  const bookingFils = booking.trim() ? parseAedToFils(booking) : undefined;

  // The quote follows the price and booking typed, from the engine (a short wait after the last keystroke).
  const seq = useRef(0);
  useEffect(() => {
    if (priceFils === null || bookingFils === null) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const q = await quoteAction(unit.id, priceFils, bookingFils);
      if (q && mine === seq.current) setQuote(q);
    }, 350);
    return () => clearTimeout(t);
  }, [unit.id, priceFils, bookingFils]);

  const planBps = plan.map((r) => pctToBps(r.share));
  const planTotal = planBps.reduce<number>((n, b) => n + (typeof b === "number" ? b : 0), 0);
  const planBad = planBps.some((b) => b === null || b === undefined) || planTotal !== 10_000;

  const brokerPayload = () => {
    const bps = pctToBps(broker.commission);
    return {
      agencyName: broker.agencyName.trim(),
      agencyEmail: broker.agencyEmail.trim(),
      agentName: broker.agentName.trim(),
      orn: broker.orn.trim(),
      brn: broker.brn.trim(),
      ...(typeof bps === "number" ? { commissionBps: bps } : {}),
    };
  };
  const payload = () => ({
    unitId: unit.id,
    buyers: buyers.map(partyPayload),
    ...(priceFils ? { priceFils } : {}),
    ...(bookingFils ? { bookingFils } : {}),
    buyerMortgage: mortgage,
    ...(useBroker ? { broker: brokerPayload() } : {}),
    ...(lead ? { leadId: lead.id } : {}),
  });
  const planPayload = () =>
    plan.map((r, i) => ({
      label: r.label.trim(),
      shareBps: planBps[i] as number,
      ...(text(r.dueOn) ? { dueOn: r.dueOn } : {}),
      ...(text(r.milestone) ? { milestone: r.milestone.trim() } : {}),
    }));

  function submit() {
    startTransition(async () => {
      const r = await startDealAction(payload(), planPayload());
      setResult(r);
      if (r.ok && r.id && !r.gates?.length && !r.planError) window.location.assign(`/work/deals/${r.id}`);
    });
  }

  const server = useMemo(
    () =>
      result.reasons && !result.ok
        ? splitReasons(result.reasons)
        : { fieldErrors: {} as FieldErrors, reasons: [] as string[] },
    [result.reasons, result.ok],
  );
  const form = useActionForm(submit, {
    validate: () => {
      const errors: FieldErrors = {};
      const say = (message: string) => {
        const msg = message.charAt(0).toUpperCase() + message.slice(1);
        return /expected/i.test(msg) ? "Fill this in" : msg;
      };
      if (price.trim() && priceFils === null) errors.price = "Enter the price in dirhams, for example 1,500,000";
      if (!price.trim() && quote.listPriceFils === null)
        errors.price = "This home has no price list price: enter the agreed price";
      if (booking.trim() && bookingFils === null) errors.booking = "Enter the booking in dirhams, for example 150,000";
      if (planBad) errors.plan = "The payment plan must add up to 100%";
      buyers.forEach((r, i) => {
        if (pctToBps(r.share) === null) errors[`buyers.${i}.share`] = "Enter a percentage such as 50 or 33.33";
      });
      const parsed = BuyersInput.safeParse(buyers.map(partyPayload));
      if (!parsed.success)
        for (const i of parsed.error.issues) {
          if (i.code === "invalid_union") {
            // A row's own mistakes: re-run its own schema so the message lands under its field.
            const row = Number(i.path[0]);
            const one = BuyersInput.safeParse([partyPayload(buyers[row]!)]);
            if (!one.success)
              for (const j of one.error.issues) {
                if (j.code === "invalid_union") continue;
                errors[`buyers.${row}.${j.path.slice(1).join(".")}`] ??= say(j.message);
              }
            continue;
          }
          errors[i.path.length ? `buyers.${i.path.join(".")}` : "buyers"] ??= say(i.message);
        }
      if (useBroker) {
        const b = DealBrokerInput.safeParse(brokerPayload());
        if (!b.success) for (const i of b.error.issues) errors[`broker.${String(i.path[0])}`] ??= say(i.message);
        if (pctToBps(broker.commission) === null) errors["broker.commissionBps"] = "Enter a percentage such as 1.5";
      }
      return Object.keys(errors).length ? errors : null;
    },
    serverErrors: server.fieldErrors,
  });
  const fe = form.fieldErrors;
  const err = (k: string) => (fe[k] ? <span className="text-xs text-danger">{fe[k]}</span> : null);
  const inv = (k: string, label?: string) => ({
    "data-field": k,
    ...(label ? { "data-label": label } : {}),
    ...(fe[k] ? { "aria-invalid": true as const } : {}),
  });
  const setPlanRow = (i: number, patch: Partial<PlanRow>) =>
    setPlan((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const policyCommission = quote.commission.buyerSideBps;

  if (result.ok)
    return (
      <div className="grid max-w-[980px] gap-4" aria-live="polite">
        <div className="grid gap-2 rounded-2xl border border-line bg-page p-5">
          <h2 className="m-0 text-[17px] font-semibold text-ink">Deal {result.ref} started</h2>
          <p className="m-0 text-sm text-ink">{unit.title} is held for this buyer.</p>
          {result.gates?.length ? (
            <div role="status" className="grid gap-1 rounded-xl border border-line bg-raised p-3 text-sm text-ink">
              <b className="font-semibold">A sales manager must approve this deal before it can move on.</b>
              {(result.reasons ?? []).map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
          ) : null}
          {result.planError ? (
            <div role="alert" className="grid gap-1 rounded-xl border border-line bg-raised p-3 text-sm text-ink">
              <b className="font-semibold">The payment plan wasn't saved. Set it on the deal.</b>
              {result.planError.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
          ) : null}
          <div>
            <Link
              href={`/work/deals/${result.id}`}
              className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary no-underline"
            >
              Open the deal
            </Link>
          </div>
        </div>
      </div>
    );

  return (
    <form {...form.formProps} noValidate className="@container grid max-w-[980px] [&>section:first-child]:border-t-0">
      {(result.error || server.reasons.length > 0 || form.invalid.length > 0) && (
        <div className="mb-5 grid gap-2">
          <FormAlert {...form.alertProps({ error: result.error, reasons: server.reasons })} />
          {result.existing && (
            <Link href={`/work/deals/${result.existing.id}`} className="text-sm font-semibold text-ink! underline">
              Open deal {result.existing.ref}
            </Link>
          )}
        </div>
      )}

      <FormSection title="Home" lede="The unit this deal is for. It is held for the buyer as soon as the deal starts.">
        <div className="grid gap-1 rounded-xl border border-line bg-page px-3.5 py-2.5 text-sm">
          <b className="font-semibold">
            {unit.code} <span className="font-normal text-muted">· {unit.title}</span>
          </b>
          <span className="text-muted">
            Price list price: {quote.listPriceFils === null ? "none published" : formatMoneyFils(quote.listPriceFils)}
          </span>
        </div>
      </FormSection>

      <FormSection
        title="Buyers"
        lede="One to four buyers. Each is created with the deal. A company buyer signs through its authorised signatory."
      >
        <PartyRows role="buyer" rows={buyers} setRows={setBuyers} inv={inv} err={err} max={4} />
      </FormSection>

      <FormSection
        title="Price and booking"
        lede="Dirhams. The limits below come from the sales rules and company policy."
      >
        <div className={S6}>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Agreed price (AED)</span>
            <input
              className={INPUT}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              {...inv("price", "Agreed price")}
            />
            {err("price") ?? <span className={HINT}>Leave it as the list price, or enter what was agreed.</span>}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Booking amount (AED)</span>
            <input
              className={INPUT}
              value={booking}
              onChange={(e) => setBooking(e.target.value)}
              inputMode="decimal"
              {...inv("booking", "Booking amount")}
            />
            {err("booking")}
          </label>
        </div>
        <dl
          aria-label="Quote"
          className="m-0 mt-4 grid gap-2 rounded-xl border border-line bg-page p-4 text-sm @[560px]:grid-cols-2"
        >
          <QuoteRow
            label="List price"
            value={quote.listPriceFils === null ? "None published" : formatMoneyFils(quote.listPriceFils)}
          />
          <QuoteRow
            label="Agreed price"
            value={quote.priceFils === null ? "Not set" : formatMoneyFils(quote.priceFils)}
          />
          <QuoteRow label="Discount" value={quote.discountBps === null ? "Not applicable" : pct(quote.discountBps)} />
          <QuoteRow label="Largest discount without approval" value={pct(quote.maxDiscountBps)} />
          <QuoteRow
            label="Booking minimum"
            value={
              quote.bookingMinFils === null
                ? "Not set"
                : `${formatMoneyFils(quote.bookingMinFils)} (${pct(quote.bookingMinBps)})`
            }
          />
          <QuoteRow
            label="DLD registration fee"
            value={
              quote.dldFeeFils === null
                ? "Not confirmed yet"
                : `${formatMoneyFils(quote.dldFeeFils)}. ${FEE_PAYER[quote.dldFeePayer] ?? "Payer not confirmed"}`
            }
          />
        </dl>
        {(!quote.withinPolicy || !quote.bookingOk) && (
          <div role="status" className="mt-3 grid gap-1 rounded-xl border border-line bg-raised p-3 text-sm text-ink">
            <b className="font-semibold">A sales manager must approve this price</b>
            <span className="text-muted">
              The deal still starts and the home is held. It can't move on until the manager decides.
            </span>
            {quote.reasons.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection title="Payment plan" lede="The instalments, as shares of the price. They must add up to 100%.">
        <div className="grid gap-3">
          {plan.map((r, i) => (
            <fieldset key={i} className="grid gap-3 rounded-xl border border-line bg-page p-4">
              <legend className="sr-only">Instalment {i + 1}</legend>
              <div className={S6}>
                <label className={`${FIELD} ${W3}`}>
                  <span className={LABEL}>Label</span>
                  <input
                    className={INPUT}
                    value={r.label}
                    onChange={(e) => setPlanRow(i, { label: e.target.value })}
                    maxLength={80}
                  />
                </label>
                <label className={`${FIELD} col-span-3 @[560px]:col-span-1`}>
                  <span className={LABEL}>Share %</span>
                  <input
                    className={INPUT}
                    value={r.share}
                    inputMode="decimal"
                    onChange={(e) => setPlanRow(i, { share: e.target.value })}
                    aria-label={`Instalment ${i + 1} share`}
                  />
                </label>
                <label className={`${FIELD} col-span-3 @[560px]:col-span-2`}>
                  <span className={LABEL}>Due on</span>
                  <input
                    className={INPUT}
                    type="date"
                    value={r.dueOn}
                    onChange={(e) => setPlanRow(i, { dueOn: e.target.value })}
                  />
                </label>
                <label className={`${FIELD} col-span-6`}>
                  <span className={LABEL}>Or milestone</span>
                  <input
                    className={INPUT}
                    value={r.milestone}
                    onChange={(e) => setPlanRow(i, { milestone: e.target.value })}
                    maxLength={80}
                  />
                </label>
              </div>
              {plan.length > 1 && (
                <div>
                  <Button variant="ghost" size="sm" onClick={() => setPlan((rows) => rows.filter((_, j) => j !== i))}>
                    <TrashIcon size={15} aria-hidden />
                    Remove instalment
                  </Button>
                </div>
              )}
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPlan((rows) => [...rows, { label: "", share: "", dueOn: "", milestone: "" }])}
              disabled={plan.length >= 12}
            >
              <PlusIcon size={15} aria-hidden />
              Add an instalment
            </Button>
            <span
              data-field="plan"
              tabIndex={-1}
              className={planBad ? "text-xs text-danger" : HINT}
              role={planBad ? "alert" : undefined}
            >
              {planBad ? `The plan adds up to ${pct(planTotal)}. It must be 100%.` : "The plan adds up to 100%."}
            </span>
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Broker (optional)"
        lede="The agency and agent who brought the buyer. Commission is the policy's unless you enter another."
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useBroker} onChange={(e) => setUseBroker(e.target.checked)} />A broker brought
          this buyer
        </label>
        {useBroker && (
          <div className={`${S6} mt-4`}>
            {(
              [
                ["agencyName", "Agency", W3],
                ["agencyEmail", "Agency email", W3],
                ["agentName", "Broker name", W2],
                ["orn", "Agency ORN", W2],
                ["brn", "Broker BRN", W2],
              ] as const
            ).map(([k, label, w]) => (
              <label key={k} className={`${FIELD} ${w}`}>
                <span className={LABEL}>{label}</span>
                <input
                  className={INPUT}
                  value={broker[k]}
                  onChange={(e) => setBroker((b) => ({ ...b, [k]: e.target.value }))}
                  {...inv(`broker.${k}`, label)}
                />
                {err(`broker.${k}`)}
              </label>
            ))}
            <label className={`${FIELD} ${W2}`}>
              <span className={LABEL}>Commission %</span>
              <input
                className={INPUT}
                value={broker.commission}
                onChange={(e) => setBroker((b) => ({ ...b, commission: e.target.value }))}
                inputMode="decimal"
                placeholder={shareLabel(policyCommission)?.replace("%", "") ?? ""}
                {...inv("broker.commissionBps", "Commission")}
              />
              {err("broker.commissionBps") ?? (
                <span className={HINT}>Policy: {pct(policyCommission)}. Another % needs approval.</span>
              )}
            </label>
          </div>
        )}
      </FormSection>

      <FormSection title="Mortgage" lede="Whether the buyer is financing the purchase.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mortgage} onChange={(e) => setMortgage(e.target.checked)} />
          The buyer needs a mortgage
        </label>
      </FormSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Starting…" : "Start deal"}
        </Button>
      </div>
    </form>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="m-0 text-right font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
