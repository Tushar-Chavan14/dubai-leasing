"use client";

import { ArrowUpRightIcon, CalendarBlankIcon, ClockIcon, FileTextIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import type { HomeView } from "../../lib/types";
import { useLiveVersion } from "./use-live";

type Counts = Pick<HomeView, "viewingsToday" | "offersOut" | "awaitingSignature" | "ejariPending" | "waitingForYou">;

const CARD =
  "group relative flex min-w-0 flex-col justify-between gap-5 rounded-card border bg-page px-5 pt-4 pb-5 font-sans text-ink shadow-card transition-colors duration-200";
/** The card's title link covers the whole card; the links inside it sit above that layer. */
const STRETCH =
  "flex items-center gap-2.5 text-[14.5px] font-semibold text-ink! no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary";
const CHIP = "grid size-8 flex-none place-items-center rounded-[9px]";
const BIG = "num text-[40px] font-bold leading-none tracking-[-0.04em]";
const ARROW =
  "ml-auto text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5";

/**
 * Home's three brief cards, kept current by polling: "Waiting for you" (outlined in blue, with the top items), "Offers out"
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
  const sub = "relative z-10 underline-offset-2 hover:underline";
  return (
    <section aria-label="Today" className="my-6 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
      <div className={`${CARD} border-primary ring-1 ring-primary`}>
        <Link href="/work?view=waiting" className={STRETCH}>
          <span aria-hidden className={`${CHIP} bg-primary text-on-primary`}>
            <ClockIcon size={17} weight="bold" />
          </span>
          Waiting for you
          <ArrowUpRightIcon size={15} aria-hidden className={ARROW} />
        </Link>
        <div className="grid gap-2">
          <div className="flex items-end gap-3">
            <b className={BIG}>{h.waitingForYou}</b>
            <span className="pb-0.5 text-[13px] text-muted">
              {h.waitingForYou === 0 ? "Nothing waiting for you" : h.waitingForYou === 1 ? "needs you" : "need you"}
            </span>
          </div>
          {top.length > 0 && (
            <ul className="m-0 grid list-none gap-0.5 p-0 text-[12.5px] text-muted">
              {top.slice(0, 2).map((t) => (
                <li key={t.key} className="truncate">
                  {t.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className={`${CARD} border-line hover:border-primary/40`}>
        <Link href="/work?stage=Offer" className={STRETCH}>
          <span aria-hidden className={`${CHIP} border border-line bg-raised text-muted`}>
            <FileTextIcon size={17} />
          </span>
          Offers out
          <ArrowUpRightIcon size={15} aria-hidden className={ARROW} />
        </Link>
        <div className="flex items-end gap-3">
          <b className={BIG}>{h.offersOut}</b>
          <span className="pb-0.5 text-[13px] text-muted">
            <Link href="/work?stage=Contract" className={`${sub} text-muted!`}>
              <b className="num font-semibold text-ink">{h.awaitingSignature}</b> to sign
            </Link>
            {" · "}
            <Link href="/work?stage=Ejari" className={`${sub} text-muted!`}>
              <b className="num font-semibold text-ink">{h.ejariPending}</b> pending reg.
            </Link>
          </span>
        </div>
      </div>
      <div className={`${CARD} border-line hover:border-primary/40`}>
        <Link href="/work?stage=Viewing" className={STRETCH}>
          <span aria-hidden className={`${CHIP} border border-line bg-raised text-muted`}>
            <CalendarBlankIcon size={17} />
          </span>
          Site visits today
          <ArrowUpRightIcon size={15} aria-hidden className={ARROW} />
        </Link>
        <div className="flex items-end gap-3">
          <b className={BIG}>{h.viewingsToday}</b>
          <Link href="/metrics" className={`${sub} pb-0.5 text-[13px] font-semibold text-primary!`}>
            All metrics →
          </Link>
        </div>
      </div>
    </section>
  );
}
