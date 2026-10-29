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

export const AutopilotStep = z.enum([
  "chat_viewing_booking",
  "apply_without_viewing",
  "auto_kyc_verify",
  "auto_send_offer",
  "auto_send_counter",
  "auto_prepare_contract",
  // --- slice 4: more agent permissions (decision D37). None of them touches a locked gate. ---
  "agent_free_text_book",
  "agent_free_text_apply",
  "viewing_reminder",
  "no_show_followup",
  "kyc_chase",
  "ejari_draft_auto",
  "sign_reminder",
  "held_offer_auto_release",
  "agent_sri_answers",
  "agent_suggest_alternatives",
  "contract_ai_auto_approve_valueless",
  "copilot_proactive_drafts",
  "quiet_hours",
]);
export type AutopilotStep = z.infer<typeof AutopilotStep>;

export const DEFAULT_AUTOPILOT: Record<AutopilotStep, boolean> = {
  chat_viewing_booking: true,
  apply_without_viewing: false,
  auto_kyc_verify: true,
  auto_send_offer: true,
  auto_send_counter: true,
  auto_prepare_contract: true,
  agent_free_text_book: true,
  agent_free_text_apply: true,
  viewing_reminder: true,
  no_show_followup: false,
  kyc_chase: true,
  ejari_draft_auto: true,
  sign_reminder: true,
  held_offer_auto_release: false,
  agent_sri_answers: true,
  agent_suggest_alternatives: true,
  contract_ai_auto_approve_valueless: false,
  copilot_proactive_drafts: false,
  quiet_hours: true,
};

/** Numbers stored next to the switches, each bounded (an out-of-range save is refused, never clamped). */
export const AUTOPILOT_NUMBERS = {
  viewing_reminder_hours: { label: "Remind before the viewing", unit: "hours", min: 1, max: 72, default: 24 },
  kyc_chase_hours: { label: "Chase documents after", unit: "hours without an upload", min: 6, max: 336, default: 48 },
  sign_reminder_days: { label: "Remind signers after", unit: "days", min: 1, max: 14, default: 3 },
  held_offer_release_hours: { label: "Release a held offer after", unit: "hours", min: 1, max: 168, default: 24 },
  quiet_hours_start: { label: "Quiet hours start", unit: "hour, Dubai time (0 to 23)", min: 0, max: 23, default: 22 },
  quiet_hours_end: { label: "Quiet hours end", unit: "hour, Dubai time (0 to 23)", min: 0, max: 23, default: 8 },
  agent_daily_action_cap: {
    label: "Bookings and applications per chat per day",
    unit: "actions",
    min: 1,
    max: 50,
    default: 5,
  },
} as const;
export type AutopilotNumber = keyof typeof AUTOPILOT_NUMBERS;
export const AUTOPILOT_NUMBER_IDS = Object.keys(AUTOPILOT_NUMBERS) as AutopilotNumber[];

export const DEFAULT_AUTOPILOT_NUMBERS: Record<AutopilotNumber, number> = Object.fromEntries(
  AUTOPILOT_NUMBER_IDS.map((k) => [k, AUTOPILOT_NUMBERS[k].default]),
) as Record<AutopilotNumber, number>;

export const QUIET_HOURS_SAME = "Quiet hours must start and end at different hours.";

/** What a save may contain: any of the switches and numbers; numbers keep their bounds. */
export const AutopilotPatch = z
  .object({
    ...Object.fromEntries(AutopilotStep.options.map((k) => [k, z.boolean().optional()])),
    ...Object.fromEntries(
      AUTOPILOT_NUMBER_IDS.map((k) => [
        k,
        z.number().int().min(AUTOPILOT_NUMBERS[k].min).max(AUTOPILOT_NUMBERS[k].max).optional(),
      ]),
    ),
  })
  .strict() as z.ZodType<Partial<Record<AutopilotStep, boolean>> & Partial<Record<AutopilotNumber, number>>>;
export type AutopilotPatch = z.infer<typeof AutopilotPatch>;

export type AutopilotGroup = "Chat agent" | "Reminders" | "Offers and contracts" | "Copilot" | "Limits";
export const AUTOPILOT_GROUPS: AutopilotGroup[] = [
  "Chat agent",
  "Reminders",
  "Offers and contracts",
  "Copilot",
  "Limits",
];

