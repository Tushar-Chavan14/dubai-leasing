"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { useLiveVersion } from "./use-live";

/**
 * Renders nothing. Re-renders the current server page when the change marker at `url` changes (background jobs,
 * other staff, party actions). Not used on chat pages.
 */
export function LiveRefresh({ url }: { url: string }) {
  const router = useRouter();
  useLiveVersion(url, () => startTransition(() => router.refresh()));
  return null;
}
