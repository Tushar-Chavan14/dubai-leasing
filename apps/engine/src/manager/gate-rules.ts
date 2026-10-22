import {
  Addendum,
  AddendumFlag,
  type CalendarDate,
  ContractFields,
  EjariAutofix,
  EjariPayload,
  EjariRejection,
  formatAed,
  type GateId,
  isCalendarDate,
  OfferTerms,
} from "@leasing/core";
import { KycFlag, KycIdentity } from "@leasing/helpers";
import type { approvals } from "@leasing/db";
import {
  canSendRenewalNotice,
  getRulebook,
  isRenewalRentAllowed,
  maxRenewalRent,
  repossessionNoticeDeadline,
} from "@leasing/rulebook";
import { z } from "zod";

type ApprovalRow = typeof approvals.$inferSelect;

/** The proposal a decision applies: the edited one if a person edited it. */
export function effectiveProposal(
  a: Pick<ApprovalRow, "status" | "proposal" | "editedProposal">,
): Record<string, unknown> {
  return a.status === "edited" && a.editedProposal ? a.editedProposal : a.proposal;
}

const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");

export const RenewalNoticeProposal = z.object({
  leaseId: z.string(),
  leaseRef: z.string(),
  rulesVersion: z.string(),
  currentRentFils: z.number().int().positive(),
  proposedRentFils: z.number().int().positive(),
  sriAverageFils: z.number().int().positive().nullable(),
  leaseEndOn: calDate,
  sendOn: calDate,
  legalDeadline: calDate,
  newTermStartOn: calDate,
  newTermEndOn: calDate,
  /** From the renewal helper run (display and audit; the cap is re-checked from the rulebook). */
  maxRentFils: z.number().int().positive().optional(),
  maxIncreasePercent: z.number().int().min(0).optional(),
  sriSource: z.enum(["override", "table", "none"]).optional(),
  sriLabel: z.string().nullable().optional(),
  /** Who entered a lease-specific SRI value (they can't approve the notice it caps). */
  sriEnteredBy: z.string().optional(),
  helperRunId: z.string().optional(),
  /** Same-rent offer after the legal notice deadline passed without a sent increase notice. */
  sameRentFallback: z.boolean().optional(),
  note: z.string().max(2000).optional(),
});
export type RenewalNoticeProposal = z.infer<typeof RenewalNoticeProposal>;

/**
 * Landlord repossession notice (sale, own use, major works, demolition). It must be served by
 * notary or registered mail, never email, at least 12 months before lease end. CONFIRM WITH
 * LEGAL: whether "served" means sent or received, and how the effective date lines up with term end.
 */
export const VacateNoticeProposal = z.object({
  leaseId: z.string(),
  rulesVersion: z.string(),
  leaseEndOn: calDate,
  ground: z.enum(["sale", "own_use", "major_works", "demolition"]),
  servedOn: calDate,
  deliveryMethod: z.enum(["notary", "registered_mail"]),
  propertyKind: z.enum(["residential", "commercial"]),
  note: z.string().max(2000).optional(),
});
export type VacateNoticeProposal = z.infer<typeof VacateNoticeProposal>;

export function vacateNoticeProblems(raw: unknown, today: CalendarDate): string[] {
  const parsed = VacateNoticeProposal.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const p = parsed.data;
  const r = getRulebook(p.rulesVersion);
  const latest = repossessionNoticeDeadline(p.leaseEndOn as CalendarDate, r);
  const problems: string[] = [];
  if (p.servedOn > latest) {
    problems.push(
      `served ${p.servedOn}: a ${r.repossessionNoticeMonths}-month notice for a lease ending ${p.leaseEndOn} had to be served by ${latest} (${r.version})`,
    );
  }
  // Approve a notice that was actually served, not one planned for later.
  if (p.servedOn > today) problems.push(`served date ${p.servedOn} is in the future; approve after it is served`);
  return problems;
}

/**
 * Formal late-payment reminder (step 8, D27). Approving it sends the reminder; only its accepted
 * send starts the rulebook's waiting period. Nothing in it is editable: amounts come from the
 * payment record and the period from the lease's pinned rulebook.
 */
export const FormalReminderProposal = z.object({
  leaseId: z.string(),
  paymentId: z.string(),
  seq: z.number().int().min(1),
  of: z.number().int().min(1),
  amountFils: z.number().int().positive(),
  dueOn: calDate,
  paymentStatus: z.enum(["overdue", "bounced"]),
  friendlyReminders: z.number().int().min(0),
  rulesVersion: z.string(),
  lateRentDays: z.number().int().min(1),
});
export type FormalReminderProposal = z.infer<typeof FormalReminderProposal>;

export function formalReminderProblems(raw: unknown): string[] {
  const p = FormalReminderProposal.safeParse(raw);
  if (!p.success) return p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const r = getRulebook(p.data.rulesVersion);
  return p.data.lateRentDays === r.lateRentDaysAfterFormalReminder
    ? []
    : [`the waiting period must be the rulebook's ${r.lateRentDaysAfterFormalReminder} days (${r.version})`];
}

