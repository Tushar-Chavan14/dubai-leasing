import { formatAed } from "@leasing/core";
import type { NoticeDocument } from "../renewal/notice.ts";

/**
 * The formal late-payment reminder (step 8), as a document. Every value is filled from records
 * and the rulebook pinned on the lease; the waiting period is the rulebook's, never a literal.
 * Wording to be reviewed by a Dubai property lawyer before real use.
 */
export interface FormalReminderInput {
  reference: string;
  issuedOn: string;
  tenantName: string;
  landlordName: string;
  unitLabel: string;
  leaseRef: string;
  ejariNo: string | null;
  instalment: { n: number; of: number; dueOn: string; amountFils: number; bounced: boolean };
  /** `lateRentDaysAfterFormalReminder` from the rulebook version below. */
  lateRentDays: number;
  rulesVersion: string;
  demo: boolean;
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${d}T08:00:00Z`),
  );

export function formalReminderNotice(n: FormalReminderInput): NoticeDocument {
  const title = "Formal reminder of unpaid rent";
  return {
    title,
    blocks: [
      { kind: "title", text: title },
      {
        kind: "meta",
        rows: [
          ["Reference", n.reference],
          ["Date", fmtDate(n.issuedOn)],
          ["To (tenant)", n.tenantName],
          ["From (landlord)", n.landlordName],
        ],
      },
      { kind: "heading", text: "The tenancy" },
      {
        kind: "facts",
        rows: [
          ["Unit", n.unitLabel],
          ["Lease", n.leaseRef],
          ["Ejari number", n.ejariNo ?? "—"],
        ],
      },
      { kind: "heading", text: "The unpaid amount" },
      {
        kind: "facts",
        rows: [
          ["Instalment", `${n.instalment.n} of ${n.instalment.of}`],
          ["Due on", fmtDate(n.instalment.dueOn)],
          ["Amount", formatAed(n.instalment.amountFils)],
          ["Status", n.instalment.bounced ? "Cheque returned by the bank" : "Not received"],
        ],
      },
      {
        kind: "para",
        text: `This is a formal reminder that the amount above remains unpaid. Please pay it, or contact the leasing team. If it remains unpaid, the landlord may take further steps under the rules that apply to this tenancy after ${n.lateRentDays} days from the date of this reminder.`,
      },
      { kind: "small", text: `Rules applied: ${n.rulesVersion}.` },
      ...(n.demo
        ? [
            {
              kind: "small" as const,
              text: "Demo build: wording to be reviewed by a lawyer before real use; Ejari is simulated.",
            },
          ]
        : []),
    ],
  };
}
