import { Pill } from "@platform/ui/pill";
import { Sub } from "@platform/ui/record";
import { EmptyState } from "@platform/ui/empty-state";
import { TABLE, TD, TH } from "@platform/ui/settings";
import { ROW_LINK, TableFrame } from "@platform/ui/page";
import type { SpaRole } from "@spa/core";
import Link from "next/link";
import type { DealRowView } from "../lib/contracts";
import { ageLabel, formatMoneyFils } from "../lib/format";
import { waitingParts } from "../lib/work";
import { StateBadge } from "./state-badge";

const COLUMNS = ["Ref", "Property", "Parties", "Type", "Stage", "Waiting for", "Owner", "Age"];

/** The Work list's deals (design §4.2): one row is one deal, the second line in `Sub`. Read only. */
export function DealTable({
  deals,
  next,
  viewer,
}: {
  deals: DealRowView[];
  next: { href: string } | null;
  viewer: SpaRole;
}) {
  if (!deals.length)
    return (
      <EmptyState
        title="No deals match."
        body="Clear a filter or the search to see more. A new deal appears here as soon as an offer is accepted."
      />
    );
  return (
    <div className="grid gap-3">
      <TableFrame>
        <table className={TABLE}>
          <caption className="sr-only">Deals</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className={TH}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => {
              const w = waitingParts(d.waitingFor, viewer);
              return (
                <tr key={d.id} className="group">
                  <td className={TD}>
                    <Link href={`/work/deals/${d.id}`} className={`${ROW_LINK} font-mono tabular-nums`}>
                      {d.ref}
                    </Link>
                  </td>
                  <td className={TD}>
                    {d.property.label}
                    <Sub>{formatMoneyFils(d.priceFils)}</Sub>
                  </td>
                  <td className={`${TD} min-w-[220px]`}>
                    {d.sellers.join(", ")} → {d.buyers.join(", ")}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>{d.typeLabel}</td>
                  <td className={TD}>
                    <span className="flex flex-wrap gap-1">
                      <StateBadge stage={d.stage} label={d.stageLabel} />
                      {d.inDefault && <Pill tone="danger">In default</Pill>}
                    </span>
                  </td>
                  <td className={TD}>
                    {w ? (
                      <>
                        {w.mine ? (
                          <Pill tone="waiting">Waiting for you</Pill>
                        ) : (
                          <Pill tone={d.onHold ? "warning" : "neutral"}>{w.headline}</Pill>
                        )}
                        <Sub>{[w.mine ? w.headline : w.who, ageLabel(w.days)].filter(Boolean).join(" · ")}</Sub>
                      </>
                    ) : (
                      <span className="text-muted">Nobody</span>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {d.owner?.label ?? <span className="text-muted">Not set</span>}
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{ageLabel(d.ageDays)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
      {next && (
        <Link href={next.href} className="w-fit text-[13px] text-ink underline underline-offset-2">
          Next page
        </Link>
      )}
    </div>
  );
}
