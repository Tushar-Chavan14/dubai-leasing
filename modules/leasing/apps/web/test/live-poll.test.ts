import { describe, expect, test } from "bun:test";
import { createPoller, MAX_POLL_MS, nextDelay, POLL_MS } from "../components/live/poll";

function rig(versions: (string | Error)[]) {
  let visible = true;
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const log = { changes: 0, fetches: 0 };
  const poller = createPoller({
    fetchVersion: async () => {
      log.fetches++;
      const v = versions.shift() ?? versions.at(-1) ?? "x";
      if (v instanceof Error) throw v;
      return v;
    },
    onChange: () => log.changes++,
    isVisible: () => visible,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      if (h) (h as { cancelled: boolean }).cancelled = true;
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const live = () => timers.filter((t) => !t.cancelled);
  const fire = async () => {
    const t = live().at(-1)!;
    t.cancelled = true;
    t.fn();
    await flush();
  };
  return {
    poller,
    log,
    timers,
    live,
    fire,
    flush,
    setVisible: (v: boolean) => {
      visible = v;
      poller.visibilityChanged();
    },
  };
}

describe("live poller", () => {
  test("backoff doubles per failure and is capped", () => {
    expect(nextDelay(0)).toBe(POLL_MS);
    expect(nextDelay(1)).toBe(POLL_MS * 2);
    expect(nextDelay(2)).toBe(POLL_MS * 4);
    expect(nextDelay(20)).toBe(MAX_POLL_MS);
  });

  test("first marker is a baseline; a different marker fires onChange once", async () => {
    const r = rig(["a", "a", "b", "b"]);
    r.poller.start();
    await r.flush();
    expect(r.log.changes).toBe(0);
    await r.fire();
    expect(r.log.changes).toBe(0);
    await r.fire();
    expect(r.log.changes).toBe(1);
    await r.fire();
    expect(r.log.changes).toBe(1);
    expect(r.live().at(-1)!.ms).toBe(POLL_MS);
  });

  test("hidden tab: no polling; shown again: checks at once", async () => {
    const r = rig(["a", "b"]);
    r.poller.start();
    await r.flush();
    r.setVisible(false);
    expect(r.live()).toHaveLength(0);
    const fetched = r.log.fetches;
    r.setVisible(true);
    await r.flush();
    expect(r.log.fetches).toBe(fetched + 1);
    expect(r.log.changes).toBe(1);
  });

  test("errors back off, then recover to the base interval; no change fired on errors", async () => {
    const r = rig([new Error("down"), new Error("down"), "a"]);
    r.poller.start();
    await r.flush();
    expect(r.live().at(-1)!.ms).toBe(POLL_MS * 2);
    await r.fire();
    expect(r.live().at(-1)!.ms).toBe(POLL_MS * 4);
    await r.fire();
    expect(r.live().at(-1)!.ms).toBe(POLL_MS);
    expect(r.log.changes).toBe(0);
  });

  test("stop cancels the timer", async () => {
    const r = rig(["a"]);
    r.poller.start();
    await r.flush();
    r.poller.stop();
    expect(r.live()).toHaveLength(0);
  });
});
