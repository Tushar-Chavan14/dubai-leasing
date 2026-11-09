"use client";

import type { UnitCard as Card } from "@leasing/core";
import Link from "next/link";
import { Cover } from "../public/cover";
import { buttonClass } from "../ui/button";
import { factsList, rentShort, typeLabel } from "../../lib/listings";

/** The card rail under a reply: cards sit side by side and scroll sideways when they do not fit. Shared by both chats. */
export const CARD_RAIL = "mt-1 flex max-w-full snap-x snap-proximity gap-3 overflow-x-auto pb-1";

/** Card buttons are a little smaller than page buttons so three fit in two rows. */
const SMALL = "h-8! px-3! text-[13px]!";

/** One unit card for both chats. The public chat links to the customer page and can book or apply; the staff copilot links into the app and only shows. */
export function UnitCardView({
  card,
  onBook,
  onApply,
  onNavigate,
  disabled,
  detailsHref,
}: {
  card: Card;
  /** "Book a viewing"; left out when the chat can't book (staff). */
  onBook?: (() => void) | undefined;
  /** Where "View details" goes; the public property page when left out. */
  detailsHref?: string | undefined;
  /** "Apply now" (only when the card says `canApply`). */
  onApply?: (() => void) | undefined;
  /** Called when "View details" is followed (the modal closes itself). */
  onNavigate?: (() => void) | undefined;
  disabled: boolean;
}) {
  const facts = factsList(card).join(" · ");
  const type = typeLabel(card);
  return (
    <article className="w-[min(280px,82%)] flex-none snap-start overflow-hidden rounded-card border border-line bg-page font-sans text-sm text-ink">
      <div className="aspect-[16/10] bg-raised">
        <Cover
          building={card.building}
          photo={card.photoUrl ?? undefined}
          alt={`${card.building}, ${card.community}`}
        />
      </div>
      <div className="grid gap-1 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <b className="text-[15px] leading-snug font-semibold tracking-tight">{card.building}</b>
          <span className="flex-none text-[15px] font-semibold whitespace-nowrap tabular-nums">
            {rentShort(card.rent)}
          </span>
        </div>
        <span className="text-muted">
          {card.community}
          {type ? ` · ${type}` : ""}
        </span>
        {facts && <span className="text-muted">{facts}</span>}
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={detailsHref ?? `/customer/properties/${card.unitId}`}
            className={`${buttonClass("ghost", "sm")} ${SMALL}`}
            {...(onNavigate ? { onClick: onNavigate } : {})}
          >
            View details
          </Link>
          {onBook && (
            <button
              type="button"
              className={`${buttonClass("primary", "sm")} ${SMALL}`}
              onClick={onBook}
              disabled={disabled}
            >
              Book a site visit
            </button>
          )}
          {card.canApply && onApply && (
            <button
              type="button"
              className={`${buttonClass("ghost", "sm")} ${SMALL}`}
              onClick={onApply}
              disabled={disabled}
            >
              Apply now
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
