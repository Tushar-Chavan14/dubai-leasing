"use client";

import type { UnitCard as Card } from "@leasing/core";
import Link from "next/link";
import { factsList, initials, photoSrc, placeholderStyle } from "../../lib/listings";

export function UnitCardView({
  card,
  onBook,
  onNavigate,
  disabled,
}: {
  card: Card;
  onBook: () => void;
  /** Called when "View details" is followed (the modal closes itself). */
  onNavigate?: (() => void) | undefined;
  disabled: boolean;
}) {
  const src = photoSrc(card.photoUrl);
  const facts = factsList(card).join(" · ");
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
        <span>{facts}</span>
        <span className="cc-rent">{card.rent}</span>
        <div className="btn-row">
          <Link
            href={`/properties/${card.unitId}`}
            className="btn small"
            {...(onNavigate ? { onClick: onNavigate } : {})}
          >
            View details
          </Link>
          <button type="button" className="btn small primary" onClick={onBook} disabled={disabled}>
            Book a viewing
          </button>
        </div>
      </div>
    </article>
  );
}
