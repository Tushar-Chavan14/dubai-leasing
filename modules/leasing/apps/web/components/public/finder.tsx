"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { type SubmitEvent, useId } from "react";
import { type GridFilters, applyChip, toQuery } from "../../lib/grid-filters";

const SELECT =
  "w-full cursor-pointer appearance-none border-0 bg-transparent p-0 pr-5 font-sans text-sm font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink";

/**
 * The finder bar on the grid: Area, Bedrooms and Budget in one rounded strip, and Search. It sets the same URL query
 * the filter chips do, so the page refetches from the engine and the link stays shareable.
 */
export function Finder({
  filters: f,
  communities,
  beds,
  budgets,
  labels,
}: {
  filters: GridFilters;
  communities: string[];
  /** Bedroom counts offered (0 is a studio), already capped at 4. */
  beds: { value: number; label: string }[];
  /** Budget steps in whole AED. */
  budgets: { value: number; label: string }[];
  labels: {
    area: string;
    anyArea: string;
    beds: string;
    anyBeds: string;
    budget: string;
    anyBudget: string;
    search: string;
  };
}) {
  const router = useRouter();
  const id = useId();
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const area = String(d.get("area") ?? "");
    const bedsV = String(d.get("beds") ?? "");
    const budget = String(d.get("budget") ?? "");
    let next: GridFilters = {
      ...f,
      community: area || null,
      maxRentFils: budget ? Number(budget) * 100 : null,
    };
    next = bedsV === "" ? { ...next, bedrooms: null } : applyChip(next, { kind: "bedrooms", bedrooms: Number(bedsV) });
    const q = toQuery(next);
    router.push(q ? `/customer/properties?${q}#homes` : "/customer/properties#homes", { scroll: false });
  };
  const cell = "relative grid gap-0.5 px-4 py-2.5 text-xs text-muted sm:border-r sm:border-line";
  const caret = (
    <CaretDownIcon
      size={14}
      aria-hidden="true"
      className="pointer-events-none absolute right-4 bottom-3.5 text-muted sm:right-3.5"
    />
  );
  return (
    <form
      onSubmit={submit}
      aria-label="Find a home"
      // The form remounts when the URL filters change, so the selects always show what is applied.
      key={toQuery(f)}
      className="mt-6 grid w-full overflow-hidden rounded-[18px] border border-line bg-page sm:grid-cols-[1fr_1fr_1fr_auto]"
    >
      <label className={`${cell} border-b border-line sm:border-b-0`} htmlFor={`${id}-area`}>
        {labels.area}
        <select id={`${id}-area`} name="area" defaultValue={f.community ?? ""} className={SELECT}>
          <option value="">{labels.anyArea}</option>
          {communities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {caret}
      </label>
      <label className={`${cell} border-b border-line sm:border-b-0`} htmlFor={`${id}-beds`}>
        {labels.beds}
        <select
          id={`${id}-beds`}
          name="beds"
          defaultValue={f.bedrooms === null ? "" : String(f.bedrooms)}
          className={SELECT}
        >
          <option value="">{labels.anyBeds}</option>
          {beds.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        {caret}
      </label>
      <label className={`${cell} border-b border-line sm:border-b-0`} htmlFor={`${id}-budget`}>
        {labels.budget}
        <select
          id={`${id}-budget`}
          name="budget"
          defaultValue={f.maxRentFils === null ? "" : String(Math.round(f.maxRentFils / 100))}
          className={SELECT}
        >
          <option value="">{labels.anyBudget}</option>
          {budgets.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
        {caret}
      </label>
      <button
        type="submit"
        className="min-h-12 cursor-pointer border-0 bg-primary px-7 font-sans text-sm font-semibold text-on-primary focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"
      >
        {labels.search}
      </button>
    </form>
  );
}
