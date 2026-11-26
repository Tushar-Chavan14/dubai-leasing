import { z } from "zod";
import { DealType } from "./state/deal.ts";

const bps = z.number().int().min(0).max(10_000);
const signers = z
  .array(z.enum(["buyer", "seller"]))
  .refine((s) => s.length === 2 && new Set(s).size === 2, "each of buyer and seller once");

/** Mon–Sat, 10:00–18:00 Dubai, 30 minutes, at least 4 hours ahead, up to 14 days ahead (S79; placeholders). */
const DEFAULT_VIEWINGS = {
  viewingDays: [1, 2, 3, 4, 5, 6],
  viewingStartHour: 10,
  viewingEndHour: 18,
  viewingSlotMinutes: 30,
  viewingLeadHours: 4,
  viewingHorizonDays: 14,
};

/**
 * Company policy (architecture §6): the company's own choices, versioned, never law. The defaults are placeholders a
 * company changes in Settings; legal and money rules come from `@spa/rulebook`.
 */
export const SpaPolicy = z
  .object({
    /** Primary: the largest discount off the list price without `price_out_of_range`. */
    maxDiscountBps: bps,
    commission: z.object({ sellerSideBps: bps, buyerSideBps: bps }),
    /** Resale security deposit (S18), as a share of the price. */
    depositBps: bps,
    /** Primary: days a unit stays held for a booking. */
    holdDays: z.number().int().min(1).max(60),
    /** Resale: days the sellers have to answer an offer (S18; placeholder, confirm with the business). */
    offerValidityDays: z.number().int().min(1).max(30).default(3),
    /**
     * Company checks: a trade licence must stay valid at least this many days from the check (S52). Placeholder,
     * confirm with legal.
     */
    companyLicenceMinDays: z.number().int().min(1).max(365).default(30),
    /** Days a signing link stays valid after it is emailed (S54; ruled 14, confirm with the business). */
    signingLinkDays: z.number().int().min(1).max(60).default(14),
    /** Days a buyer or seller portal documents link lives (C35, S67). A placeholder: confirm with the business. */
    documentLinkDays: z.number().int().min(1).max(60).default(14),
    /**
     * Days past an instalment's due date after which the deal is flagged `in_default` (S55). A placeholder: confirm with
     * legal. Only flags; it changes no state and sends no notice.
     */
    defaultAfterDays: z.number().int().min(1).max(180).default(30),
    /**
     * Instalment reminders (S56): emailed to the buyers this many days before a dated instalment is due (`beforeDays`,
     * furthest first) and this many days after (`afterDays`, nearest first); an unpaid instalment also opens a task for
     * the sales officer at the first day after. Placeholders: confirm the days with the business. Fixed wording, no
     * switch to turn collections off (S22).
     */
    instalmentReminders: z
      .object({
        beforeDays: z
          .array(z.number().int().min(1).max(90))
          .max(5)
          .refine((d) => d.every((x, i) => i === 0 || x < d[i - 1]!), "furthest first, no repeats"),
        afterDays: z
          .array(z.number().int().min(1).max(180))
          .max(5)
          .refine((d) => d.every((x, i) => i === 0 || x > d[i - 1]!), "nearest first, no repeats"),
      })
      .default({ beforeDays: [14, 3], afterDays: [1] }),
    /** Chasing (S23, S60): a chase goes at the request and again after each of these days; then `chaseTaskAfterDays`. */
    reminderDays: z
      .array(z.number().int().min(1).max(60))
      .refine((d) => d.every((x, i) => i === 0 || x > d[i - 1]!), "ascending, no repeats"),
    /**
     * Days after the first chase when an unanswered item becomes a task for the agent (S60). Must be later than the last
     * reminder day. Placeholder, confirm with the business.
     */
    chaseTaskAfterDays: z.number().int().min(1).max(90).default(7),
    /**
     * Years a deal's records are kept after the deal ends (S29, S62). Only the monthly retention list reads it; nothing is
     * deleted yet. A placeholder: confirm with compliance.
     */
    retentionYears: z.number().int().min(1).max(30).default(5),
    /**
     * The listing page chat's caps for all visitors together (S61 amendment): messages and enquiries per listing per
     * hour, on top of the per-visitor limits, because a visitor's address can't be fully trusted. Placeholders.
     */
    listingChat: z
      .object({
        messagesPerListingPerHour: z.number().int().min(1).max(10_000),
        enquiriesPerListingPerHour: z.number().int().min(1).max(1_000),
      })
      .default({ messagesPerListingPerHour: 200, enquiriesPerListingPerHour: 10 }),
    /**
     * Viewings (S79): the days (0 = Sunday), hours, slot length, lead time and horizon the public slots follow, in
     * Asia/Dubai time. `perEmailPerDay` caps how many enquiries one email may send (all homes together). Placeholders.
     */
    viewings: z
      .object({
        viewingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        viewingStartHour: z.number().int().min(0).max(23),
        viewingEndHour: z.number().int().min(1).max(24),
        viewingSlotMinutes: z.number().int().min(15).max(120),
        viewingLeadHours: z.number().int().min(0).max(168),
        viewingHorizonDays: z.number().int().min(1).max(60),
      })
      .refine((v) => v.viewingStartHour < v.viewingEndHour, {
        path: ["viewingEndHour"],
        message: "closing hour must be after the opening hour",
      })
      .default(DEFAULT_VIEWINGS),
    leads: z.object({ perEmailPerDay: z.number().int().min(1).max(100) }).default({ perEmailPerDay: 5 }),
    signingOrder: z.record(DealType, signers),
    nocRules: z
      .array(
        z.object({
          /** null = the default for projects without their own rule. */
          projectCode: z.string().trim().min(1).max(40).nullable(),
          minPaidBps: bps,
          validityDays: z.number().int().min(1).max(365),
        }),
      )
      .refine((r) => r.filter((x) => x.projectCode === null).length === 1, "exactly one default NOC rule"),
  })
  .refine((p) => p.chaseTaskAfterDays > (p.reminderDays.at(-1) ?? 0), {
    path: ["chaseTaskAfterDays"],
    message: "must be later than the last reminder day",
  });
export type SpaPolicy = z.infer<typeof SpaPolicy>;

/** Placeholders until a company publishes its own policy (version 0). */
export const DEFAULT_SPA_POLICY: SpaPolicy = Object.freeze({
  maxDiscountBps: 500,
  commission: { sellerSideBps: 200, buyerSideBps: 200 },
  depositBps: 1000,
  holdDays: 7,
  offerValidityDays: 3,
  companyLicenceMinDays: 30,
  signingLinkDays: 14,
  documentLinkDays: 14,
  defaultAfterDays: 30,
  instalmentReminders: { beforeDays: [14, 3], afterDays: [1] },
  reminderDays: [2, 5],
  chaseTaskAfterDays: 7,
  retentionYears: 5,
  listingChat: { messagesPerListingPerHour: 200, enquiriesPerListingPerHour: 10 },
  viewings: DEFAULT_VIEWINGS,
  leads: { perEmailPerDay: 5 },
  signingOrder: {
    primary_offplan: ["buyer", "seller"],
    resale_ready: ["buyer", "seller"],
    resale_offplan: ["buyer", "seller"],
  },
  nocRules: [{ projectCode: null, minPaidBps: 4000, validityDays: 30 }],
}) as SpaPolicy;