/**
 * Safety or legal-threat complaint (step 8, D28): an officer acts at once. Approving opens an
 * emergency maintenance ticket; rejecting closes the complaint with the officer's reason.
 */
export const SafetyComplaintProposal = z.object({
  leaseId: z.string(),
  complaintId: z.string(),
  category: z.string(),
  urgency: z.number().int().min(0).max(3),
  atRisk: z.boolean(),
  safety: z.number().nullable(),
  legalThreat: z.number().nullable(),
});
export type SafetyComplaintProposal = z.infer<typeof SafetyComplaintProposal>;

/** Asking rent outside the company range for the unit's bedroom count (policy, not law). */
export const PriceProposal = z.object({
  unitId: z.string(),
  unitCode: z.string(),
  bedrooms: z.number().int(),
  askingRentFils: z.number().int().positive(),
  rangeMinFils: z.number().int().nullable(),
  rangeMaxFils: z.number().int().nullable(),
  policyVersion: z.number().int().nullable(),
});
export type PriceProposal = z.infer<typeof PriceProposal>;

/**
 * KYC review (step 3): the documents didn't pass every check. The officer sees what was read and
 * why it was flagged. Approving copies the shown identity onto the applicant; nothing is retyped.
 * A blocking flag (an expired document) can never be approved: ask for a new document instead.
 */
export const KycReviewProposal = z.object({
  applicationId: z.string(),
  helperRunId: z.string(),
  identity: KycIdentity.nullable(),
  flags: z.array(KycFlag),
  documentIds: z.array(z.string()),
  applicantKind: z.enum(["individual", "company"]).optional(),
  note: z.string().max(2000).optional(),
});
export type KycReviewProposal = z.infer<typeof KycReviewProposal>;

/**
 * Identity documents must be valid on the day a decision is applied, and the main one must have a
 * known expiry date: an Emirates ID or passport for a person, the trade licence for a company.
 */
export function identityExpiryProblems(
  identity: KycIdentity,
  kind: "individual" | "company",
  today: CalendarDate | string,
): string[] {
  const problems: string[] = [];
  const dates: [string, string | null][] = [
    ["Emirates ID", identity.idExpiresOn],
    ["passport", identity.passportExpiresOn],
    ["visa", identity.visaExpiresOn],
    ["trade licence", identity.tradeLicenceExpiresOn],
  ];
  for (const [label, d] of dates) if (d && d < today) problems.push(`The ${label} expired on ${d}.`);
  if (kind === "company" ? !identity.tradeLicenceExpiresOn : !identity.idExpiresOn && !identity.passportExpiresOn) {
    problems.push("No expiry date is known for the main identity document.");
  }
  return problems;
}

/** Offer terms outside company limits (step 4); a leasing manager decides. Limits re-checked by the Manager. */
export const OfferLimitsProposal = z.object({
  applicationId: z.string(),
  terms: OfferTerms,
  problems: z.array(z.string()),
  /** The revision the applicant (or staff) countered. */
  fromRevision: z.number().int().min(1).nullable(),
  note: z.string().max(2000).optional(),
});
export type OfferLimitsProposal = z.infer<typeof OfferLimitsProposal>;

/**
 * Final contract (step 5, always): the officer checks every field against its source and the
 * addendum review's flags. Approving sends it for signature; it can't be edited (prepare a new
 * version instead). The Manager re-checks that the records and the PDF haven't changed.
 */
export const FinalContractProposal = z.object({
  leaseId: z.string(),
  leaseRef: z.string(),
  contractId: z.string(),
  version: z.number().int().min(1),
  reference: z.string(),
  sha256: z.string(),
  inputHash: z.string(),
  fields: ContractFields,
  sources: z.record(z.string(), z.object({ entity: z.string(), id: z.string(), column: z.string() })),
  addendum: Addendum,
  flags: z.array(AddendumFlag),
  reviewed: z.boolean(),
  note: z.string().max(2000).optional(),
});
export type FinalContractProposal = z.infer<typeof FinalContractProposal>;

/** Ejari submission (step 6, always while there is no live DLD access): the payload from the signed contract. */
export const EjariSubmissionProposal = z.object({
  leaseId: z.string(),
  leaseRef: z.string(),
  contractId: z.string(),
  signedSha256: z.string(),
  payload: EjariPayload,
  payloadSha256: z.string(),
  note: z.string().max(2000).optional(),
});
export type EjariSubmissionProposal = z.infer<typeof EjariSubmissionProposal>;

/**
 * Ejari rejected and the Registration helper could not (or may no longer) fix it. Approving
 * proposes a fresh submission from the signed contract (after the registry-side data or the
 * cause was fixed); rejecting leaves it with a person to amend the contract or cancel.
 */
export const EjariRejectedProposal = z.object({
  leaseId: z.string(),
  leaseRef: z.string(),
  submissionApprovalId: z.string(),
  attempts: z.array(
    z.object({
      submissionId: z.string(),
      attempt: z.number().int(),
      reasons: z.array(EjariRejection),
      autofix: z.array(EjariAutofix).nullable(),
    }),
  ),
  helperRunId: z.string().nullable(),
  helperReasons: z.array(z.string()),
  note: z.string().max(2000).optional(),
});
export type EjariRejectedProposal = z.infer<typeof EjariRejectedProposal>;

