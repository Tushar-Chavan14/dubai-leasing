"use client";

import { useLiveVersion as useLiveUrl } from "@platform/ui/live/use-live";

/** Polls `/api/live?<query>` (a change marker) while the tab is visible and calls `onChange` when it changes. */
export function useLiveVersion(query: string, onChange: () => void) {
  useLiveUrl(`/api/live?${query}`, onChange);
}
