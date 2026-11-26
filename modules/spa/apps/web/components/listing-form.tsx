"use client";

import { FormAlert } from "@platform/ui/action-form";
import { Button } from "@platform/ui/button";
import { type FieldErrors, splitReasons } from "@platform/ui/field-errors";
import { FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "@platform/ui/form";
import { useActionForm } from "@platform/ui/use-action-form";
import { FURNISHED, ListingDraftInput, ListingEdit, SellerInput, UNIT_TYPES } from "@spa/core";
import { useMemo, useState, useTransition } from "react";
import { createListingAction, type ListingActionResult, updateListingAction } from "../app/(staff)/listings/actions";
import { parseAedToFils } from "../lib/catalogue";
import type { ListingRecord } from "../lib/contracts";
import { shareLabel } from "../lib/format";
import { FURNISHED_LABEL, UNIT_TYPE_LABEL } from "../lib/words";
import { blankParty, type PartyRow, partyPayload, pctToBps, PartyRows } from "./party-rows";
import { FormSection } from "./unit-form";

export interface FormAgent {
  id: string;
  name: string;
}

interface Values {
  title: string;
  community: string;
  unitType: string;
  bedrooms: string;
  bathrooms: string;
  sizeSqft: string;
  floor: string;
  view: string;
  parkingSpaces: string;
  furnished: string;
  propertyDescription: string;
  askingPrice: string;
  permitNo: string;
  permitIssuedOn: string;
  permitExpiresOn: string;
  agentUserId: string;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
const text = (v: string): string | undefined => (v.trim() === "" ? undefined : v.trim());
/** AED as typed ("1,500,000") to a whole-dirham display for the edit form. */
const aed = (fils: number | null) => (fils === null ? "" : String(Math.trunc(fils / 100)));

function initial(l: ListingRecord | undefined, agents: FormAgent[]): Values {
  return {
    title: s(l?.title),
    community: s(l?.community),
    unitType: s(l?.unitType),
    bedrooms: s(l?.bedrooms),
    bathrooms: s(l?.bathrooms),
    sizeSqft: s(l?.sizeSqft),
    floor: s(l?.floor),
    view: s(l?.view),
    parkingSpaces: s(l?.parkingSpaces),
    furnished: s(l?.furnished),
    propertyDescription: s(l?.description),
    askingPrice: aed(l?.askingPriceFils ?? null),
    permitNo: s(l?.permit.no),
    permitIssuedOn: s(l?.permit.issuedOn),
    permitExpiresOn: s(l?.permit.expiresOn),
    agentUserId: l ? s(l.agentUserId) : (agents[0]?.id ?? ""),
  };
}

const INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;
const S6 = "grid grid-cols-6 items-start gap-x-4 gap-y-4";
const W1 = "col-span-6 @[560px]:col-span-1";
const W2 = "col-span-6 @[560px]:col-span-2";
const W3 = "col-span-6 @[560px]:col-span-3";

/** A zod issue path to the name the form's inputs carry: `sellers.0.email` stays whole, the rest is the first key. */
const nameOf = (path: readonly PropertyKey[]): string =>
  path[0] === "sellers" && typeof path[1] === "number" ? path.join(".") : String(path[0] ?? "form");

/**
 * The New and Edit listing form (S77), laid out like the unit form: Property, Price, Sellers, Permit, Agent. It is checked
 * in the browser with the same `ListingDraftInput` / `ListingEdit` the engine uses; the engine checks again and its
 * answer is put back under the field it names. Sellers are typed here (a person or a company with its signatory) and
 * can't change once the listing exists.
 */
export function ListingForm({
  mode,
  listing,
  agents,
}: {
  mode: "new" | "edit";
  listing?: ListingRecord;
  agents: FormAgent[];
}) {
  const [v, setV] = useState<Values>(() => initial(listing, agents));
  const [sellers, setSellers] = useState<PartyRow[]>(() => [blankParty()]);
  const [result, setResult] = useState<ListingActionResult>({});
  const [busy, startTransition] = useTransition();
  const set =
    <K extends keyof Values>(k: K) =>
    (e: { target: { value: string } }) =>
      setV((p) => ({ ...p, [k]: e.target.value as Values[K] }));
  /** The values as the engine's schema wants them; a bad share or price is reported by `validate`. */
  const fields = () => ({
    title: text(v.title),
    community: text(v.community),
    propertyDescription: text(v.propertyDescription),
    askingPriceFils: v.askingPrice.trim() ? (parseAedToFils(v.askingPrice) ?? undefined) : undefined,
    unitType: text(v.unitType),
    bedrooms: num(v.bedrooms),
    bathrooms: num(v.bathrooms),
    sizeSqft: num(v.sizeSqft),
    floor: num(v.floor),
    view: text(v.view),
    parkingSpaces: num(v.parkingSpaces),
    furnished: text(v.furnished),
    permitNo: text(v.permitNo),
    permitIssuedOn: text(v.permitIssuedOn),
    permitExpiresOn: text(v.permitExpiresOn),
    agentUserId: text(v.agentUserId),
  });
  const payload = () => {
    const f = Object.fromEntries(Object.entries(fields()).filter(([, x]) => x !== undefined));
    return mode === "new" ? { ...f, sellers: sellers.map(partyPayload) } : f;
  };

  function submit() {
    startTransition(async () => {
      const r =
        mode === "edit" && listing
          ? await updateListingAction(listing.id, payload())
          : await createListingAction(payload());
      setResult(r);
      if (r.ok && r.id) window.location.assign(`/listings/${r.id}`);
    });
  }

  // Stable between renders: the form compares this object to the last one to tell a new server answer from the same one.
  const server = useMemo(
    () => (result.reasons ? splitReasons(result.reasons) : { fieldErrors: {} as FieldErrors, reasons: [] as string[] }),
    [result.reasons],
  );
  const serverFields = server.fieldErrors;
  const serverGeneral = server.reasons;
  const form = useActionForm(submit, {
    validate: () => {
      const errors: FieldErrors = {};
      if (v.askingPrice.trim() && parseAedToFils(v.askingPrice) === null)
        errors.askingPriceFils = "Enter the price in dirhams, for example 1,500,000";
      if (!v.askingPrice.trim()) errors.askingPriceFils = "Enter the asking price";
      const say = (message: string) => {
        const msg = message.charAt(0).toUpperCase() + message.slice(1);
        return /expected/i.test(msg) ? "Fill this in" : msg;
      };
      if (mode === "new")
        sellers.forEach((r, i) => {
          if (pctToBps(r.share) === null) errors[`sellers.${i}.share`] = "Enter a percentage such as 50 or 33.33";
          const row = SellerInput.safeParse(partyPayload(r));
          if (!row.success)
            for (const issue of row.error.issues) errors[`sellers.${i}.${issue.path.join(".")}`] ??= say(issue.message);
        });
      const parsed = mode === "new" ? ListingDraftInput.safeParse(payload()) : ListingEdit.safeParse(payload());
      if (!parsed.success)
        for (const i of parsed.error.issues) {
          // A seller row's own mistakes are reported above, row by row; a union issue only repeats them.
          if (i.code === "invalid_union") continue;
          const name = nameOf(i.path);
          if (name === "askingPriceFils" && errors.askingPriceFils) continue;
          errors[name] ??= say(i.message);
        }
      return Object.keys(errors).length ? errors : null;
    },
    serverErrors: serverFields,
  });
  const fe = form.fieldErrors;
  const err = (k: string) => (fe[k] ? <span className="text-xs text-danger">{fe[k]}</span> : null);
  const inv = (k: string, label?: string) => ({
    "data-field": k,
    ...(label ? { "data-label": label } : {}),
    ...(fe[k] ? { "aria-invalid": true as const } : {}),
  });
  return (
    <form {...form.formProps} noValidate className="@container grid max-w-[980px] [&>section:first-child]:border-t-0">
      {(result.error || serverGeneral.length > 0 || form.invalid.length > 0) && (
        <div className="mb-5">
          <FormAlert {...form.alertProps({ error: result.error, reasons: serverGeneral })} />
        </div>
      )}

      <FormSection title="Property" lede="What the public page says about it. Never put an owner's name here.">
        <div className={S6}>
          <label className={`${FIELD} col-span-6`}>
            <span className={LABEL}>Title</span>
            <input
              className={INPUT}
              value={v.title}
              onChange={set("title")}
              maxLength={120}
              placeholder="2-bed apartment, Marina Vista"
              {...inv("title")}
            />
            {err("title")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Community</span>
            <input
              className={INPUT}
              value={v.community}
              onChange={set("community")}
              maxLength={120}
              {...inv("community")}
            />
            {err("community")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Type</span>
            <select className={INPUT} value={v.unitType} onChange={set("unitType")} {...inv("unitType")}>
              <option value="">Not set</option>
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {UNIT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            {err("unitType")}
          </label>
          {(
            [
              ["bedrooms", "Bedrooms", W1],
              ["bathrooms", "Bathrooms", W1],
              ["sizeSqft", "Size (sq ft)", W2],
              ["floor", "Floor", W1],
              ["parkingSpaces", "Parking", W1],
            ] as const
          ).map(([k, label, w]) => (
            <label key={k} className={`${FIELD} ${w}`}>
              <span className={LABEL}>{label}</span>
              <input className={INPUT} value={v[k]} onChange={set(k)} inputMode="numeric" {...inv(k)} />
              {err(k) ?? (k === "bedrooms" ? <span className={HINT}>0 is a studio</span> : null)}
            </label>
          ))}
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>View</span>
            <input
              className={INPUT}
              value={v.view}
              onChange={set("view")}
              maxLength={60}
              placeholder="Marina"
              {...inv("view")}
            />
            {err("view")}
          </label>
          <label className={`${FIELD} ${W3}`}>
            <span className={LABEL}>Furnishing</span>
            <select className={INPUT} value={v.furnished} onChange={set("furnished")} {...inv("furnished")}>
              <option value="">Not set</option>
              {FURNISHED.map((f) => (
                <option key={f} value={f}>
                  {FURNISHED_LABEL[f]}
                </option>
              ))}
            </select>
            {err("furnished")}
          </label>
          <label className={`${FIELD} col-span-6`}>
            <span className={LABEL}>Description</span>
            <textarea
              className={INPUT}
              value={v.propertyDescription}
              onChange={set("propertyDescription")}
              rows={4}
              maxLength={2000}
              {...inv("propertyDescription")}
            />
            {err("propertyDescription") ?? <span className={HINT}>{v.propertyDescription.length} / 2000</span>}
          </label>
        </div>
      </FormSection>

      <FormSection title="Price" lede="The asking price in dirhams. Offers are made against it.">
        <label className={`${FIELD} max-w-sm`}>
          <span className={LABEL}>Asking price (AED)</span>
          <input
            className={INPUT}
            value={v.askingPrice}
            onChange={set("askingPrice")}
            inputMode="numeric"
            placeholder="1,500,000"
            {...inv("askingPriceFils", "Asking price")}
          />
          {err("askingPriceFils")}
        </label>
      </FormSection>

      <FormSection
        title="Sellers"
        lede={
          mode === "new"
            ? "Every co-owner on the title deed is a seller and signs the listing agreement. A company signs through its authorised signatory."
            : "Sellers can't change after the listing is created."
        }
      >
        {mode === "edit" ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {(listing?.sellers ?? []).map((x) => (
              <li key={x.partyId || x.name} className="rounded-xl border border-line bg-page px-3.5 py-2.5 text-sm">
                <b className="font-semibold">{x.name}</b>
                <span className="text-muted">
                  {" "}
                  · {x.kind === "company" ? "Company" : "Individual"}
                  {shareLabel(x.shareBps) ? ` · ${shareLabel(x.shareBps)}` : ""}
                </span>
              </li>
            ))}
            {listing?.sellers === null && <li className="text-sm text-muted">Sellers are shown to sales roles.</li>}
          </ul>
        ) : (
          <PartyRows role="seller" rows={sellers} setRows={setSellers} inv={inv} err={err} max={10} />
        )}
      </FormSection>

      <FormSection
        title="Permit"
        lede="The advertising permit. Without a valid one the listing can't go live, and it comes down on the day after its last valid day."
      >
        <div className={S6}>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Permit number</span>
            <input
              className={INPUT}
              value={v.permitNo}
              onChange={set("permitNo")}
              maxLength={40}
              {...inv("permitNo")}
            />
            {err("permitNo")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Issued on</span>
            <input
              className={INPUT}
              type="date"
              value={v.permitIssuedOn}
              onChange={set("permitIssuedOn")}
              {...inv("permitIssuedOn")}
            />
            {err("permitIssuedOn")}
          </label>
          <label className={`${FIELD} ${W2}`}>
            <span className={LABEL}>Last valid day</span>
            <input
              className={INPUT}
              type="date"
              value={v.permitExpiresOn}
              onChange={set("permitExpiresOn")}
              {...inv("permitExpiresOn")}
            />
            {err("permitExpiresOn")}
          </label>
        </div>
      </FormSection>

      <FormSection title="Agent" lede="The page's contact.">
        <label className={`${FIELD} max-w-sm`}>
          <span className={LABEL}>Listing agent</span>
          <select className={INPUT} value={v.agentUserId} onChange={set("agentUserId")} {...inv("agentUserId")}>
            <option value="">Not set</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {err("agentUserId")}
        </label>
      </FormSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-5">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : mode === "new" ? "Create listing" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
