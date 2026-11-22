import { stageLabel, type StageKey } from "@spa/core";
import { DEAL_STATES } from "@spa/core";
import Link from "next/link";
import type { EventItem, HelperRunItem } from "../lib/contracts";
import { dubaiDateTime } from "../lib/format";

const isStage = (s: string | null): s is StageKey =>
  !!s && (s === "ON_HOLD" || (DEAL_STATES as readonly string[]).includes(s));

/**
 * The record's right column (design §4.3): append-only events with time (UAE time), who and what, then how the
 * helpers handled it. Model-written reasons are labelled as suggestions. Read only.
 */
export function ActivityLog({
  events,
  next,
  runs = [],
}: {
  events: EventItem[];
  next: { href: string } | null;
  runs?: HelperRunItem[];
}) {
  return (
    <div className="grid gap-6">
      <section aria-labelledby="activity" className="grid gap-3">
        <h2 id="activity" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
          Activity
        </h2>
        {events.length ? (
          <ol className="m-0 grid list-none gap-3 p-0">
            {events.map((e) => (
              <li key={e.id} className="m-0 grid gap-0.5 border-l-2 border-line pl-3 text-sm">
                <time dateTime={e.at} className="text-xs text-muted tabular-nums">
                  {dubaiDateTime(e.at)}
                </time>
                <span>{e.label}</span>
                {isStage(e.toState) && <span className="text-[12.5px] text-muted">Now: {stageLabel(e.toState)}</span>}
                <span className="text-[12.5px] text-muted">{e.actor.label}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-sm text-muted">No activity yet. Each step on this deal will be listed here.</p>
        )}
        {next && (
          <Link href={next.href} className="w-fit text-[13px] text-ink underline underline-offset-2">
            Earlier activity
          </Link>
        )}
      </section>
      {runs.length > 0 && (
        <section aria-labelledby="handled" className="grid gap-3">
          <h2 id="handled" className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
            How this was handled
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {runs.map((r) => (
              <li key={r.id} className="m-0 grid gap-0.5 rounded-xl border border-line bg-page px-3 py-2.5 text-sm">
                <span className="font-semibold">
                  {r.helper} · {r.status === "ok" ? "Done" : "Needs a person"}
                </span>
                <time dateTime={r.createdAt} className="text-xs text-muted tabular-nums">
                  {dubaiDateTime(r.createdAt)}
                </time>
                {r.reasons.map((reason) => (
                  <span key={reason} className="text-[12.5px] text-muted">
                    <i className="not-italic font-semibold">suggestion</i> · {reason}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
