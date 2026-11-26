"use client";

import { LiveRefresh as PlatformLiveRefresh } from "@platform/ui/live/live-refresh";

/**
 * Renders nothing. Re-renders the current server page when the Workspace list or the open record changes in the
 * engine (background jobs, other staff, tenant actions). Not used on the copilot or customer chat pages.
 */
export function LiveRefresh({ record }: { record?: { kind: string; id: string } | null }) {
  const query = new URLSearchParams(
    record ? { scope: "record", kind: record.kind, id: record.id } : { scope: "list" },
  ).toString();
  return <PlatformLiveRefresh url={`/api/live?${query}`} />;
}
