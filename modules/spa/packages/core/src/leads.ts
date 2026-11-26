import { z } from "zod";

/** Where a lead came from (S79): the public form, the listing chat, or a person typing one in. */
export const LEAD_SOURCES = ["form", "listing_chat", "staff"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const LEAD_SOURCE_LABELS: Readonly<Record<LeadSource, string>> = Object.freeze({
  form: "Property page form",
  listing_chat: "Listing chat",
  staff: "Entered by staff",
});

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "viewing_booked",
  "interested",
  "not_interested",
  "converted",
  "closed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABELS: Readonly<Record<LeadStatus, string>> = Object.freeze({
  new: "New",
  contacted: "Contacted",
  viewing_booked: "Viewing booked",
  interested: "Interested",
  not_interested: "Not interested",
  converted: "Deal started",
  closed: "Closed",
});
/** Statuses a person may set by hand. `viewing_booked` comes from a booking, `converted` from the deal (M6). */
export const LEAD_MANUAL_STATUSES = ["contacted", "interested", "not_interested", "closed"] as const;
export type LeadManualStatus = (typeof LEAD_MANUAL_STATUSES)[number];
/** A lead in one of these is "open": one per (email, property). */
export const LEAD_CLOSED_STATUSES: readonly LeadStatus[] = ["converted", "closed"];

export const VIEWING_STATUSES = ["booked", "cancelled", "attended", "no_show"] as const;
export type ViewingStatus = (typeof VIEWING_STATUSES)[number];
export const VIEWING_STATUS_LABELS: Readonly<Record<ViewingStatus, string>> = Object.freeze({
  booked: "Booked",
  cancelled: "Cancelled",
  attended: "Attended",
  no_show: "No-show",
});

/** What a visitor types: the public form, the listing chat and staff entry all pass through this. */
const visitor = {
  // Letters, spaces, apostrophes, hyphens and dots only: the name is greeted in mail sent to an address the visitor chose, so
  // it can't carry a link, an address or a number.
  name: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u, "enter your name"),
  email: z
    .email()
    .max(200)
    .transform((e) => e.toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d][\d\s()-]{5,}$/, "enter a phone number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  message: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** The consent tick: stored only with it ticked (rule 8). */
  consent: z.literal(true),
};

/** A property is named by its public reference (`L-0001` for a listing, `U-<project>-<unit>` for a developer unit). */
export const PropertyRef = z.string().trim().min(3).max(80);

export const LeadInput = z.object({
  ref: PropertyRef,
  ...visitor,
  /** An enquiry has a message; a booking may not. */
  message: z.string().trim().min(1).max(2000),
});
export type LeadInput = z.infer<typeof LeadInput>;

export const ViewingBookInput = z.object({
  ref: PropertyRef,
  /** An ISO instant taken from the offered slots; the engine refuses any other. */
  slot: z.iso.datetime({ offset: true }),
  ...visitor,
});
export type ViewingBookInput = z.infer<typeof ViewingBookInput>;

export const ViewingOutcome = z.object({
  outcome: z.enum(["attended", "no_show"]),
  note: z.string().trim().max(1000).optional(),
});
export type ViewingOutcome = z.infer<typeof ViewingOutcome>;

/** Staff typing in a lead or booking for a visitor (consent is theirs to confirm: they spoke to the person). */
export const StaffLeadInput = z.object({
  ref: PropertyRef,
  name: visitor.name,
  email: visitor.email,
  phone: visitor.phone,
  message: z.string().trim().min(1).max(2000),
});
export type StaffLeadInput = z.infer<typeof StaffLeadInput>;
