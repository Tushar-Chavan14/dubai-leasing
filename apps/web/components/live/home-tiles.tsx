"use client";

import Link from "next/link";
import { useState } from "react";
import type { HomeView } from "../../lib/types";
import { useLiveVersion } from "./use-live";

type Counts = Pick<HomeView, "viewingsToday" | "offersOut" | "awaitingSignature" | "ejariPending" | "waitingForYou">;

/**
 * The Home tiles, kept current by polling. Only the counts are refetched (the page, and the copilot chat on it, are
 * not re-rendered), so a reply being typed or streamed is never disturbed.
 */
export function HomeTiles({ initial }: { initial: Counts }) {
  const [h, setH] = useState<Counts>(initial);
  useLiveVersion("scope=list", () => {
    void fetch("/api/live?scope=home", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Counts>) : null))
      .then((n) => n && setH(n))
      .catch(() => {});
  });
  const tiles = [
    { label: "Viewings today", n: h.viewingsToday, href: "/work?stage=Viewing" },
    { label: "Offers out", n: h.offersOut, href: "/work?stage=Offer" },
    { label: "Awaiting signature", n: h.awaitingSignature, href: "/work?stage=Contract" },
    { label: "Ejari pending", n: h.ejariPending, href: "/work?stage=Ejari" },
    { label: "Waiting for you", n: h.waitingForYou, href: "/work?view=waiting", alert: true },
  ];
  return (
    <ul className="home-tiles" aria-label="Today">
      {tiles.map((t) => (
        <li key={t.label}>
          <Link href={t.href} className="home-tile" data-alert={t.alert && t.n > 0 ? "true" : undefined}>
            <b className="num">{t.n}</b>
            <span>{t.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
