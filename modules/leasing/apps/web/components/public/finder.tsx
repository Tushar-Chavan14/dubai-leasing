"use client";

import { Finder as PlatformFinder } from "@platform/ui/catalogue/finder";
import { type GridFilters, applyChip, toQuery } from "../../lib/grid-filters";

/**
 * The finder bar on the grid: Area, Bedrooms and Budget in one rounded strip, and Search. It sets the same URL query
 * the filter chips do, so the page refetches from the engine and the link stays shareable. Leasing keeps the query
 * keys: it builds the href, the shared `Finder` only renders and navigates.
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
  const onSearch = (v: Record<string, string>) => {
    const area = v.area ?? "";
    const bedsV = v.beds ?? "";
    const budget = v.budget ?? "";
    let next: GridFilters = {
      ...f,
      community: area || null,
      maxRentFils: budget ? Number(budget) * 100 : null,
    };
    next = bedsV === "" ? { ...next, bedrooms: null } : applyChip(next, { kind: "bedrooms", bedrooms: Number(bedsV) });
    const q = toQuery(next);
    return q ? `/customer/properties?${q}#homes` : "/customer/properties#homes";
  };
  return (
    <PlatformFinder
      // The form remounts when the URL filters change, so the selects always show what is applied.
      key={toQuery(f)}
      searchLabel={labels.search}
      onSearch={onSearch}
      fields={[
        {
          name: "area",
          label: labels.area,
          anyLabel: labels.anyArea,
          value: f.community ?? "",
          options: communities.map((c) => ({ value: c, label: c })),
        },
        {
          name: "beds",
          label: labels.beds,
          anyLabel: labels.anyBeds,
          value: f.bedrooms === null ? "" : String(f.bedrooms),
          options: beds.map((b) => ({ value: String(b.value), label: b.label })),
        },
        {
          name: "budget",
          label: labels.budget,
          anyLabel: labels.anyBudget,
          value: f.maxRentFils === null ? "" : String(Math.round(f.maxRentFils / 100)),
          options: budgets.map((b) => ({ value: String(b.value), label: b.label })),
        },
      ]}
    />
  );
}
