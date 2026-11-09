"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import type { HomeView } from "../../lib/types";
import { useLiveVersion } from "./use-live";

type Counts = Pick<HomeView, "viewingsToday" | "offersOut" | "awaitingSignature" | "ejariPending" | "waitingForYou">;

const CARD =
  "grid content-start gap-1 rounded-card border border-line px-4 py-3.5 font-sans text-ink no-underline transition-colors duration-200 hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/**
 * Home's three brief cards, kept current by polling: "Waiting for you" (filled, with the top items), "Offers out"
 * (with the signature and Ejari counts) and "Site visits today". Only the counts are refetched (the page, and the
 * copilot chat beside it, are not re-rendered), so a reply being typed or streamed is never disturbed.
 */
export function HomeTiles({ initial, top }: { initial: Counts; top: { key: string; text: string }[] }) {
  const [h, setH] = useState<Counts>(initial);
  useLiveVersion("scope=list", () => {
    void fetch("/api/live?scope=home", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Counts>) : null))
      .then((n) => n && setH(n))
      .catch(() => {});
  });
  const sub = "text-[12.5px] text-muted underline-offset-2 hover:underline";
  return (
    <section
      aria-label="Today"
      className="my-5 grid grid-cols-[1.3fr_1fr_1fr] gap-2.5 max-lg:grid-cols-1 max-[1180px]:grid-cols-2 max-[1180px]:[&>:first-child]:col-span-2"
    >
      <Link href="/work?view=waiting" className={`${CARD} !border-transparent bg-accent !text-on-accent`}>
        <span className="flex items-center justify-between text-[12.5px]">
          Waiting for you
          <ArrowUpRightIcon size={16} aria-hidden />
        </span>
        <b className="num text-[28px] font-semibold leading-tight tracking-[-0.03em]">{h.waitingForYou}</b>
        {top.length === 0 ? (
          <span className="text-[12.5px]">Nothing waiting for you.</span>
        ) : (
          <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-[12.5px]">
            {top.map((t) => (
              <li key={t.key} className="truncate">
                {t.text}
              </li>
            ))}
          </ul>
        )}
      </Link>
      <div className={`${CARD} bg-page`}>
        <Link href="/work?stage=Offer" className="grid gap-1 text-ink no-underline">
          <span className="text-[12.5px] text-muted">Offers out</span>
          <b className="num text-[28px] font-semibold leading-tight tracking-[-0.03em]">{h.offersOut}</b>
        </Link>
        <Link href="/work?stage=Contract" className={`${sub} !text-muted`}>
          <b className="num font-semibold !text-ink">{h.awaitingSignature}</b> awaiting signature
        </Link>
        <Link href="/work?stage=Ejari" className={`${sub} !text-muted`}>
          <b className="num font-semibold !text-ink">{h.ejariPending}</b> Ejari pending
        </Link>
      </div>
      <div className={`${CARD} bg-page`}>
        <Link href="/work?stage=Viewing" className="grid gap-1 text-ink no-underline">
          <span className="text-[12.5px] text-muted">Site visits today</span>
          <b className="num text-[28px] font-semibold leading-tight tracking-[-0.03em]">{h.viewingsToday}</b>
        </Link>
        <Link href="/metrics" className={`${sub} !text-muted`}>
          All metrics
        </Link>
      </div>
    </section>
  );
}