/**
 * Agent permissions shown to admins: label and what switching the step off does (spec §5).
 * `numbers` are the bounded settings that belong to the step and are shown under its switch.
 */
export const AUTOPILOT_STEPS: {
  id: AutopilotStep;
  group: AutopilotGroup;
  label: string;
  offMeans: string;
  numbers?: AutopilotNumber[];
}[] = [
  {
    id: "chat_viewing_booking",
    group: "Chat agent",
    label: "Chat books viewings",
    offMeans: "The chat takes details and an officer books the viewing.",
  },
  {
    id: "agent_free_text_book",
    group: "Chat agent",
    label: "Book from typed messages",
    offMeans: "The chat shows a time to tap and books only after the visitor taps it.",
  },
  {
    id: "apply_without_viewing",
    group: "Chat agent",
    label: "Apply without a viewing",
    offMeans: "A viewing is required before an application is created.",
  },
  {
    id: "agent_free_text_apply",
    group: "Chat agent",
    label: "Apply from typed messages",
    offMeans: "The chat shows an Apply button and applies only after the visitor taps it.",
  },
  {
    id: "agent_sri_answers",
    group: "Chat agent",
    label: "Answer rent index questions",
    offMeans: "The chat does not quote average rents for an area.",
  },
  {
    id: "agent_suggest_alternatives",
    group: "Chat agent",
    label: "Suggest other units when one is taken",
    offMeans: "The chat says the unit is gone and offers a normal search.",
  },
  {
    id: "viewing_reminder",
    group: "Reminders",
    label: "Remind applicants before a viewing",
    offMeans: "No reminder email goes out before a viewing.",
    numbers: ["viewing_reminder_hours"],
  },
  {
    id: "no_show_followup",
    group: "Reminders",
    label: "Follow up after a no-show",
    offMeans: "No email goes to an applicant who missed the viewing.",
  },
  {
    id: "kyc_chase",
    group: "Reminders",
    label: "Chase missing documents",
    offMeans: "Nobody reminds the applicant to upload documents.",
    numbers: ["kyc_chase_hours"],
  },
  {
    id: "sign_reminder",
    group: "Reminders",
    label: "Remind signers",
    offMeans: "Nobody reminds a signer who has not signed.",
    numbers: ["sign_reminder_days"],
  },
  {
    id: "quiet_hours",
    group: "Reminders",
    label: "Hold reminders during quiet hours",
    offMeans: "Reminders go out at any hour.",
    numbers: ["quiet_hours_start", "quiet_hours_end"],
  },
  {
    id: "auto_kyc_verify",
    group: "Offers and contracts",
    label: "Verify clean KYC automatically",
    offMeans: "Every KYC result waits for an officer to review it.",
  },
  {
    id: "auto_send_offer",
    group: "Offers and contracts",
    label: "Send offers within limits",
    offMeans: "Every offer waits for an officer to send it.",
  },
  {
    id: "held_offer_auto_release",
    group: "Offers and contracts",
    label: "Release a held offer by itself",
    offMeans: "A held offer waits until an officer sends it.",
    numbers: ["held_offer_release_hours"],
  },
  {
    id: "auto_send_counter",
    group: "Offers and contracts",
    label: "Answer counter-offers within limits",
    offMeans: "Every counter-offer waits for an officer to send it.",
  },
  {
    id: "auto_prepare_contract",
    group: "Offers and contracts",
    label: "Prepare the contract automatically",
    offMeans: "An officer is asked to prepare the contract.",
  },
  {
    id: "contract_ai_auto_approve_valueless",
    group: "Offers and contracts",
    label: "Approve clauses without amounts or dates",
    offMeans: "An admin approves every clause read from a sample contract.",
  },
  {
    id: "ejari_draft_auto",
    group: "Offers and contracts",
    label: "Draft the Ejari submission after signing",
    offMeans: "An officer is asked to draft it. A person always approves the submission.",
  },
  {
    id: "copilot_proactive_drafts",
    group: "Copilot",
    label: "Suggest reply drafts in the Workspace",
    offMeans: "No Draft a reply button appears. Nothing is ever sent for you.",
  },
];

/** The cap is a limit, not a switch: shown under its own heading. */
export const AUTOPILOT_LIMIT_NUMBERS: AutopilotNumber[] = ["agent_daily_action_cap"];

