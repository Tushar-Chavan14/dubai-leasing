"use client";

import { PlusIcon, RowsIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { buttonClass } from "@platform/ui/button";
import { StaffUnitCard } from "@platform/ui/catalogue/staff-unit-card";
import { EmptyState } from "@platform/ui/empty-state";
import { PlanPlaceholder } from "@platform/ui/media/plan-placeholder";
import { Pill } from "@platform/ui/pill";
import { Segmented } from "@platform/ui/segmented";
import { UNIT_TYPES } from "@spa/core";
import Link from "next/link";
import { useRef, useState } from "react";
import type { ListingRowView, ListingStateKey, ListingsPage } from "../lib/contracts";
import { formatMoneyFils, shortDate } from "../lib/format";
import { mediaSrc } from "../lib/media";
import { bedsLabel, bedsShort, LISTING_STATE_LABEL, sqft, typeLabel, UNIT_TYPE_LABEL } from "../lib/words";
import { ListingTable } from "./listings";

/** The values a filtered address carries, as the filter bar shows them (text, as typed). */
export interface ListingFilters {
  scope?: string;
  state?: string;
  community?: string;
  type?: string;
  beds?: string;
  min?: string;
  max?: string;
  agent?: string;
}

const SELECT =
  "h-[42px] max-w-[14rem] cursor-pointer rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const FIELD =
  "h-[42px] rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink placeholder:text-muted hover:border-ink focus:border-ink";

const STATE_ORDER: readonly ListingStateKey[] = [
  "DRAFT",
  "VERIFIED",
  "ACTIVE",
  "PUBLISHED",
  "UNDER_OFFER",
  "SOLD",
  "WITHDRAWN",
];
const facts = (l: ListingRowView) =>
  [bedsLabel(l.bedrooms), typeLabel(l.unitType), sqft(l.sizeSqft), l.view].filter((x): x is string => !!x);
const STATE_TONE = {
  PUBLISHED: "accent",
  UNDER_OFFER: "waiting",
  WITHDRAWN: "danger",
} as const;
const dayMonth = (d: string) => shortDate(d).replace(/ \d{4}$/, "");

/** The permit as a chip: warning from seven days before its last valid day, danger once it has passed. */
export function PermitChip({ permit }: { permit: ListingRowView["permit"] }) {
  if (permit.status === "none" || !permit.expiresOn) return <Pill tone="neutral">No permit</Pill>;
  const day = dayMonth(permit.expiresOn);
  if (permit.status === "expired") return <Pill tone="danger">Permit ended {day}</Pill>;
  return <Pill tone={permit.status === "expiring" ? "warning" : "neutral"}>Permit ends {day}</Pill>;
}

/**
 * The Listings screen (S77), the same look as the Units tab of Inventory: a search-free toolbar, status chips with their
 * counts, filters that live in the address (a GET form, so a filtered view can be shared and the engine filters), then
 * a card grid with a list view. Only the sales roles get "New listing".
 */
export function ListingsBrowser({
  page,
  filters,
  canAdd,
  nextHref,
}: {
  page: ListingsPage;
  filters: ListingFilters;
  canAdd: boolean;
  nextHref: string | null;
}) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [state, setState] = useState(filters.state ?? "");
  const form = useRef<HTMLFormElement>(null);
  const filtered = Object.entries(filters).some(([k, v]) => k !== "scope" && v);
  const counts = page.facets.states;
  const total = STATE_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0);
  /** Goes to the filtered address with the form's own values; an empty field is left out of the address. */
  const go = (override: { state?: string } = {}) => {
    const f = form.current;
    if (!f) return;
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(f)) if (typeof v === "string" && v.trim() && k !== "state") q.set(k, v.trim());
    const st = override.state ?? state;
    if (st) q.set("state", st);
    window.location.assign(`/listings${q.size ? `?${q}` : ""}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <form
        ref={form}
        method="get"
        action="/listings"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="grid gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<string>
            label="Whose listings"
            value={filters.scope === "mine" ? "mine" : ""}
            onChange={(v) => {
              const q = new URLSearchParams(window.location.search);
              if (v) q.set("scope", v);
              else q.delete("scope");
              window.location.assign(`/listings${q.size ? `?${q}` : ""}`);
            }}
            options={[
              { value: "", label: "All listings" },
              { value: "mine", label: "Mine" },
            ]}
          />
          {filters.scope === "mine" && <input type="hidden" name="scope" value="mine" />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Layout" className="inline-flex rounded-full border border-line bg-page p-1">
              {(
                [
                  ["grid", "Grid", SquaresFourIcon],
                  ["list", "List", RowsIcon],
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  aria-label={`${label} view`}
                  onClick={() => setView(v)}
                  className={`grid size-8 cursor-pointer place-items-center rounded-full border-0 ${view === v ? "bg-accent text-on-accent" : "bg-transparent text-muted hover:text-ink"}`}
                >
                  <Icon size={16} aria-hidden />
                </button>
              ))}
            </div>
            {canAdd && (
              <Link href="/listings/new" className={buttonClass("primary", "sm")}>
                <PlusIcon size={16} aria-hidden />
                New listing
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <Segmented<string>
            label="Filter listings by status"
            value={state}
            onChange={(v) => {
              setState(v);
              go({ state: v });
            }}
            options={[
              { value: "", label: `All ${total}` },
              ...STATE_ORDER.map((k) => ({ value: k, label: `${LISTING_STATE_LABEL[k]} ${counts[k] ?? 0}` })),
            ]}
          />
          <label className="flex items-center">
            <span className="sr-only">Community</span>
            <select name="community" defaultValue={filters.community ?? ""} onChange={() => go()} className={SELECT}>
              <option value="">All communities</option>
              {page.facets.communities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center">
            <span className="sr-only">Type</span>
            <select name="type" defaultValue={filters.type ?? ""} onChange={() => go()} className={SELECT}>
              <option value="">All types</option>
              {UNIT_TYPES.filter((t) => page.facets.types.includes(t)).map((t) => (
                <option key={t} value={t}>
                  {UNIT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center">
            <span className="sr-only">Bedrooms</span>
            <select name="beds" defaultValue={filters.beds ?? ""} onChange={() => go()} className={SELECT}>
              <option value="">Any bedrooms</option>
              {page.facets.beds.map((b) => (
                <option key={b} value={b}>
                  {bedsShort(b)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center">
            <span className="sr-only">Agent</span>
            <select name="agent" defaultValue={filters.agent ?? ""} onChange={() => go()} className={SELECT}>
              <option value="">All agents</option>
              {page.facets.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <details open={!!(filters.min || filters.max)} className="group">
            <summary className="flex h-[42px] cursor-pointer list-none items-center rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink hover:border-ink">
              Price band
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className="sr-only">Lowest asking price in dirhams</span>
              <input
                name="min"
                inputMode="numeric"
                defaultValue={filters.min ?? ""}
                placeholder="From AED"
                onBlur={() => go()}
                className={`${FIELD} w-32`}
              />
              to
              <span className="sr-only">Highest asking price in dirhams</span>
              <input
                name="max"
                inputMode="numeric"
                defaultValue={filters.max ?? ""}
                placeholder="To AED"
                onBlur={() => go()}
                className={`${FIELD} w-32`}
              />
            </div>
          </details>
          {filtered && (
            <Link href="/listings" className="text-[13px] font-semibold text-ink! underline">
              Clear filters
            </Link>
          )}
          <button type="submit" className="sr-only">
            Apply filters
          </button>
        </div>
      </form>

      {page.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No listings match" : "No listings yet"}
          body={
            filtered
              ? "Try other filters, or clear them."
              : canAdd
                ? "A listing appears here with its permit and offer once it is added. Use New listing to add the first."
                : "A listing appears here with its permit and offer once a sales officer adds it."
          }
        />
      ) : view === "grid" ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-5 gap-y-7 p-0">
          {page.items.map((l) => (
            <li
              key={l.id}
              className="min-w-0 [&>a]:grid-cols-[minmax(0,1fr)] [&>a>div]:min-w-0 [&>a>div]:grid-cols-[minmax(0,1fr)]"
            >
              <StaffUnitCard
                href={`/listings/${l.id}`}
                imageSrc={l.coverMediaId ? mediaSrc(l.coverMediaId) : undefined}
                imageAlt={l.title}
                placeholder={<PlanPlaceholder bedrooms={l.bedrooms} label="No photos yet" />}
                code={l.title}
                status={<Pill tone={STATE_TONE[l.state as keyof typeof STATE_TONE] ?? "neutral"}>{l.stateLabel}</Pill>}
                subtitle={[l.ref, l.community].filter(Boolean).join(" · ")}
                facts={facts(l).join(" · ") || "Details not set"}
                price={
                  l.askingPriceFils === null ? (
                    "No price yet"
                  ) : (
                    <b className="font-semibold text-ink">{formatMoneyFils(l.askingPriceFils)}</b>
                  )
                }
                chip={
                  <span className="flex flex-wrap gap-1.5">
                    <PermitChip permit={l.permit} />
                    {l.offer && (
                      <Pill tone={l.offer.state === "SENT" ? "waiting" : "neutral"}>
                        Offer {l.offer.label.toLowerCase()}
                      </Pill>
                    )}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <ListingTable listings={page.items} next={null} />
      )}
      {nextHref && (
        <div>
          <Link href={nextHref} className={buttonClass("ghost", "sm")}>
            Next page
          </Link>
        </div>
      )}
    </div>
  );
}
