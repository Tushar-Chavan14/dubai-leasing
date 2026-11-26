"use client";

import { Finder } from "@platform/ui/catalogue/finder";
import { type Filters, PRICE_BANDS, bedsOption, toQuery, typeOption } from "../../lib/public-filters";

/**
 * The finder bar: Community, Type, Bedrooms and Price in one strip, and Search. It sets the same URL query the filter
 * chips do, so the page refetches from the engine and the link stays shareable. This module keeps the query keys: it
 * builds the href, the shared `Finder` only renders and navigates.
 */
export function CatalogueFinder({
  filters: f,
  communities,
  types,
  beds,
}: {
  filters: Filters;
  communities: string[];
  types: string[];
  /** Bedroom counts on offer (0 is a studio), already capped at 4. */
  beds: number[];
}) {
  const onSearch = (v: Record<string, string>) => {
    const next: Filters = {
      ...f,
      community: v.community || null,
      type: (types.includes(v.type ?? "") ? v.type : null) as Filters["type"],
      beds: v.beds ? Number(v.beds) : v.beds === "0" ? 0 : null,
      price: (PRICE_BANDS.find((b) => b.key === v.price)?.key ?? null) as Filters["price"],
    };
    const q = toQuery(next);
    return q ? `/properties?${q}#homes` : "/properties#homes";
  };
  return (
    <Finder
      // The form remounts when the URL filters change, so the selects always show what is applied.
      key={toQuery(f)}
      searchLabel="Search"
      ariaLabel="Find a home"
      onSearch={onSearch}
      fields={[
        {
          name: "community",
          label: "Community",
          anyLabel: "Any",
          value: f.community ?? "",
          options: communities.map((c) => ({ value: c, label: c })),
        },
        {
          name: "type",
          label: "Type",
          anyLabel: "Any",
          value: f.type ?? "",
          options: types.map((t) => ({ value: t, label: typeOption(t) })),
        },
        {
          name: "beds",
          label: "Bedrooms",
          anyLabel: "Any",
          value: f.beds === null ? "" : String(f.beds),
          options: beds.map((b) => ({ value: String(b), label: bedsOption(b) })),
        },
        {
          name: "price",
          label: "Price",
          anyLabel: "Any",
          value: f.price ?? "",
          options: PRICE_BANDS.map((b) => ({ value: b.key, label: b.label })),
        },
      ]}
    />
  );
}
