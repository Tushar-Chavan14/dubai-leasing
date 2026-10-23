import { z } from "zod";

const DEFAULT_DEDUCTIONS = [
  { id: "cleaning", label: "Deep cleaning", unit: "room" as const, priceFils: 25_000 },
  { id: "repaint", label: "Repainting", unit: "room" as const, priceFils: 80_000 },
  { id: "wall_repair", label: "Wall hole or crack repair", unit: "item" as const, priceFils: 15_000 },
  { id: "key_replacement", label: "Key or access card replacement", unit: "item" as const, priceFils: 20_000 },
  { id: "fixture_repair", label: "Broken fixture or fitting repair", unit: "item" as const, priceFils: 30_000 },
  { id: "appliance_repair", label: "Appliance repair call-out", unit: "item" as const, priceFils: 35_000 },
  { id: "floor_repair", label: "Floor damage repair", unit: "sqm" as const, priceFils: 12_000 },
];

/**
 * Company limits (policy, not law). Stored versioned in `company_policy`, editable by Admin.
 * Defaults below are placeholders until the client confirms them (docs/specs.md §10).
 */
export const CompanyPolicy = z.object({
  depositPercentUnfurnished: z.number().int().min(0).max(100),
  depositPercentFurnished: z.number().int().min(0).max(100),
  minCheques: z.number().int().min(1).max(12),
  maxCheques: z.number().int().min(1).max(12),
  maxRentFreeDays: z.number().int().min(0),
  refundApprovalThresholdFils: z.number().int().min(0),
  /** Asking-rent range per bedroom count ("0" = studio), annual, in fils. */
  askingRentRangeFils: z.record(z.string(), z.object({ min: z.number().int(), max: z.number().int() })),
  noticeAckFollowupDays: z.number().int().min(1),
  /** Below this decision-model confidence, a tenant comment goes to a person. Set from evals. */
  replyMinConfidence: z.number().min(0).max(1).default(0.6),
  /** At or above this probability, a comment is treated as a possible legal threat. Set from evals. */
  replyLegalThreatThreshold: z.number().min(0).max(1).default(0.5),
  /** Probability at which a comment counts as instructions aimed at the system (sent to a person). */
  replyInjectionThreshold: z.number().min(0).max(1).default(0.5),
  // --- applicant offers and checks (policy placeholders; docs/specs.md §10) ---
  /** Cheques proposed when the applicant hasn't asked for a number. */
  offerDefaultCheques: z.number().int().min(1).max(12).default(4),
  /** Days an offer stays open. */
  offerValidDays: z.number().int().min(1).max(60).default(7),
  /** Reservation payment as a percentage of annual rent. */
  reservationPercent: z.number().int().min(0).max(100).default(5),
  /** How far below the approved asking rent an offer may go without a manager. */
  maxRentDiscountPercent: z.number().int().min(0).max(100).default(0),
  /** Latest move-in date for an offer, in days from the offer date. */
  maxMoveInDays: z.number().int().min(0).max(365).default(60),
  /** An ID document must stay valid at least this many days after the lease starts. */
  kycMinValidityDays: z.number().int().min(0).max(365).default(30),
  /** Below this vision-model confidence a read field goes to a person. Set from evals. */
  kycMinConfidence: z.number().min(0).max(1).default(0.8),
  // --- contract and Ejari (policy placeholders) ---
  /** Days a contract signing link stays valid. */
  signLinkValidDays: z.number().int().min(1).max(60).default(14),
  /** Times an Ejari submission is retried when the registry is unreachable (not when it rejects). */
  ejariMaxAttempts: z.number().int().min(1).max(10).default(3),
  /** Below this decision-model confidence, an Ejari rejection is not mapped to a field (a person reads it). */
  ejariFieldMinConfidence: z.number().min(0).max(1).default(0.6),
  // --- Telegram enquiries and viewings (policy placeholders; docs/specs.md §10) ---
  /** Days viewings are offered, 0 = Sunday … 6 = Saturday (Asia/Dubai). */
  viewingDays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
  /** First viewing slot starts at this hour (Dubai time). */
  viewingStartHour: z.number().int().min(0).max(23).default(10),
  /** Last viewing slot ends by this hour (Dubai time). */
  viewingEndHour: z.number().int().min(1).max(24).default(18),
  viewingSlotMinutes: z.number().int().min(15).max(240).default(30),
  /** The earliest slot offered is at least this many hours away. */
  viewingLeadHours: z.number().int().min(0).max(168).default(4),
  /** Slots are offered this many days ahead. */
  viewingHorizonDays: z.number().int().min(1).max(30).default(7),
  /** Below this decision-model confidence, an enquiry goes to an officer. Set from evals. */
  enquiryIntentMinConfidence: z.number().min(0).max(1).default(0.6),
  /** At or above this probability an enquiry is commercial, VIP, a complaint or instructions to the system: an officer takes it. */
  enquiryHandoffThreshold: z.number().min(0).max(1).default(0.5),
  /** Messages per conversation per hour before the bot stops answering. */
  enquiryMaxMessagesPerHour: z.number().int().min(1).max(1000).default(30),
  // --- tenancy: move-in, links, collections, complaints (policy placeholders; docs/specs.md §10) ---
  /** Days the tenant has to confirm the move-in report (single-use link). */
  moveInAckDays: z.number().int().min(1).max(60).default(7),
  /** Days a tenancy portal link in a lease email stays valid. */
  tenancyLinkDays: z.number().int().min(1).max(180).default(30),
  /** A friendly rent reminder this many days before each due date. */
  rentReminderDaysBefore: z.number().int().min(0).max(60).default(7),
  /** An unconfirmed payment becomes overdue this many days after its due date. */
  paymentGraceDays: z.number().int().min(0).max(30).default(3),
  /** Days between friendly reminders for an overdue or bounced payment. */
  friendlyReminderIntervalDays: z.number().int().min(1).max(60).default(7),
  /** Friendly reminders before a formal reminder is drafted for a manager to approve. */
  friendlyRemindersBeforeFormal: z.number().int().min(1).max(10).default(2),
  /** Latest "will pay by" date a tenant can give, in days from today. */
  promiseToPayMaxDays: z.number().int().min(1).max(60).default(14),
  /** At or above this probability a complaint is a safety risk: escalated at once. Set from evals. */
  complaintSafetyThreshold: z.number().min(0).max(1).default(0.5),
  /** At or above this probability a complaint threatens legal action: escalated. Set from evals. */
  complaintLegalThreshold: z.number().min(0).max(1).default(0.5),
  /** Below this decision-model confidence in the category, a person triages the complaint. */
  complaintMinConfidence: z.number().min(0).max(1).default(0.5),
  /** Hours to fix by urgency (0 = can wait a week … 3 = emergency). */
  ticketDueHours: z
    .object({
      "0": z.number().int().positive(),
      "1": z.number().int().positive(),
      "2": z.number().int().positive(),
      "3": z.number().int().positive(),
    })
    .default({ "0": 168, "1": 48, "2": 24, "3": 4 }),
  // --- move-out and deposit (policy placeholders; docs/specs.md §10) ---
  /**
   * The company's price list for damage beyond normal wear and tear (fils per unit). Deductions
   * are only ever an item from this list × a quantity; any other amount needs finance's approval.
   */
  deductionPriceList: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9_]{2,40}$/),
        label: z.string().min(2).max(80),
        unit: z.enum(["item", "room", "sqm"]),
        priceFils: z.number().int().positive(),
      }),
    )
    .min(1)
    .default(DEFAULT_DEDUCTIONS),
  /** The tenancy page offers "Give notice to move out" from this many days before the lease end. */
  vacateNoticeOpensDays: z.number().int().min(0).max(365).default(150),
  /** The tenant can book the move-out inspection on days this far before the move-out date (and on it). */
  inspectionBookingWindowDays: z.number().int().min(0).max(30).default(7),
  /** Days the tenant has to accept or dispute the deposit statement before an officer follows up. */
  depositResponseDays: z.number().int().min(1).max(60).default(14),
  /** Below this vision-model confidence a photo comparison makes no suggestion. Set from evals. */
  exitVisionMinConfidence: z.number().min(0).max(1).default(0.6),
});
export type CompanyPolicy = z.infer<typeof CompanyPolicy>;

