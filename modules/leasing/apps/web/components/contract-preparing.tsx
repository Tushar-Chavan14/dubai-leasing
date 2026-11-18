"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  elapsedLabel,
  isPreparingLive,
  PREPARING_HINT,
  type PreparingStatus,
  preparingStatusLine,
} from "../lib/contract-preparing";

const REFRESH_MS = 5000;

/** Shown in the Contract panel while the engine prepares the contract: status, a live timer, and auto-refresh. */
export function ContractPreparing({ preparing }: { preparing: PreparingStatus }) {
  const router = useRouter();
  const live = isPreparingLive(preparing.state);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!live) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [live, router]);

  if (!live) {
    return (
      <p role="status" className="m-0 text-sm text-danger">
        {preparingStatusLine(preparing)}
      </p>
    );
  }
  return (
    <div role="status" className="flex items-start gap-3 text-sm">
      <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
      <div className="grid gap-0.5">
        <div className="font-semibold">Preparing the contract…</div>
        <div className="text-muted">
          {preparingStatusLine(preparing)}
          {now !== null && <> · {elapsedLabel(now - Date.parse(preparing.since))}</>}
          <span> ({PREPARING_HINT})</span>
        </div>
      </div>
    </div>
  );
}
