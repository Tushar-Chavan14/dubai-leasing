"use client";

import { useEffect, useRef } from "react";
import { createPoller } from "./poll";

/** Polls `/api/live?...` (a change marker) while the tab is visible and calls `onChange` when it changes. */
export function useLiveVersion(query: string, onChange: () => void) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  useEffect(() => {
    const poller = createPoller({
      fetchVersion: async () => {
        const res = await fetch(`/api/live?${query}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        return String(((await res.json()) as { version: string }).version);
      },
      onChange: () => cb.current(),
      isVisible: () => document.visibilityState === "visible",
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    const onVis = () => poller.visibilityChanged();
    document.addEventListener("visibilitychange", onVis);
    poller.start();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      poller.stop();
    };
  }, [query]);
}
