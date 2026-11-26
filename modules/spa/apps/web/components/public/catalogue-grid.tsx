import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { buttonClass } from "@platform/ui/button";
import { HeroPanel } from "@platform/ui/catalogue/hero-panel";
import { PropertyCard } from "@platform/ui/catalogue/property-card";
import { Cover } from "@platform/ui/media/cover";
import type { PublicProperty } from "@spa/core";
import Link from "next/link";
import {
  type Filters,
  SORTS,
  SOURCES,
  aed,
  cardFacts,
  isActive,
  photoSrc,
  placeLine,
  toQuery,
} from "../../lib/public-filters";
import { CatalogueFinder } from "./catalogue-finder";

const href = (f: Filters) => {
  const q = toQuery(f);
  return q ? `/properties?${q}` : "/properties";
};

/**
 * The catalogue: hero with the finder, filter chips and the grid of cards (the same screen as leasing's property grid).
 * `options` is every public home (where the choices come from); `items` is the filtered list.
 */
export function CatalogueGrid({
  options,
  items,
  communities,
  types,
  loadFailed,
  filters: f,
}: {
  options: PublicProperty[];
  items: PublicProperty[];
  communities: string[];
  types: string[];
  loadFailed: boolean;
  filters: Filters;
}) {
  const beds = [
    ...new Set(
      options
        .map((p) => p.bedrooms)
        .filter((b): b is number => b !== null)
        .map((b) => Math.min(b, 4)),
    ),
  ].toSorted((a, b) => a - b);
  const chip = (label: string, on: boolean, next: Filters) => (
    <Link
      key={label}
      href={href(next)}
      aria-current={on ? "true" : undefined}
      scroll={false}
      className={`inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${on ? "border-transparent bg-accent font-semibold text-on-accent!" : "border-line text-ink! hover:bg-raised"}`}
    >
      {on && <CheckIcon size={12} weight="bold" aria-hidden="true" />}
      {label}
    </Link>
  );
  const heroPhoto = photoSrc(
    items.find((p) => p.coverPhotoId)?.coverPhotoId ?? options.find((p) => p.coverPhotoId)?.coverPhotoId,
  );
  const cheapest = options.length ? options.reduce((m, p) => (p.priceFils < m.priceFils ? p : m)) : undefined;
  const showFilters = !loadFailed && options.length > 0;
  const sources = [
    chip("All", f.source === null, { ...f, source: null }),
    ...SOURCES.map((s) => chip(s.label, f.source === s.key, { ...f, source: s.key })),
  ];

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-10 md:px-8">
      <header className="grid items-center gap-8 py-8 md:grid-cols-[1.05fr_1fr] md:gap-10 md:py-12">
        <div className="grid justify-items-start">
          <h1 className="m-0 max-w-[16ch] text-[40px] leading-[1.04] font-semibold tracking-[-0.035em] text-balance md:text-[52px]">
            Homes for sale in Dubai
          </h1>
          <p className="mt-4! mb-0 max-w-[46ch] text-base text-muted md:text-[17px]">
            Resale homes from licensed brokers and new homes straight from the developer, each with its price in
            dirhams.
          </p>
          {showFilters && <CatalogueFinder filters={f} communities={communities} types={types} beds={beds} />}
        </div>
        <div className="hidden aspect-[4/3] max-h-[380px] overflow-hidden rounded-[22px] bg-raised md:block md:w-full">
          {heroPhoto ? (
            <Cover name="" src={heroPhoto} alt="" label={false} />
          ) : (
            <HeroPanel
              count={options.length}
              from={cheapest ? aed(cheapest.priceFils) : undefined}
              areas={communities.length}
              labels={{
                headline: "Homes for sale across Dubai",
                count: "On the market",
                one: "home",
                many: "homes",
                areas: "in {n} areas",
                from: "Prices from",
                per: "",
              }}
            />
          )}
        </div>
      </header>

      <section id="homes" aria-label="Properties for sale" className="scroll-mt-24">
        {showFilters && (
          <nav className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3" aria-label="Filters">
            <div className="flex flex-wrap items-center gap-2">{sources}</div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <p className="m-0" role="status">
                {items.length === 1 ? "1 home" : `${items.length} homes`}
              </p>
              <span className="flex flex-wrap items-center gap-1">
                {SORTS.map((s) => chip(s.label, f.sort === s.key, { ...f, sort: s.key }))}
              </span>
              {isActive(f) && (
                <Link href="/properties#homes" className="text-ink! underline underline-offset-4" scroll={false}>
                  Clear filters
                </Link>
              )}
            </div>
          </nav>
        )}

        {loadFailed ? (
          <p className="py-8 text-base text-muted" role="alert">
            Homes couldn&apos;t be loaded. Try again in a moment.
          </p>
        ) : options.length === 0 ? (
          <p className="py-8 text-base text-muted">No homes are on the market right now. Please check back soon.</p>
        ) : items.length === 0 ? (
          <div className="grid justify-items-start gap-4 rounded-card border border-line bg-raised p-6 text-base text-muted">
            <p className="m-0">No homes match these filters</p>
            <Link href="/properties#homes" className={buttonClass("ghost", "sm")}>
              Clear filters
            </Link>
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-x-5 gap-y-9 p-0 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {items.map((p) => (
              <li key={p.ref}>
                <Card p={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ p }: { p: PublicProperty }) {
  return (
    <PropertyCard
      href={`/properties/${encodeURIComponent(p.ref)}`}
      name={p.title}
      src={photoSrc(p.coverPhotoId)}
      title={p.title}
      subtitle={placeLine(p)}
      facts={cardFacts(p)}
      price={aed(p.priceFils)}
      {...(p.source === "developer" ? { badge: `New · ${p.developerName ?? "Developer"}` } : {})}
      footer={p.permitNo ? <span className="text-xs text-muted tabular-nums">Permit {p.permitNo}</span> : undefined}
    />
  );
}
