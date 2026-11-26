import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { ROW_LINK, TabLinks, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Sub } from "@platform/ui/record";
import { SET_INPUT, SET_SELECT, TABLE, TD, TH } from "@platform/ui/settings";
import { LEAD_SOURCE_LABELS, LEAD_SOURCES, LEAD_STATUS_LABELS, LEAD_STATUSES } from "@spa/core";
import Link from "next/link";
import type { LeadRow, LeadsPage } from "../lib/contracts";
import { shortDate } from "../lib/format";
import { dubaiDay } from "../lib/viewing-slots";

const TONE: Record<string, "accent" | "success" | "warning" | "neutral" | "waiting"> = {
  new: "waiting",
  contacted: "neutral",
  viewing_booked: "accent",
  interested: "success",
  not_interested: "neutral",
  converted: "success",
  closed: "neutral",
};

export interface LeadFilters {
  status?: string | undefined;
  source?: string | undefined;
  property?: string | undefined;
}

/** Work -> Leads (S79): filters by status, source and home, Mine / All, and one row per lead. Reads only; the lead's page acts. */
export function LeadsTable({
  data,
  filters,
  mineHref,
  allHref,
}: {
  data: LeadsPage;
  filters: LeadFilters;
  mineHref: string;
  allHref: string;
}) {
  return (
    <div className="grid gap-3">
      {data.canSeeAll && (
        <TabLinks
          label="Whose leads"
          items={[
            { href: mineHref, label: "Mine", current: data.mineOnly },
            { href: allHref, label: "All", current: !data.mineOnly },
          ]}
        />
      )}
      <form action="/work" method="get" role="search" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="leads" />
        {data.canSeeAll && <input type="hidden" name="scope" value={data.mineOnly ? "mine" : "all"} />}
        <label className="grid gap-1 text-xs text-muted">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={`${SET_SELECT} w-44`}>
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Source
          <select name="source" defaultValue={filters.source ?? ""} className={`${SET_SELECT} w-44`}>
            <option value="">All sources</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Home
          <input
            type="search"
            name="property"
            defaultValue={filters.property ?? ""}
            maxLength={80}
            placeholder="Reference or title"
            className={`${SET_INPUT} w-56`}
          />
        </label>
        <button type="submit" className={buttonClass("ghost", "sm")}>
          Apply
        </button>
      </form>
      {!data.items.length ? (
        <EmptyState
          title="No leads."
          body="An enquiry or booking from a home's page, from the listing chat, or one you add appears here."
        />
      ) : (
        <TableFrame>
          <table className={TABLE}>
            <caption className="sr-only">Leads</caption>
            <thead>
              <tr>
                {["Ref", "Name", "Home", "Source", "Status", "Last message", "Agent", "Created"].map((c) => (
                  <th key={c} scope="col" className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((l: LeadRow) => (
                <tr key={l.id} className="align-top">
                  <td className={TD}>
                    <Link href={`/leads/${l.id}`} className={`${ROW_LINK} font-mono whitespace-nowrap tabular-nums`}>
                      {l.ref}
                    </Link>
                  </td>
                  <td className={TD}>
                    <span className="font-medium">{l.name}</span>
                    <Sub>{l.email}</Sub>
                  </td>
                  <td className={TD}>
                    <span className="font-mono whitespace-nowrap tabular-nums">{l.propertyRef}</span>
                    <Sub>{l.propertyTitle}</Sub>
                  </td>
                  <td className={TD}>{l.sourceLabel}</td>
                  <td className={TD}>
                    <Pill tone={TONE[l.status] ?? "neutral"}>{l.statusLabel}</Pill>
                  </td>
                  <td className={`${TD} max-w-[170px]`}>
                    <span className="line-clamp-2 text-sm text-muted">{l.lastMessage}</span>
                  </td>
                  <td className={TD}>{l.agentName ?? <span className="text-muted">Unassigned</span>}</td>
                  <td className={`${TD} whitespace-nowrap`}>{shortDate(dubaiDay(l.createdAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
