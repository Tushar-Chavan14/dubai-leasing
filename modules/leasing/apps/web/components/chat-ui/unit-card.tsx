"use client";

import type { UnitCard as Card } from "@leasing/core";
import { CARD_RAIL, UnitCard } from "@platform/ui/chat/unit-card";
import { factsList, photoSrc, rentShort, typeLabel } from "../../lib/listings";

export { CARD_RAIL };

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
  const type = typeLabel(card);
  return (
    <UnitCard
      name={card.building}
      src={photoSrc(card.photoUrl ?? undefined) ?? undefined}
      alt={`${card.building}, ${card.community}`}
      title={card.building}
      price={rentShort(card.rent)}
      subtitle={`${card.community}${type ? ` · ${type}` : ""}`}
      facts={factsList(card)}
      detailsHref={detailsHref ?? `/customer/properties/${card.unitId}`}
      onNavigate={onNavigate}
      onBook={onBook}
      bookLabel="Book a site visit"
      onApply={card.canApply ? onApply : undefined}
      applyLabel="Apply now"
      disabled={disabled}
    />
  );
}
