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

  return (
    <div>
      <div
        className="timeline-track"
        role="img"
        aria-label={`Renewal milestones for the term ending ${shortDate(endOn)}`}
      >
        <div className="line" style={twoTier ? { margin: "96px 4px 104px" } : undefined}>
          {todayPos !== null && <div className="elapsed" style={{ width: `${todayPos}%` }} />}
          {assess && legal && (
            <div
              className="window"
              style={{ left: `${pos(assess.dueOn)}%`, width: `${pos(legal.dueOn) - pos(assess.dueOn)}%` }}
            />
          )}
          {placed.map((it) => {
            const tier = it.slot === "above t2" ? { bottom: 52 } : it.slot === "below t2" ? { top: 52 } : {};
            if (it.kind === "today") {
              return (
                <span key="today">
                  <span className="today" style={{ left: `${it.p}%` }} />
                  <span className={`ms-label today-label ${it.slot}`} style={{ left: `${it.p}%`, ...tier }}>
                    <b>Today</b>
                    <span>{shortDate(today)}</span>
                  </span>
                </span>
              );
            }
            const d = it.d;
            return (
              <span key={d.id}>
                <span
                  className="ms"
                  style={{ left: `${it.p}%` }}
                  data-status={d.status}
                  data-legal={LEGAL.has(milestoneId(d.milestone))}
                  title={`${milestoneLabel(d.milestone)}: ${shortDate(d.dueOn)} (${d.status})`}
                />
                <span className={`ms-label ${it.slot}`} style={{ left: `${it.p}%`, ...tier }}>
                  <b>{MILESTONE_SHORT[milestoneId(d.milestone)] ?? milestoneLabel(d.milestone)}</b>
                  <span>{shortDate(d.dueOn)}</span>
                </span>
              </span>
            );
          })}
        </div>
        <div className="ends">
          <span>{from === startOn ? `Term starts ${shortDate(startOn)}` : `${shortDate(from)}`}</span>
          <span>Term ends {shortDate(endOn)}</span>
        </div>
      </div>
      <div className="timeline-key">
        <span>
          <i /> Done
        </span>
        <span>
          <i className="pending" /> Upcoming
        </span>
        <span>
          <i className="legal" /> Legal deadline (90 days)
        </span>
        <span>
          <i className="window" /> Renewal window
        </span>
      </div>
    </div>
  );
}
