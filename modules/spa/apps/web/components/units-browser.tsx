"use client";

import { MagnifyingGlassIcon, PlusIcon, RowsIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { buttonClass } from "@platform/ui/button";
import { StaffUnitCard } from "@platform/ui/catalogue/staff-unit-card";
import { EmptyState } from "@platform/ui/empty-state";
import { PlanPlaceholder } from "@platform/ui/media/plan-placeholder";
import { Segmented } from "@platform/ui/segmented";
import { ROW_LINK, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Sub } from "@platform/ui/record";
import { TABLE, TD, TH } from "@platform/ui/settings";
import { UNIT_TYPES } from "@spa/core";
import Link from "next/link";
import { useRef, useState } from "react";
import type { UnitRow, UnitsPage } from "../lib/contracts";
import { formatMoneyFils } from "../lib/format";
import { mediaSrc } from "../lib/media";
import { bedsLabel, bedsShort, sqft, typeLabel, UNIT_STATE_LABEL, UNIT_TYPE_LABEL } from "../lib/words";

/** The values a filtered address carries, as the filter bar shows them (text, as typed). */
export interface UnitFilters {
  project?: string;
  type?: string;
  beds?: string;
  state?: string;
  min?: string;
  max?: string;
  q?: string;
}

const SELECT =
  "h-[42px] max-w-[14rem] cursor-pointer rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const FIELD =
  "h-[42px] rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink placeholder:text-muted hover:border-ink focus:border-ink";

const subtitle = (u: UnitRow) => [u.project?.name, u.building?.name].filter(Boolean).join(", ");
const facts = (u: UnitRow) =>
  [bedsLabel(u.bedrooms), typeLabel(u.type), sqft(u.internalSqft), u.view].filter((x): x is string => !!x);
const STATE_ORDER = ["AVAILABLE", "HELD", "SOLD", "REGISTERED", "HANDED_OVER"] as const;
const price = (u: UnitRow) => (u.priceFils === null ? "No price" : formatMoneyFils(u.priceFils));

/**
 * The Units tab of Inventory (S75), the same look as leasing's Units: one toolbar (search, filters), then a card grid
 * with a list view. The filters live in the address: a GET form, so a filtered view can be shared and the engine does the
 * filtering (a value it doesn't understand is dropped there). Only an admin gets "New unit".
 */
export function UnitsBrowser({
  page,
  filters,
  canWork,
  canAdd,
  nextHref,
  scope,
}: {
  page: UnitsPage;
  filters: UnitFilters;
  /** A role with a Work screen can open the deal; the others see its ref. */
  canWork: boolean;
  canAdd: boolean;
  /** The address of the next page with the same filters, or null on the last one. */
  nextHref: string | null;
  /** On a project page the list is that project's: no project filter, and the form stays on that page. */
  scope?: { projectId: string; action: string };
}) {
  const [view, setView] = useState<"grid" | "list">("grid");
  const [state, setState] = useState(filters.state ?? "");
  const form = useRef<HTMLFormElement>(null);
  const filtered = Object.values(filters).some(Boolean);
  const counts = page.facets.states;
  const total = STATE_ORDER.reduce((n, k) => n + (counts[k] ?? 0), 0);
  /** Goes to the filtered address with the form's own values; an empty field is left out of the address. */
  const go = (override: { state?: string } = {}) => {
    const f = form.current;
    if (!f) return;
    const [path = "", hash = ""] = f.action.replace(window.location.origin, "").split("#");
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(f)) if (typeof v === "string" && v.trim() && k !== "state") q.set(k, v.trim());
    const st = override.state ?? state;
    if (st) q.set("state", st);
    window.location.assign(`${path}${q.size ? `?${q}` : ""}${hash ? `#${hash}` : ""}`);
  };
  const dealLink = (u: UnitRow) =>
    u.openDeal ? (
      canWork ? (
        <Link href={`/work/deals/${u.openDeal.id}`} className={`${ROW_LINK} font-mono tabular-nums`}>
          {u.openDeal.ref}
        </Link>
      ) : (
        <span className="font-mono tabular-nums">{u.openDeal.ref}</span>
      )
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <form
        ref={form}
        method="get"
        action={scope?.action ?? "/inventory"}
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="grid gap-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex min-w-[220px] flex-1 items-center sm:max-w-md">
            <span className="sr-only">Search units</span>
            <MagnifyingGlassIcon size={16} aria-hidden className="pointer-events-none absolute left-3.5 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              maxLength={40}
              placeholder="Search by unit code"
              className={`${FIELD} w-full pl-9`}
            />
          </label>
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
              <Link
                href={scope ? `/inventory/units/new?project=${scope.projectId}` : "/inventory/units/new"}
                className={buttonClass("primary", "sm")}
              >
                <PlusIcon size={16} aria-hidden />
                New unit
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <Segmented<string>
            label="Filter units by status"
            value={state}
            onChange={(v) => {
              setState(v);
              go({ state: v });
            }}
            options={[
              { value: "", label: `All ${total}` },
              ...STATE_ORDER.map((k) => ({ value: k, label: `${UNIT_STATE_LABEL[k]} ${counts[k] ?? 0}` })),
            ]}
          />
          {!scope && (
            <label className="flex items-center">
              <span className="sr-only">Project</span>
              <select name="project" defaultValue={filters.project ?? ""} onChange={() => go()} className={SELECT}>
                <option value="">All projects</option>
                {page.facets.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
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
          <details open={!!(filters.min || filters.max)} className="group">
            <summary className="flex h-[42px] cursor-pointer list-none items-center rounded-full border border-line bg-page px-3.5 font-sans text-sm text-ink hover:border-ink">
              More filters
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className="sr-only">Lowest price in dirhams</span>
              <input
                name="min"
                inputMode="numeric"
                defaultValue={filters.min ?? ""}
                placeholder="From AED"
                onBlur={() => go()}
                className={`${FIELD} w-32`}
              />
              to
              <span className="sr-only">Highest price in dirhams</span>
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
            <Link href={scope?.action ?? "/inventory"} className="text-[13px] font-semibold text-ink! underline">
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
          title={filtered ? "No units match" : "No units yet"}
          body={
            filtered
              ? "Try other filters, or clear them."
              : "A unit belongs to a building of a project. An admin adds the project first, then its units."
          }
        />
      ) : view === "grid" ? (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-5 gap-y-7 p-0">
          {page.items.map((u) => (
            <li key={u.id}>
              <StaffUnitCard
                href={`/inventory/units/${u.id}`}
                imageSrc={u.coverMediaId ? mediaSrc(u.coverMediaId) : undefined}
                imageAlt={`Unit ${u.code}`}
                placeholder={<PlanPlaceholder bedrooms={u.bedrooms} label="No photos yet" />}
                code={u.code}
                status={
                  <Pill tone={u.state === "AVAILABLE" ? "neutral" : u.state === "HELD" ? "waiting" : "accent"}>
                    {UNIT_STATE_LABEL[u.state]}
                  </Pill>
                }
                subtitle={subtitle(u) || "Not in a project yet"}
                facts={facts(u).join(" · ") || "Details not set"}
                price={
                  u.priceFils === null ? (
                    "No price yet"
                  ) : (
                    <b className="font-semibold text-ink">{formatMoneyFils(u.priceFils)}</b>
                  )
                }
                chip={
                  u.openDeal ? (
                    <Pill tone="neutral">
                      Deal {u.openDeal.ref}
                      {u.openDeal.stageLabel ? ` · ${u.openDeal.stageLabel}` : ""}
                    </Pill>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <TableFrame>
          <table className={TABLE}>
            <caption className="sr-only">Units</caption>
            <thead>
              <tr>
                {["Unit", "Project", "Layout", "Status", "Price", "Deal"].map((c) => (
                  <th key={c} scope="col" className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.items.map((u) => (
                <tr key={u.id} className="group">
                  <td className={TD}>
                    <Link href={`/inventory/units/${u.id}`} className={`${ROW_LINK} font-mono tabular-nums`}>
                      {u.code}
                    </Link>
                  </td>
                  <td className={TD}>{subtitle(u) || <span className="text-muted">Not in a project</span>}</td>
                  <td className={TD}>
                    {facts(u).slice(0, 2).join(" · ") || <span className="text-muted">Not set</span>}
                    {u.internalSqft ? <Sub>{sqft(u.internalSqft)}</Sub> : null}
                  </td>
                  <td className={TD}>
                    <Pill tone={u.state === "AVAILABLE" ? "neutral" : u.state === "HELD" ? "waiting" : "accent"}>
                      {UNIT_STATE_LABEL[u.state]}
                    </Pill>
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{price(u)}</td>
                  <td className={TD}>{dealLink(u) ?? <span className="text-muted">None</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
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
