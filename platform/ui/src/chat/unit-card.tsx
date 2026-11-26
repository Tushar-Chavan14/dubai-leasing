"use client";

import Link from "next/link";
import { buttonClass } from "../button";
import { Cover } from "../media/cover";

/** The card rail under a reply: cards sit side by side and scroll sideways when they do not fit. */
export const CARD_RAIL = "mt-1 flex max-w-full snap-x snap-proximity gap-3 overflow-x-auto pb-1";

/** Card buttons are a little smaller than page buttons so three fit in two rows. */
const SMALL = "h-8! px-3! text-[13px]!";

/**
 * One unit or listing card for a chat. `Book` and `Apply` show only when their handler is given; the module decides
 * (a public chat can book, a staff copilot only shows). `src` is a ready URL.
 */
export function UnitCard({
  name,
  src,
  alt,
  title,
  price,
  subtitle,
  facts,
  detailsHref,
  detailsLabel = "View details",
  onBook,
  bookLabel,
  onApply,
  applyLabel,
  onNavigate,
  disabled,
}: {
  /** Seeds the placeholder tile when there is no photo. */
  name: string;
  src?: string | undefined;
  alt?: string | undefined;
  title: string;
  price: string;
  /** Muted line under the title, e.g. "Dubai Marina · Apartment". */
  subtitle?: string | undefined;
  facts: string[];
  detailsHref?: string | undefined;
  detailsLabel?: string;
  onBook?: (() => void) | undefined;
  bookLabel: string;
  onApply?: (() => void) | undefined;
  applyLabel: string;
  /** Called when the details link is followed (the modal closes itself). */
  onNavigate?: (() => void) | undefined;
  disabled: boolean;
}) {
  const factsText = facts.join(" · ");
  return (
    <article className="w-[min(280px,82%)] flex-none snap-start overflow-hidden rounded-card border border-line bg-page font-sans text-sm text-ink">
      <div className="aspect-[16/10] bg-raised">
        <Cover name={name} src={src} {...(alt !== undefined && { alt })} />
      </div>
      <div className="grid gap-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <b className="text-[15px] leading-snug font-semibold tracking-tight">{title}</b>
          <span className="flex-none text-[15px] font-semibold whitespace-nowrap tabular-nums">{price}</span>
        </div>
        {subtitle !== undefined && <span className="text-muted">{subtitle}</span>}
        {factsText && <span className="text-muted">{factsText}</span>}
        <div className="mt-2 flex flex-wrap gap-2">
          {detailsHref && (
            <Link
              href={detailsHref}
              className={`${buttonClass("ghost", "sm")} ${SMALL}`}
              {...(onNavigate ? { onClick: onNavigate } : {})}
            >
              {detailsLabel}
            </Link>
          )}
          {onBook && (
            <button
              type="button"
              className={`${buttonClass("primary", "sm")} ${SMALL}`}
              onClick={onBook}
              disabled={disabled}
            >
              {bookLabel}
            </button>
          )}
          {onApply && (
            <button
              type="button"
              className={`${buttonClass("ghost", "sm")} ${SMALL}`}
              onClick={onApply}
              disabled={disabled}
            >
              {applyLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
