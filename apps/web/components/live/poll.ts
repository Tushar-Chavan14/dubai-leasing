/**
 * Live-update polling, kept free of React so it can be unit-tested. A poller asks the engine for a cheap change
 * marker, only while the tab is visible, backs off after errors, and calls `onChange` when the marker differs
 * from the last one seen (the first marker only sets the baseline).
 */
export const POLL_MS = 4000;
export const MAX_POLL_MS = 60_000;

/** Delay before the next poll: the base interval, doubled for each consecutive failure, capped. */
export function nextDelay(failures: number, base = POLL_MS, max = MAX_POLL_MS): number {
  return Math.min(max, base * 2 ** Math.max(0, failures));
}

export interface PollerDeps {
  /** The current marker; throws (or rejects) on failure. */
  fetchVersion: () => Promise<string>;
  onChange: () => void;
  isVisible: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export function createPoller(deps: PollerDeps) {
  let last: string | null = null;
  let failures = 0;
  let timer: unknown = null;
  let running = false;
  let inFlight = false;

  const schedule = () => {
    if (!running || !deps.isVisible()) return;
    deps.clearTimer(timer);
    timer = deps.setTimer(() => void tick(), nextDelay(failures));
  };

  const tick = async () => {
    timer = null;
    if (!running || inFlight) return;
    if (!deps.isVisible()) return; // resumed by `visibilityChanged`
    inFlight = true;
    try {
      const v = await deps.fetchVersion();
      failures = 0;
      if (last !== null && v !== last) {
        last = v;
        deps.onChange();
      } else last = v;
    } catch {
      failures++;
    } finally {
      inFlight = false;
      schedule();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      if (deps.isVisible()) void tick();
    },
    stop() {
      running = false;
      deps.clearTimer(timer);
      timer = null;
    },
    /** Call when the tab is shown or hidden: a shown tab checks at once, a hidden one stops polling. */
    visibilityChanged() {
      if (!running) return;
      if (deps.isVisible()) {
        deps.clearTimer(timer);
        void tick();
      } else {
        deps.clearTimer(timer);
        timer = null;
      }
    },
  };
}
