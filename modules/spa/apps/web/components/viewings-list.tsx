import { EmptyState } from "@platform/ui/empty-state";
import { ROW_LINK, TabLinks, TableFrame } from "@platform/ui/page";
import { Pill } from "@platform/ui/pill";
import { Sub } from "@platform/ui/record";
import { TABLE, TD, TH } from "@platform/ui/settings";
import Link from "next/link";
import type { ViewingRow, ViewingsPage } from "../lib/contracts";
import { viewingTimeLabel } from "../lib/viewing-slots";
import { ViewingActions } from "./lead-actions";

const TONE = { booked: "accent", attended: "success", no_show: "warning", cancelled: "neutral" } as const;
const WHEN = [
  ["today", "Today"],
  ["upcoming", "Upcoming"],
  ["past", "Past"],
] as const;

const propertyHref = (v: ViewingRow) =>
  v.propertyKind === "listing" ? `/listings/${v.propertyId}` : `/inventory/units/${v.propertyId}`;

/**
 * Work -> Viewings (S79): Today / Upcoming / Past, in Dubai time. A viewing that has started with no outcome says so and
 * offers "Record the outcome": nothing marks a no-show by itself.
 */
export function ViewingsList({
  data,
  base,
}: {
  data: ViewingsPage;
  base: (patch: { when?: string; scope?: string }) => string;
}) {
  return (
    <div className="grid gap-3">
      <TabLinks
        label="When"
        items={WHEN.map(([w, label]) => ({ href: base({ when: w }), label, current: data.when === w }))}
      />
      {data.canSeeAll && (
        <TabLinks
          label="Whose viewings"
          items={[
            { href: base({ scope: "mine" }), label: "Mine", current: data.mineOnly },
            { href: base({ scope: "all" }), label: "All", current: !data.mineOnly },
          ]}
        />
      )}
      {!data.items.length ? (
        <EmptyState
          title={
            data.when === "today"
              ? "No viewings today."
              : data.when === "upcoming"
                ? "No upcoming viewings."
                : "No past viewings."
          }
          body="Viewings booked on the public site, by chat or by you appear here."
        />
      ) : (
        <TableFrame>
          <table className={TABLE}>
            <caption className="sr-only">Viewings, {data.when}</caption>
            <thead>
              <tr>
                {["Time (Dubai)", "Home", "Visitor", "Agent", "Status", ""].map((c, i) => (
                  <th key={i} scope="col" className={TH}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => (
                <tr key={v.id} className="align-top">
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>
                    {viewingTimeLabel(v.startsAt).replace(" (Dubai)", "")}
                  </td>
                  <td className={TD}>
                    <Link href={propertyHref(v)} className={`${ROW_LINK} font-mono whitespace-nowrap tabular-nums`}>
                      {v.propertyRef}
                    </Link>
                    <Sub>{v.propertyTitle}</Sub>
                  </td>
                  <td className={TD}>
                    <Link href={`/leads/${v.leadId}`} className={ROW_LINK}>
                      {v.visitorName}
                    </Link>
                    <Sub>{v.leadRef}</Sub>
                  </td>
                  <td className={TD}>{v.agentName ?? <span className="text-muted">Unassigned</span>}</td>
                  <td className={TD}>
                    <Pill tone={v.needsOutcome ? "waiting" : TONE[v.status]}>
                      {v.needsOutcome ? "Needs an outcome" : v.statusLabel}
                    </Pill>
                    {v.outcomeNote && <Sub>{v.outcomeNote}</Sub>}
                    {v.cancelReason && <Sub>{v.cancelReason}</Sub>}
                  </td>
                  <td className={TD}>
                    <ViewingActions
                      viewingId={v.id}
                      leadId={v.leadId}
                      needsOutcome={v.needsOutcome}
                      canChange={v.canChange}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