export const defaultCompanyPolicy: CompanyPolicy = {
  depositPercentUnfurnished: 5,
  depositPercentFurnished: 10,
  minCheques: 1,
  maxCheques: 12,
  maxRentFreeDays: 30,
  refundApprovalThresholdFils: 1_000_000, // AED 10,000
  askingRentRangeFils: {
    "0": { min: 3_500_000, max: 9_000_000 },
    "1": { min: 5_000_000, max: 13_000_000 },
    "2": { min: 7_500_000, max: 20_000_000 },
    "3": { min: 10_000_000, max: 30_000_000 },
    "4": { min: 14_000_000, max: 45_000_000 },
  },
  noticeAckFollowupDays: 5,
  replyMinConfidence: 0.6,
  replyLegalThreatThreshold: 0.5,
  replyInjectionThreshold: 0.5,
  offerDefaultCheques: 4,
  offerValidDays: 7,
  reservationPercent: 5,
  maxRentDiscountPercent: 0,
  maxMoveInDays: 60,
  kycMinValidityDays: 30,
  kycMinConfidence: 0.8,
  signLinkValidDays: 14,
  ejariMaxAttempts: 3,
  ejariFieldMinConfidence: 0.6,
  viewingDays: [1, 2, 3, 4, 5, 6],
  viewingStartHour: 10,
  viewingEndHour: 18,
  viewingSlotMinutes: 30,
  viewingLeadHours: 4,
  viewingHorizonDays: 7,
  enquiryIntentMinConfidence: 0.6,
  enquiryHandoffThreshold: 0.5,
  enquiryMaxMessagesPerHour: 30,
  moveInAckDays: 7,
  tenancyLinkDays: 30,
  rentReminderDaysBefore: 7,
  paymentGraceDays: 3,
  friendlyReminderIntervalDays: 7,
  friendlyRemindersBeforeFormal: 2,
  promiseToPayMaxDays: 14,
  complaintSafetyThreshold: 0.5,
  complaintLegalThreshold: 0.5,
  complaintMinConfidence: 0.5,
  ticketDueHours: { "0": 168, "1": 48, "2": 24, "3": 4 },
  deductionPriceList: DEFAULT_DEDUCTIONS,
  vacateNoticeOpensDays: 150,
  inspectionBookingWindowDays: 7,
  depositResponseDays: 14,
  exitVisionMinConfidence: 0.6,
};
