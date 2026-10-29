"use client";

import type { UnitCard as Card } from "@leasing/core";
import Link from "next/link";
import { factsList, initials, photoSrc, placeholderStyle, typeLabel } from "../../lib/listings";

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
  const src = photoSrc(card.photoUrl);
  const facts = factsList(card).join(" · ");
  const type = typeLabel(card);
  return (
    <article className="cc-card">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${card.building}, ${card.community}`} loading="lazy" />
      ) : (
        <div className="cc-card-ph" style={placeholderStyle(card.building)} aria-hidden="true">
          {initials(card.building)}
        </div>
      )}
      <div className="cc-card-body">
        <b>{card.building}</b>
        <span className="muted">{card.community}</span>
        {type && <span className="cc-card-type">{type}</span>}
        {facts && <span>{facts}</span>}
        <span className="cc-rent">{card.rent}</span>
        <div className="btn-row">
          <Link
            href={detailsHref ?? `/customer/properties/${card.unitId}`}
            className="btn small"
            {...(onNavigate ? { onClick: onNavigate } : {})}
          >
            View details
          </Link>
          {onBook && (
            <button type="button" className="btn small primary" onClick={onBook} disabled={disabled}>
              Book a viewing
            </button>
          )}
          {card.canApply && onApply && (
            <button type="button" className="btn small" onClick={onApply} disabled={disabled}>
              Apply now
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
