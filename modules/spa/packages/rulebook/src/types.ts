import type { CalendarDate } from "@platform/kernel/dates";

export type SpaEmirate = "dubai";

/**
 * One published version of the sales rules (architecture §6). Money in fils, rates in basis points. A value the spec
 * marks "confirm with legal/compliance" is listed in `pending`: functions that need it refuse instead of using it (S36).
 */
export interface SalesRulebook {
  version: string;
  emirate: SpaEmirate;
  effectiveFrom: CalendarDate | string;
  /** DLD fee on primary registration and resale transfer, e.g. 400 = 4%. */
  registrationFeeBps: number;
  registrationFeePayer: "buyer" | "seller" | "split";
  oqoodAdminFeeFils: number;
  oqoodTransferFeeFils: number;
  trusteeFeeFils: number;
  mortgageRegistrationBps: number;
  mortgageRegistrationAdminFils: number;
  /** Primary: the booking (first instalment) is at least this share of the price. */
  minBookingBps: number;
  amlCashThresholdFils: number;
  /** 0..1, used by code matching only. */
  amlNameMatchThreshold: number;
  beneficialOwnerBps: number;
  sources: readonly string[];
  pending: readonly (keyof Omit<SalesRulebook, "pending" | "sources" | "version" | "emirate" | "effectiveFrom">)[];
}
export type RulebookField = SalesRulebook["pending"][number];

export type RuleResult<T> = ({ ok: true } & T) | { ok: false; reasons: string[] };

export const isPending = (rb: SalesRulebook, field: RulebookField): boolean => rb.pending.includes(field);
export const pendingReason = (field: RulebookField): string => `${field} awaits legal confirmation`;
