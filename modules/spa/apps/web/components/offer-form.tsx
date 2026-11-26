"use client";

import { FormAlert } from "@platform/ui/action-form";
import { Button } from "@platform/ui/button";
import { type FieldErrors, splitReasons } from "@platform/ui/field-errors";
import { FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "@platform/ui/form";
import { useActionForm } from "@platform/ui/use-action-form";
import { MakeOfferInput } from "@spa/core";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { makeOfferAction, type MakeOfferResult } from "../app/(staff)/listings/[id]/offer/actions";
import { parseAedToFils } from "../lib/catalogue";
import { filsToAedInput, formatMoneyFils, shareLabel } from "../lib/format";
import { blankParty, type PartyRow, partyPayload, PartyRows, pctToBps } from "./party-rows";
import { FormSection } from "./unit-form";

export interface OfferFormListing {
  id: string;
  ref: string;
  title: string;
  askingPriceFils: number | null;
  /** An off-plan resale also states the seller's mortgage and whether the plan is taken over. */
  offplan: boolean;
}
export interface OfferTerms {
  depositBps: number;
  validityDays: number;
  validityMaxDays: number;
}

const INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;
const S6 = "grid grid-cols-6 items-start gap-x-4 gap-y-4";
const W3 = "col-span-6 @[560px]:col-span-3";

/**
 * The Make an offer form (M6, S81): Buyers, Offer (price, validity, conditions), Mortgage and the deposit the policy sets.
 * The deposit % is the company policy's and can't be typed. Each seller then gets their own emailed link to answer.
 */
export function OfferForm({
  listing,
  terms,
  lead,
}: {
  listing: OfferFormListing;
  terms: OfferTerms;
  lead?: { id: string; name: string; email: string } | null;
}) {
  const [buyers, setBuyers] = useState<PartyRow[]>(() => [
    { ...blankParty(), name: lead?.name ?? "", email: lead?.email ?? "" },
  ]);
  const [price, setPrice] = useState(() => (listing.askingPriceFils ? filsToAedInput(listing.askingPriceFils) : ""));
  const [days, setDays] = useState(String(terms.validityDays));
  const [buyerMortgage, setBuyerMortgage] = useState(false);
  const [sellerMortgage, setSellerMortgage] = useState(false);
  const [planTakenOver, setPlanTakenOver] = useState(false);
  const [transferOn, setTransferOn] = useState("");
  const [conditions, setConditions] = useState("");
  const [result, setResult] = useState<MakeOfferResult>({});
  const [busy, startTransition] = useTransition();

  const priceFils = price.trim() ? parseAedToFils(price) : undefined;
  const payload = () => ({
    buyers: buyers.map(partyPayload),
    ...(priceFils ? { priceFils } : {}),
    buyerMortgage,
    ...(listing.offplan ? { sellerMortgage, planTakenOver } : {}),
    ...(transferOn.trim() ? { targetTransferOn: transferOn.trim() } : {}),
    ...(conditions.trim() ? { conditions: conditions.trim() } : {}),
    ...(days.trim() && /^\d+$/.test(days.trim()) ? { validDays: Number(days.trim()) } : {}),
    ...(lead ? { leadId: lead.id } : {}),
  });

  function submit() {
    startTransition(async () => {
      const r = await makeOfferAction(listing.id, payload());
      setResult(r);
      if (r.ok && r.emailed?.every((e) => e.status === "sent")) window.location.assign(`/listings/${listing.id}`);
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
        return /expected|received/i.test(msg) ? "Fill this in" : msg;
      };
      if (!price.trim() || priceFils === null)
        errors.priceFils = "Enter the offer price in dirhams, for example 1,500,000";
      if (days.trim() && !/^\d+$/.test(days.trim())) errors.validDays = "Enter a whole number of days";
      buyers.forEach((r, i) => {
        if (pctToBps(r.share) === null) errors[`buyers.${i}.share`] = "Enter a percentage such as 50 or 33.33";
      });
      const parsed = MakeOfferInput.safeParse({ listingId: listing.id, ...payload() });
      if (!parsed.success)
        for (const i of parsed.error.issues) {
          if (i.code === "invalid_union") {
            const row = Number(i.path[1]);
            const one = MakeOfferInput.shape.buyers.safeParse([partyPayload(buyers[row]!)]);
            if (!one.success)
              for (const j of one.error.issues) {
                if (j.code === "invalid_union") continue;
                errors[`buyers.${row}.${j.path.slice(1).join(".")}`] ??= say(j.message);
              }
            continue;
          }
          const key = i.path[0] === "buyers" ? i.path.join(".") : String(i.path[0] ?? "form");
          if (key === "priceFils" && errors.priceFils) continue;
          errors[key] ??= key === "validDays" ? `Enter 1 to ${terms.validityMaxDays} days` : say(i.message);
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

  if (result.ok)
    return (
      <div className="grid max-w-[980px] gap-3 rounded-2xl border border-line bg-page p-5" aria-live="polite">
        <h2 className="m-0 text-[17px] font-semibold text-ink">Offer sent</h2>
        <p className="m-0 text-sm text-ink">
          {result.emailed?.every((e) => e.status === "sent")
            ? "Each seller has been emailed their own link to answer."
            : "The offer is open, but an email to a seller didn't go. Withdraw the offer and send it again."}
        </p>
        <div>
          <Link
            href={`/listings/${listing.id}`}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-on-primary no-underline"
          >
            Back to the listing
          </Link>
        </div>
      </div>
    );

  return (
    <form {...form.formProps} noValidate className="@container grid max-w-[980px] [&>section:first-child]:border-t-0">
      {(result.error || server.reasons.length > 0 || form.invalid.length > 0) && (
        <div className="mb-5">
          <FormAlert {...form.alertProps({ error: result.error, reasons: server.reasons })} />
        </div>
      )}

      <FormSection title="Home" lede="The listing the offer is made on.">
        <div className="grid gap-1 rounded-xl border border-line bg-page px-3.5 py-2.5 text-sm">
          <b className="font-semibold">
            {listing.ref} <span className="font-normal text-muted">· {listing.title}</span>
          </b>
          <span className="text-muted">
            Asking price: {listing.askingPriceFils === null ? "not set" : formatMoneyFils(listing.askingPriceFils)}
          </span>
        </div>
      </FormSection>

      <FormSection
        title="Buyers"
        lede="One to four buyers. The sellers never see their names: the link shows only the terms."
      >
        <PartyRows role="buyer" rows={buyers} setRows={setBuyers} inv={inv} err={err} max={4} />
      </FormSection>

      <FormSection
        title="Offer"
        lede="The price is fixed once sent. A revision is a new offer after this one is withdrawn, declined or expires."
      >
        <div className={S6}>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Offer price (AED)</span>
            <input
              className={INPUT}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              {...inv("priceFils", "Offer price")}
            />
            {err("priceFils")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Sellers can answer for (days)</span>
            <input
              className={INPUT}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              {...inv("validDays", "Days to answer")}
            />
            {err("validDays") ?? (
              <span className={HINT}>
                1 to {terms.validityMaxDays} days. Policy: {terms.validityDays}.
              </span>
            )}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Target transfer date (optional)</span>
            <input
              className={INPUT}
              type="date"
              value={transferOn}
              onChange={(e) => setTransferOn(e.target.value)}
              {...inv("targetTransferOn", "Target transfer date")}
            />
            {err("targetTransferOn")}
          </label>
          <div className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Security deposit</span>
            <p className="m-0 rounded-xl border border-line bg-page px-3.5 py-2.5 text-sm">
              {shareLabel(terms.depositBps)} of the price, a cheque in the seller's name held by the brokerage.
            </p>
            <span className={HINT}>Set by company policy. Recorded after the sellers accept.</span>
          </div>
          <label className={`${FIELD} col-span-6`}>
            <span className={LABEL}>Conditions (optional)</span>
            <textarea
              className={INPUT}
              rows={3}
              maxLength={1000}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              {...inv("conditions", "Conditions")}
            />
            {err("conditions") ?? (
              <span className={HINT}>Shown to the sellers on their link. Don't name the buyer.</span>
            )}
          </label>
        </div>
      </FormSection>

      <FormSection title="Mortgage" lede="Finance on either side adds a step before settlement.">
        <div className="grid gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={buyerMortgage} onChange={(e) => setBuyerMortgage(e.target.checked)} />
            The buyer needs a mortgage
          </label>
          {listing.offplan && (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sellerMortgage} onChange={(e) => setSellerMortgage(e.target.checked)} />
                The seller has a mortgage on the unit
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={planTakenOver} onChange={(e) => setPlanTakenOver(e.target.checked)} />
                The buyer takes over the developer's payment plan
              </label>
            </>
          )}
        </div>
      </FormSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Sending…" : "Send offer"}
        </Button>
      </div>
    </form>
  );
}
