import { type CalendarDate } from "@platform/kernel/dates";
import { allow, defineMachine, deny, type GuardResult } from "@platform/kernel/machine";
import type { SpaGateId } from "../gates.ts";

/** A brokerage listing (architecture §4, S17, S18). */
export type ListingState = "DRAFT" | "VERIFIED" | "ACTIVE" | "PUBLISHED" | "UNDER_OFFER" | "SOLD" | "WITHDRAWN";
export type ListingEvent =
  | "VERIFY"
  | "ACTIVATE"
  | "PUBLISH"
  | "UNPUBLISH"
  | "OFFER_OPENED"
  | "OFFER_CLOSED"
  | "SELL"
  | "WITHDRAW";

export interface ListingGuardContext {
  today: CalendarDate | string;
  agreementSigned: boolean;
  ownershipMatched: boolean;
  /** The advertising permit's last valid day (S17), or null when none is recorded. */
  permitExpiresOn: CalendarDate | string | null;
}

const permitValid = (c: ListingGuardContext): GuardResult =>
  c.permitExpiresOn && c.permitExpiresOn >= c.today
    ? allow
    : deny(c.permitExpiresOn ? "The advertising permit has expired." : "No advertising permit is recorded.");

export const listingMachine = defineMachine<ListingState, ListingEvent, ListingGuardContext, SpaGateId>({
  entity: "listing",
  states: ["DRAFT", "VERIFIED", "ACTIVE", "PUBLISHED", "UNDER_OFFER", "SOLD", "WITHDRAWN"],
  events: ["VERIFY", "ACTIVATE", "PUBLISH", "UNPUBLISH", "OFFER_OPENED", "OFFER_CLOSED", "SELL", "WITHDRAW"],
  initial: "DRAFT",
  terminal: ["SOLD", "WITHDRAWN"],
  transitions: [
    {
      from: "DRAFT",
      event: "VERIFY",
      to: "VERIFIED",
      guard: (c) => {
        const r: string[] = [];
        if (!c.agreementSigned) r.push("The listing agreement isn't signed.");
        if (!c.ownershipMatched) r.push("The ownership document isn't matched to the sellers.");
        return r.length ? deny(...r) : allow;
      },
      description: "Listing agreement signed and ownership matched",
    },
    {
      from: "VERIFIED",
      event: "ACTIVATE",
      to: "ACTIVE",
      guard: permitValid,
      description: "A valid permit is recorded",
    },
    { from: "ACTIVE", event: "PUBLISH", to: "PUBLISHED", guard: permitValid, description: "Public page on" },
    { from: "PUBLISHED", event: "UNPUBLISH", to: "ACTIVE", description: "Public page off (or permit expired)" },
    { from: "ACTIVE", event: "OFFER_OPENED", to: "UNDER_OFFER", description: "An offer or a deal is open" },
    { from: "PUBLISHED", event: "OFFER_OPENED", to: "UNDER_OFFER", description: "An offer or a deal is open" },
    {
      from: "UNDER_OFFER",
      event: "OFFER_CLOSED",
      to: "ACTIVE",
      description: "Offer rejected or expired, or the deal cancelled",
    },
    { from: "UNDER_OFFER", event: "SELL", to: "SOLD", description: "The transfer was issued" },
    { from: "DRAFT", event: "WITHDRAW", to: "WITHDRAWN", description: "The seller withdrew" },
    { from: "VERIFIED", event: "WITHDRAW", to: "WITHDRAWN", description: "The seller withdrew" },
    { from: "ACTIVE", event: "WITHDRAW", to: "WITHDRAWN", description: "The seller withdrew" },
    { from: "PUBLISHED", event: "WITHDRAW", to: "WITHDRAWN", description: "The seller withdrew" },
  ],
});
