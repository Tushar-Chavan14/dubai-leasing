import { approvalGates, canDecideGate, type GateId, type StaffRole } from "@leasing/core";
import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import type { DecisionCard } from "../ui.ts";
import type { RecordRowDto } from "./list-records.ts";

const Input = z
  .object({
    action: z
      .enum(["approval", "site_visit"])
      .describe(
        "approval: approve or reject a pending approval (final contract, Ejari submission, identity check, any flag waiting for a person). site_visit: record whether the applicant came to the site visit.",
      ),
    record: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .optional()
      .describe("The application or lease reference, unit code or the person's name the user gave"),
    approvalId: z.uuid().optional().describe("An approval id from list_approvals, when known"),
  })
  .refine((v) => v.record || v.approvalId, "give the record or the approval id");

const Output = z.object({
  shown: z.number().int(),
  items: z.array(z.object({ ref: z.string().nullable(), what: z.string(), canDecide: z.boolean() })),
  note: z.string(),
  ui: z.object({ cards: z.array(z.custom<DecisionCard>()) }).optional(),
});

interface ApprovalRow {
  id: string;
  title: string;
  gate: string;
  gateLabel: string;
  entityKind: string;
  entityId: string;
  proposedBy: string;
}

const LEASING: readonly StaffRole[] = ["leasing_officer", "leasing_manager"];

/**
 * Puts a decision card in the chat when the user asks to approve, reject or record a site visit (D48). The card's
 * buttons run the inbox's or the application page's own route as the user; this tool decides nothing.
 */
export const showDecision: CopilotTool<typeof Input, typeof Output> = {
  name: "show_decision",
  kind: "read",
  description:
    'When the user asks you to approve, reject or record a site visit ("approve Lena\'s Ejari submission", "reject the contract for JVC-0412", "mark A-7KQ2MX as showed up"), show the decision card: it has Approve/Reject (or Came/Didn\'t come) buttons the user clicks. You never decide; never say it is approved or rejected.',
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ action, record, approvalId }, { engine, user }) {
    const rows = record
      ? (
          await engine.get<{ total: number; rows: RecordRowDto[] }>(
            `/api/copilot/records?q=${encodeURIComponent(record)}&limit=20`,
          )
        ).rows
      : [];
    const cards: DecisionCard[] = [];
    if (action === "approval") {
      const ids = new Set(rows.map((r) => r.id));
      const pending = (await engine.get<ApprovalRow[]>("/api/approvals?status=pending")).filter((a) =>
        approvalId ? a.id === approvalId : ids.has(a.entityId),
      );
      for (const a of pending.slice(0, 4)) {
        const row = rows.find((r) => r.id === a.entityId);
        const gate = a.gate as GateId;
        const own = a.proposedBy === `user:${user.id}` || a.proposedBy === `copilot:${user.id}`;
        const blocked = own
          ? "You prepared this, so another person decides it."
          : !canDecideGate(gate, user.role)
            ? `Decided by ${approvalGates[gate]?.approver.replace("_", " ") ?? "another role"}.`
            : undefined;
        cards.push({
          kind: "decision",
          decision: "approval",
          approvalId: a.id,
          title: a.title,
          gateLabel: a.gateLabel,
          ref: row?.ref ?? null,
          href: `/work?approval=${a.id}`,
          ...(blocked ? { blocked } : {}),
        });
      }
    } else {
      for (const r of rows.filter((x) => x.kind === "application" && x.stage === "Viewing").slice(0, 4)) {
        const blocked = LEASING.includes(user.role) ? undefined : "Leasing staff record site visits.";
        cards.push({
          kind: "decision",
          decision: "site_visit",
          applicationId: r.id,
          ref: r.ref,
          name: r.title,
          unit: r.unitCode,
          href: `/work?kind=application&id=${r.id}`,
          ...(blocked ? { blocked } : {}),
        });
      }
    }
    return {
      shown: cards.length,
      items: cards.map((c) => ({
        ref: c.ref,
        what: c.decision === "approval" ? untrusted(c.title) : "Site visit outcome",
        canDecide: !c.blocked,
      })),
      note: cards.length
        ? "The card is on screen with buttons; the user decides by clicking (a rejection needs their note). Nothing is approved, rejected or recorded until they click. Say so in one short sentence."
        : action === "approval"
          ? "Nothing waiting for approval matches. Say so; offer list_approvals."
          : "No application waiting for a site visit outcome matches. Say so.",
      ...(cards.length ? { ui: { cards } } : {}),
    };
  },
};