export const LOCKED_STEPS: { label: string; reason: string }[] = [
  "Final contract",
  "Ejari submission",
  "Offer or price outside limits",
  "Flagged KYC",
  "Recording a reservation payment",
].map((label) => ({ label, reason: "Required by law or company money rules. A person always decides." }));

const autopilotNumber = (k: AutopilotNumber) =>
  z.number().int().min(AUTOPILOT_NUMBERS[k].min).max(AUTOPILOT_NUMBERS[k].max).default(AUTOPILOT_NUMBERS[k].default);

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
  /** Agent permissions: which steps the agents may take without a person. */
  autopilot: z
    .object({
      chat_viewing_booking: z.boolean(),
      apply_without_viewing: z.boolean(),
      auto_kyc_verify: z.boolean(),
      auto_send_offer: z.boolean(),
      auto_send_counter: z.boolean(),
      auto_prepare_contract: z.boolean(),
      // Added in slice 4: a policy stored before that has none of these, so each has its default.
      agent_free_text_book: z.boolean().default(DEFAULT_AUTOPILOT.agent_free_text_book),
      agent_free_text_apply: z.boolean().default(DEFAULT_AUTOPILOT.agent_free_text_apply),
      viewing_reminder: z.boolean().default(DEFAULT_AUTOPILOT.viewing_reminder),
      no_show_followup: z.boolean().default(DEFAULT_AUTOPILOT.no_show_followup),
      kyc_chase: z.boolean().default(DEFAULT_AUTOPILOT.kyc_chase),
      ejari_draft_auto: z.boolean().default(DEFAULT_AUTOPILOT.ejari_draft_auto),
      sign_reminder: z.boolean().default(DEFAULT_AUTOPILOT.sign_reminder),
      held_offer_auto_release: z.boolean().default(DEFAULT_AUTOPILOT.held_offer_auto_release),
      agent_sri_answers: z.boolean().default(DEFAULT_AUTOPILOT.agent_sri_answers),
      agent_suggest_alternatives: z.boolean().default(DEFAULT_AUTOPILOT.agent_suggest_alternatives),
      contract_ai_auto_approve_valueless: z.boolean().default(DEFAULT_AUTOPILOT.contract_ai_auto_approve_valueless),
      copilot_proactive_drafts: z.boolean().default(DEFAULT_AUTOPILOT.copilot_proactive_drafts),
      quiet_hours: z.boolean().default(DEFAULT_AUTOPILOT.quiet_hours),
      viewing_reminder_hours: autopilotNumber("viewing_reminder_hours"),
      kyc_chase_hours: autopilotNumber("kyc_chase_hours"),
      sign_reminder_days: autopilotNumber("sign_reminder_days"),
      held_offer_release_hours: autopilotNumber("held_offer_release_hours"),
      quiet_hours_start: autopilotNumber("quiet_hours_start"),
      quiet_hours_end: autopilotNumber("quiet_hours_end"),
      agent_daily_action_cap: autopilotNumber("agent_daily_action_cap"),
    })
    .default({ ...DEFAULT_AUTOPILOT, ...DEFAULT_AUTOPILOT_NUMBERS }),
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
  autopilot: { ...DEFAULT_AUTOPILOT, ...DEFAULT_AUTOPILOT_NUMBERS },
};

/**
 * Quiet hours (Asia/Dubai wall clock, no DST). A reminder due inside the window is moved to the
 * moment it ends. `start` > `end` wraps midnight (22 to 8); `start` = `end` is an empty window.
 * Pure: the caller passes the Clock's instant.
 */
export function postponeOutOfQuietHours(at: Date, start: number, end: number): Date {
  if (start === end) return at;
  const dubai = new Date(at.getTime() + 4 * 3_600_000);
  const hour = dubai.getUTCHours();
  const inside = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!inside) return at;
  // Midnight (Dubai) of the day the window ends, then its end hour.
  const dayStart = Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), dubai.getUTCDate());
  const endsNextDay = start > end && hour >= start;
  return new Date(dayStart + (endsNextDay ? 86_400_000 : 0) + end * 3_600_000 - 4 * 3_600_000);
}

/** True when `at` falls inside the window. */
export const inQuietHours = (at: Date, start: number, end: number) =>
  postponeOutOfQuietHours(at, start, end).getTime() !== at.getTime();