const shapeOnly = (schema: z.ZodTypeAny) => (raw: Record<string, unknown>) => {
  const p = schema.safeParse(raw);
  return p.success ? [] : p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

interface GateRule {
  /** Fields a person may change with "edit". Everything else must stay as proposed. */
  editable: readonly string[];
  /** Problems with approving `proposal` on `today`; empty = fine. Values come from the rulebook. */
  check(proposal: Record<string, unknown>, today: CalendarDate): string[];
}

const rules: Partial<Record<GateId, GateRule>> = {
  final_contract: { editable: [], check: shapeOnly(FinalContractProposal) },
  ejari_submission: { editable: [], check: shapeOnly(EjariSubmissionProposal) },
  ejari_rejected_twice: { editable: ["note"], check: shapeOnly(EjariRejectedProposal) },
  vacate_notice: { editable: [], check: (raw, today) => vacateNoticeProblems(raw, today) },
  formal_reminder: { editable: [], check: (raw) => formalReminderProblems(raw) },
  safety_complaint: { editable: ["note"], check: shapeOnly(SafetyComplaintProposal) },
  price_out_of_range: {
    editable: [],
    check: (raw) => {
      const p = PriceProposal.safeParse(raw);
      return p.success ? [] : p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    },
  },
  kyc_review: {
    editable: ["note"],
    check(raw, today) {
      const p = KycReviewProposal.safeParse(raw);
      if (!p.success) return p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      const problems = p.data.flags
        .filter((f) => f.blocking)
        .map((f) => `${f.message} A blocking problem can't be approved: ask the applicant for a new document.`);
      if (!p.data.identity?.fullNameEn && !p.data.identity?.companyName)
        problems.push("No name could be read from the documents.");
      // Validity is judged on the day of the decision, not the day the documents were read.
      if (p.data.identity) {
        const kind = p.data.applicantKind ?? (p.data.identity.tradeLicenceNo ? "company" : "individual");
        problems.push(...identityExpiryProblems(p.data.identity, kind, today));
      }
      return problems;
    },
  },
  offer_out_of_limits: {
    editable: ["note"],
    check(raw, today) {
      const p = OfferLimitsProposal.safeParse(raw);
      if (!p.success) return p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      // Out of company limits is what the manager is approving; hard bounds still apply.
      const t = p.data.terms;
      const problems: string[] = [];
      // A decision that arrives late can't send terms that are already out of date.
      if (t.expiresOn < today)
        problems.push(`These terms lapsed on ${t.expiresOn}; ask the applicant for a new answer.`);
      if (t.moveInOn <= today) problems.push(`The move-in date ${t.moveInOn} has passed.`);
      if (t.cheques < 1 || t.cheques > 12) problems.push("cheques must be between 1 and 12");
      if (t.annualRentFils <= 0) problems.push("rent must be positive");
      if (t.startOn !== t.moveInOn) problems.push("the term must start on the move-in date");
      return problems;
    },
  },
  renewal_notice: {
    editable: ["proposedRentFils", "note"],
    check(raw, today) {
      const parsed = RenewalNoticeProposal.safeParse(raw);
      if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      const p = parsed.data;
      const r = getRulebook(p.rulesVersion);
      const problems: string[] = [];
      if (!isRenewalRentAllowed(p.currentRentFils, p.proposedRentFils, p.sriAverageFils, r)) {
        problems.push(
          p.sriAverageFils === null
            ? `no SRI average on record: rent can't go above the current ${formatAed(p.currentRentFils)} (${r.version})`
            : `above the legal cap of ${formatAed(maxRenewalRent(p.currentRentFils, p.sriAverageFils, r))} (${r.version})`,
        );
      }
      const end = p.leaseEndOn as CalendarDate;
      if (p.proposedRentFils > p.currentRentFils && !canSendRenewalNotice(today, end, r)) {
        problems.push(
          `rent-increase notice can no longer be sent: legal deadline was ${p.legalDeadline} (${r.renewalNoticeDays} days before ${p.leaseEndOn})`,
        );
      }
      return problems;
    },
  },
};

/** Validates an approve/edit decision. Returns problems; empty means the decision may proceed. */
export function checkDecision(
  gate: GateId,
  original: Record<string, unknown>,
  decision: { decision: "approve" } | { decision: "edit"; proposal: Record<string, unknown> },
  today: CalendarDate,
): string[] {
  const rule = rules[gate];
  if (decision.decision === "edit") {
    if (!rule || rule.editable.length === 0) return [`${gate} proposals can't be edited; reject with a note instead`];
    const changed = Object.keys({ ...original, ...decision.proposal }).filter(
      (k) => JSON.stringify(original[k]) !== JSON.stringify(decision.proposal[k]) && k in decision.proposal,
    );
    const locked = changed.filter((k) => !rule.editable.includes(k));
    if (locked.length) return locked.map((k) => `${k} can't be edited`);
    return rule.check({ ...original, ...decision.proposal }, today);
  }
  return rule ? rule.check(original, today) : [];
}
