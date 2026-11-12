/** Pure parts of the registration decision cards (Phase 2). The component only renders what these return. */

export type RegistrationCardInput = {
  leaseId: string;
  submissionId: string;
  portalName: string;
  reference: string;
  issuedOn: string;
  today: string;
  feePaidAed: string;
  blocked?: string;
};

/** The "registered on" prefill can never be after today: the field's max is today. */
export function clampDate(value: string, max: string): string {
  return value && value > max ? max : value;
}

export function registrationRecordSpec(card: RegistrationCardInput) {
  return {
    hidden: { leaseId: card.leaseId, submissionId: card.submissionId },
    reference: {
      label: `${card.portalName} reference`,
      required: true,
      maxLength: 60,
      defaultValue: card.reference,
    },
    issuedOn: { required: true, max: card.today, defaultValue: clampDate(card.issuedOn, card.today) },
    fee: { label: "Fee paid (AED)", required: false, defaultValue: card.feePaidAed },
  };
}

export function registrationRejectedSpec(card: {
  leaseId: string;
  submissionId: string;
  portalName: string;
  reasons: string;
}) {
  return {
    hidden: { leaseId: card.leaseId, submissionId: card.submissionId },
    reasons: {
      label: `Why ${card.portalName} refused it`,
      required: true,
      maxLength: 1000,
      defaultValue: card.reasons,
    },
  };
}

/** Fee line for a card: empty when no fee was given. */
export function feeText(feePaidAed: string): string {
  const v = feePaidAed.trim();
  return v ? `AED ${v}` : "No fee given";
}

export function cardStatus(blocked?: string): { label: string; tone: "neutral" | "waiting" } {
  return blocked ? { label: "Not yours to decide", tone: "neutral" } : { label: "Your decision", tone: "waiting" };
}

/** The note shown instead of the form when the user's role cannot decide. */
export function blockedMessage(blocked?: string): string | null {
  return blocked ? blocked : null;
}
