"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "../../../components/ui/empty-state";
import { Pill } from "../../../components/ui/pill";
import { Segmented } from "../../../components/ui/segmented";
import { PlanPlaceholder, Status } from "../../../components/ui";
import { aedShort, bedroomsLabel, stateLabel } from "../../../lib/format";
import { CATEGORIES } from "../../../lib/portfolio";
import type { CompanyRow, UnitRow } from "../../../lib/types";

export type UnitFilter = "all" | "PREP" | "READY" | "LISTED" | "OCCUPIED";
const FILTERS: UnitFilter[] = ["all", "PREP", "READY", "LISTED", "OCCUPIED"];
const FILTER_LABEL: Record<UnitFilter, string> = {
  all: "All",
  PREP: "Prep",
  READY: "Ready",
  LISTED: "Listed",
  OCCUPIED: "Occupied",
};

const SELECT =
  "h-9 max-w-[14rem] cursor-pointer rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * One toolbar: state filter with counts, company and category (applied as you choose), and search; then the photo
 * card grid. State, company and category are kept in the URL so a filtered view can be shared.
 */
export function UnitsBrowser({
  units,
  companies,
  initialState,
  initialCompany,
  initialCategory,
  addHref,
}: {
  units: UnitRow[];
  companies: CompanyRow[];
  initialState: UnitFilter;
  initialCompany: string;
  initialCategory: string;
  /** Set only when the user may add units. */
  addHref?: string;
}) {
  const [state, setState] = useState<UnitFilter>(initialState);
  const [company, setCompany] = useState(initialCompany);
  const [category, setCategory] = useState(initialCategory);
  const [q, setQ] = useState("");

  const scoped = useMemo(
    () => units.filter((u) => (!company || u.companyId === company) && (!category || u.category === category)),
    [units, company, category],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: scoped.length };
    for (const u of scoped) c[u.state] = (c[u.state] ?? 0) + 1;
    return c;
  }, [scoped]);
  const needle = q.trim().toLowerCase();
  const rows = scoped.filter(
    (u) =>
      (state === "all" || u.state === state) &&
      (!needle || [u.code, u.building, u.community, u.unitNo ?? ""].some((s) => s.toLowerCase().includes(needle))),
  );

  const keep = (key: string, value: string) => {
    const url = new URL(window.location.href);
    if (!value || value === "all") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <Segmented<UnitFilter>
          label="Filter units by state"
          value={state}
          onChange={(s) => {
            setState(s);
            keep("state", s);
          }}
          options={FILTERS.map((s) => ({ value: s, label: `${FILTER_LABEL[s]} ${counts[s] ?? 0}` }))}
        />
        <label className="flex items-center">
          <span className="sr-only">Company</span>
          <select
            className={SELECT}
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              keep("company", e.target.value);
            }}
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center">
          <span className="sr-only">Category</span>
          <select
            className={SELECT}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              keep("category", e.target.value);
            }}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="relative flex min-w-[220px] flex-1 basis-60 items-center sm:max-w-sm">
          <span className="sr-only">Search units</span>
          <MagnifyingGlassIcon size={16} aria-hidden className="pointer-events-none absolute left-3.5 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code, building, community"
            className="h-9 w-full rounded-full border border-line bg-page pl-9 pr-3.5 font-sans text-sm text-ink placeholder:text-muted hover:border-ink focus:border-ink"
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={units.length ? "No units match" : "No units yet"}
          body={
            units.length
              ? "Try another state or filter, or clear the search."
              : "Add a unit with its DLD, Makani and DEWA numbers, photos and asking rent."
          }
          action={
            addHref && !units.length ? (
              <Link href={addHref} className="font-semibold text-ink! underline">
                Add the first unit
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-5 gap-y-7 p-0">
          {rows.map((u) => (
            <li key={u.id}>
              <Link
                href={`/units/${u.id}`}
                className="group grid gap-3 text-ink! no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
              >
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-line bg-raised">
                  {u.coverPhotoId ? (
                    <img
                      src={`/media/units/${u.id}/${u.coverPhotoId}`}
                      alt={`Unit ${u.code}`}
                      loading="lazy"
                      width={520}
                      height={390}
                      className="block h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  ) : (
                    <PlanPlaceholder bedrooms={u.bedrooms} label="No photos yet" />
                  )}
                  {u.photoCount > 1 && (
                    <span className="absolute bottom-2.5 right-2.5 rounded-full bg-page/90 px-2 py-0.5 font-sans text-xs font-semibold text-ink">
                      {u.photoCount} photos
                    </span>
                  )}
                </div>
                <div className="grid gap-0.5 font-sans">
                  <div className="flex items-center justify-between gap-2">
                    <b className="min-w-0 truncate text-[15px] font-semibold group-hover:underline">{u.code}</b>
                    <Status value={u.state} />
                  </div>
                  <span className="text-[13px] text-muted">
                    {u.building}, {u.community}
                  </span>
                  <span className="text-[13px] text-muted">
                    {[
                      bedroomsLabel(u.bedrooms),
                      u.areaSqft ? `${u.areaSqft.toLocaleString("en-US")} sq ft` : null,
                      u.furnished === null ? null : u.furnished ? "Furnished" : "Unfurnished",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="text-[13px] text-muted">
                    {u.lease ? (
                      <>
                        <b className="font-semibold text-ink">{aedShort(u.lease.annualRentFils)}</b> / yr, let
                      </>
                    ) : u.askingRentFils ? (
                      <>
                        <b className="font-semibold text-ink">{aedShort(u.askingRentFils)}</b> / yr
                      </>
                    ) : (
                      "No price yet"
                    )}
                  </span>
                  {u.lease && (
                    <span className="mt-1">
                      <Pill tone="neutral">
                        Lease {u.lease.ref}, {stateLabel(u.lease.state).toLowerCase()}
                      </Pill>
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
