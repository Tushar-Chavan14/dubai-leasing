"use client";

import Link from "next/link";
import { useState } from "react";
import type { HomeView } from "../../lib/types";
import { useLiveVersion } from "./use-live";

type Counts = Pick<HomeView, "viewingsToday" | "offersOut" | "awaitingSignature" | "ejariPending" | "waitingForYou">;

/**
 * Home's KPI tiles, kept current by polling: waiting for you (with the top items), offers out, contracts to sign,
 * pending registration and site visits today. Each tile opens the matching Workspace view. Only the counts are refetched
 * (the page, and the copilot chat beside it, are not re-rendered), so a reply being typed or streamed is never disturbed.
 */
export function HomeTiles({ initial, top }: { initial: Counts; top: { key: string; text: string }[] }) {
  const [h, setH] = useState<Counts>(initial);
  useLiveVersion("scope=list", () => {
    void fetch("/api/live?scope=home", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Counts>) : null))
      .then((n) => n && setH(n))
      .catch(() => {});
  });
  return (
    <section aria-label="Today" className="ls-kpis">
      <Link href="/work?view=waiting" className="ls-kpi no-underline" data-tone={h.waitingForYou > 0 ? "primary" : undefined}>
        <span className="n num">{h.waitingForYou}</span>
        <span className="l">Waiting for you</span>
        {top.length > 0 && (
          <ul className="m-0 mt-2 grid list-none gap-0.5 p-0 text-[12.5px] text-muted">
            {top.slice(0, 2).map((t) => (
              <li key={t.key} className="truncate">
                {t.text}
              </li>
            ))}
          </ul>
        )}
      </Link>
      <Link href="/work?stage=Offer" className="ls-kpi no-underline">
        <span className="n num">{h.offersOut}</span>
        <span className="l">Offers out</span>
      </Link>
      <Link href="/work?stage=Contract" className="ls-kpi no-underline">
        <span className="n num">{h.awaitingSignature}</span>
        <span className="l">To sign</span>
      </Link>
      <Link href="/work?stage=Ejari" className="ls-kpi no-underline">
        <span className="n num">{h.ejariPending}</span>
        <span className="l">Pending registration</span>
      </Link>
      <Link href="/work?stage=Viewing" className="ls-kpi no-underline">
        <span className="n num">{h.viewingsToday}</span>
        <span className="l">Site visits today</span>
      </Link>
    </section>
  );
}
