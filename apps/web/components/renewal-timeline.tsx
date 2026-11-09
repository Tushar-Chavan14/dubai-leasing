import type { CalendarDate } from "@leasing/core";
import { diffDays } from "@leasing/core";
import { MILESTONE_SHORT, milestoneId, milestoneLabel, shortDate } from "../lib/format";

interface Deadline {
  id: string;
  milestone: string;
  dueOn: string;
  status: string;
}

const LEGAL = new Set(["notice_deadline"]);
const SLOTS = ["above", "below", "above t2", "below t2"] as const;

/**
 * The renewal path of one term on a single track: milestones from the landlord question to the
 * lease end, today's position, and the renewal window (T−5 months to the legal T−90 deadline).
 */
export function RenewalTimeline({
  deadlines,
  startOn,
  endOn,
  today,
}: {
  deadlines: Deadline[];
  startOn: string;
  endOn: string;
  today: string;
}) {
  const term = deadlines
    .filter((d) => d.milestone.endsWith(`@${endOn}`))
    .toSorted((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  if (term.length === 0) return null;
  const from = term[0]!.dueOn < startOn ? term[0]!.dueOn : startOn;
  const span = Math.max(1, diffDays(from as CalendarDate, endOn as CalendarDate));
  const pos = (d: string) =>
    Math.min(100, Math.max(0, (diffDays(from as CalendarDate, d as CalendarDate) / span) * 100));

  const todayPos = today >= from && today <= endOn ? pos(today) : null;
  // Place each label (and the Today marker) in the first tier where it doesn't collide with the
  // previous label in that tier.
  const lastInSlot = new Map<string, number>();
  const take = (p: number) => {
    const slot = SLOTS.find((s) => (lastInSlot.get(s) ?? -100) <= p - 11) ?? "above";
    lastInSlot.set(slot, p);
    return slot;
  };
  const items = [
    ...term.map((d) => ({ kind: "ms" as const, d, p: pos(d.dueOn) })),
    ...(todayPos !== null ? [{ kind: "today" as const, p: todayPos }] : []),
  ].toSorted((a, b) => a.p - b.p || (a.kind === "today" ? -1 : 1));
  const placed = items.map((it) => ({ ...it, slot: take(it.p) }));
  const assess = term.find((d) => milestoneId(d.milestone) === "renewal_assess");
  const legal = term.find((d) => milestoneId(d.milestone) === "notice_deadline");
  const twoTier = placed.some((x) => x.slot.includes("t2"));

  const LABEL =
    "absolute -ml-14 w-28 text-center text-xs leading-tight text-muted max-sm:-ml-[35px] max-sm:w-[70px] max-sm:text-[11px] max-sm:[&>span]:hidden";
  const LABEL_B = "block text-[12.5px] font-semibold text-ink";
  const KEY_DOT = "size-2.5 rounded-full";
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div
        className="overflow-x-clip px-7 pt-5 pb-4 max-sm:px-3.5"
        role="img"
        aria-label={`Renewal milestones for the term ending ${shortDate(endOn)}`}
      >
        <div
          className="relative mx-1 h-1 rounded-sm bg-line"
          style={twoTier ? { margin: "96px 4px 104px" } : { margin: "58px 4px 70px" }}
        >
          {todayPos !== null && (
            <div className="absolute inset-y-0 left-0 rounded-sm bg-ink/25" style={{ width: `${todayPos}%` }} />
          )}
          {assess && legal && (
            <div
              className="absolute -top-[7px] -bottom-[7px] rounded-[7px] border border-warning/40 bg-warning/12"
              style={{ left: `${pos(assess.dueOn)}%`, width: `${pos(legal.dueOn) - pos(assess.dueOn)}%` }}
            />
          )}
          {placed.map((it) => {
            const tier = it.slot === "above t2" ? { bottom: 52 } : it.slot === "below t2" ? { top: 52 } : {};
            const side = it.slot.startsWith("above") ? "bottom-[18px]" : "top-[18px]";
            if (it.kind === "today") {
              return (
                <span key="today">
                  <span
                    className="absolute -top-3.5 -bottom-3.5 border-l-[1.5px] border-dashed border-ink"
                    style={{ left: `${it.p}%` }}
                  />
                  <span className={`${LABEL} ${side}`} style={{ left: `${it.p}%`, ...tier }}>
                    <b className="mx-auto mb-px table rounded-[5px] bg-ink px-[7px] text-[11.5px] font-semibold text-page">
                      Today
                    </b>
                    <span>{shortDate(today)}</span>
                  </span>
                </span>
              );
            }
            const d = it.d;
            const legalMs = LEGAL.has(milestoneId(d.milestone));
            const msTone =
              d.status === "done"
                ? "border-primary bg-primary"
                : d.status === "skipped" || d.status === "cancelled"
                  ? "border-line bg-line"
                  : legalMs
                    ? "border-warning bg-page"
                    : "border-muted bg-page";
            return (
              <span key={d.id}>
                <span
                  className={`absolute top-1/2 -mt-[7px] -ml-[7px] size-3.5 border-2 ${legalMs ? "rotate-45 rounded-[3px]" : "rounded-full"} ${msTone}`}
                  style={{ left: `${it.p}%` }}
                  data-status={d.status}
                  data-legal={legalMs}
                  title={`${milestoneLabel(d.milestone)}: ${shortDate(d.dueOn)} (${d.status})`}
                />
                <span className={`${LABEL} ${side}`} style={{ left: `${it.p}%`, ...tier }}>
                  <b className={LABEL_B}>{MILESTONE_SHORT[milestoneId(d.milestone)] ?? milestoneLabel(d.milestone)}</b>
                  <span>{shortDate(d.dueOn)}</span>
                </span>
              </span>
            );
          })}
        </div>
        <div className="flex justify-between text-[12.5px] text-muted">
          <span>{from === startOn ? `Term starts ${shortDate(startOn)}` : `${shortDate(from)}`}</span>
          <span>Term ends {shortDate(endOn)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 border-t border-line px-7 py-3 text-[12.5px] text-muted max-sm:px-3.5 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-[7px]">
        <span>
          <i className={`${KEY_DOT} bg-primary`} /> Done
        </span>
        <span>
          <i className={`${KEY_DOT} border-2 border-muted bg-page`} /> Upcoming
        </span>
        <span>
          <i className="size-2.5 rotate-45 rounded-[2px] border-2 border-warning bg-page" /> Legal deadline (90 days)
        </span>
        <span>
          <i className="h-2.5 w-4 rounded-[3px] border border-warning/40 bg-warning/12" /> Renewal window
        </span>
      </div>
    </div>
  );
}
