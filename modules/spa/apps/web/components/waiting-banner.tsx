import { Pill } from "@platform/ui/pill";
import type { SpaRole } from "@spa/core";
import { COMPLIANCE_LABEL, type WaitingView, waitingParts } from "../lib/work";
import { DemoHandoff } from "./demo-handoff";

/**
 * "Waiting for" (design §4.3 item 2): one sentence, who and since when. A gate shows only the role that decides; there
 * is no decide control here (the decision card is C31). A review is named to nobody.
 */
export function WaitingBanner({
  waiting,
  viewer,
  demo = false,
}: {
  waiting: WaitingView | null;
  viewer: SpaRole;
  /** Demo mode only (S80): offer a one-click switch to the person this step waits on. */
  demo?: boolean;
}) {
  const w = waitingParts(waiting, viewer);
  if (!w) return null;
  // A compliance review seen from outside compliance has no role on the view; the hand-off still names the officer, and says only "Under review".
  const under = !waiting!.role && waiting!.label === COMPLIANCE_LABEL;
  const handoffRole = waiting!.role ?? (under ? "compliance_officer" : null);
  return (
    <aside
      aria-label="Waiting for"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-accent px-4 py-3 text-sm text-on-accent"
    >
      {w.mine && <Pill tone="waiting">Waiting for you</Pill>}
      <p className="m-0 min-w-0 flex-1">
        <b className="font-semibold">{w.headline}</b>
        {w.who && !w.mine && !(demo && handoffRole) ? <> · {w.who}</> : null}
        {w.since ? <> · since {w.since}</> : null}
      </p>
      {demo && !w.mine && handoffRole && (
        <div className="basis-full">
          <DemoHandoff role={handoffRole} demo={demo} under={under} />
        </div>
      )}
    </aside>
  );
}
