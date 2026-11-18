import { z } from "zod";
import { allow, defineMachine, deny } from "./machine.ts";

export const ApplicationState = z.enum([
  "ENQUIRY",
  "VIEWING",
  "SCREENING",
  "OFFER",
  "RESERVED",
  "CONVERTED",
  "REJECTED",
  "WITHDRAWN",
]);
export type ApplicationState = z.infer<typeof ApplicationState>;

export const ApplicationEvent = z.enum([
  "VIEWING_BOOKED",
  "VIEWING_NO_SHOW",
  "APPLIED",
  "KYC_VERIFIED",
  "KYC_FAILED",
  "OFFER_REVISED",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "OFFER_EXPIRED",
  "LEASE_CREATED",
  "WITHDRAWN",
]);
export type ApplicationEvent = z.infer<typeof ApplicationEvent>;

export interface ApplicationGuardContext {
  reservationPaid: boolean;
}

export const applicationMachine = defineMachine<ApplicationState, ApplicationEvent, ApplicationGuardContext>({
  entity: "application",
  states: ApplicationState.options,
  events: ApplicationEvent.options,
  initial: "ENQUIRY",
  terminal: ["CONVERTED", "REJECTED", "WITHDRAWN"],
  transitions: [
    { from: "ENQUIRY", event: "VIEWING_BOOKED", to: "VIEWING", description: "viewing slot booked" },
    {
      from: "ENQUIRY",
      event: "APPLIED",
      to: "SCREENING",
      description: "applicant applies without a booked viewing (walk-in, staff-entered)",
    },
    { from: "ENQUIRY", event: "WITHDRAWN", to: "WITHDRAWN", description: "applicant drops out" },
    { from: "VIEWING", event: "APPLIED", to: "SCREENING", description: "applicant applies" },
    {
      from: "VIEWING",
      event: "VIEWING_NO_SHOW",
      to: "WITHDRAWN",
      description: "applicant did not attend the viewing",
    },
    { from: "VIEWING", event: "WITHDRAWN", to: "WITHDRAWN", description: "applicant drops out" },
    { from: "SCREENING", event: "KYC_VERIFIED", to: "OFFER", description: "KYC verified" },
    { from: "SCREENING", event: "KYC_FAILED", to: "REJECTED", description: "fails checks" },
    { from: "SCREENING", event: "WITHDRAWN", to: "WITHDRAWN", description: "applicant drops out" },
    {
      from: "OFFER",
      event: "OFFER_ACCEPTED",
      to: "RESERVED",
      guard: (c) => (c.reservationPaid ? allow : deny("reservation payment not recorded")),
      description: "offer accepted + reservation paid",
    },
    {
      from: "OFFER",
      event: "OFFER_REVISED",
      to: "OFFER",
      description: "new offer revision (counter-offer or staff change); terms re-checked against limits",
    },
    { from: "OFFER", event: "OFFER_DECLINED", to: "WITHDRAWN", description: "applicant declines" },
    { from: "OFFER", event: "WITHDRAWN", to: "WITHDRAWN", description: "applicant drops out" },
    { from: "OFFER", event: "OFFER_EXPIRED", to: "WITHDRAWN", description: "offer expired" },
    { from: "RESERVED", event: "LEASE_CREATED", to: "CONVERTED", description: "lease created in CONTRACT" },
  ],
});
