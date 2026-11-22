import { Pill } from "@platform/ui/pill";
import type { SpaRole } from "@spa/core";
import { type WaitingView, waitingParts } from "../lib/work";

/**
 * "Waiting for" (design §4.3 item 2): one sentence, who and since when. A gate shows only the role that decides; there
 * is no decide control here (the decision card is C31). A review is named to nobody.
 */
export function WaitingBanner({ waiting, viewer }: { waiting: WaitingView | null; viewer: SpaRole }) {
  const w = waitingParts(waiting, viewer);
  if (!w) return null;
  return (
    <aside
      aria-label="Waiting for"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-accent px-4 py-3 text-sm text-on-accent"
    >
      {w.mine && <Pill tone="waiting">Waiting for you</Pill>}
      <p className="m-0 min-w-0 flex-1">
        <b className="font-semibold">{w.headline}</b>
        {w.who && !w.mine ? <> · {w.who}</> : null}
        {w.since ? <> · since {w.since}</> : null}
      </p>
    </aside>
  );
}
