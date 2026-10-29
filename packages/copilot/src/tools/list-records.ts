import { z } from "zod";
import type { StaffRole } from "@leasing/core";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { type RecordAction, type RecordCard, workHref } from "../ui.ts";

const STAGES = ["Enquiry", "Viewing", "Documents", "Offer", "Reserved", "Contract", "Ejari", "Registered"] as const;

const Input = z.object({
  stage: z.enum(STAGES).optional(),
  q: z.string().trim().min(2).max(100).optional().describe("Applicant or tenant name, unit code or reference"),
  company: z.string().trim().min(2).max(120).optional().describe("Company name, e.g. Silverline"),
  category: z.enum(["residential", "commercial", "retail"]).optional(),
  mine: z.boolean().optional().describe("Only records waiting for the user"),
  limit: z.number().int().min(1).max(20).default(10),
});
const Output = z.object({
  total: z.number().int().describe("How many records match, before the limit"),
  shown: z.number().int(),
  records: z.array(
    z.object({
      ref: z.string(),
      kind: z.enum(["application", "lease"]),
      name: z.string(),
      unit: z.string(),
      stage: z.string(),
      nextStep: z.string(),
      owner: z.string(),
    }),
  ),
  note: z.string(),
  ui: z.object({ cards: z.array(z.custom<RecordCard>()) }).optional(),
});

export interface RecordRowDto {
  kind: "application" | "lease";
  id: string;
  ref: string;
  title: string;
  unitCode: string;
  stage: string;
  nextStep: string;
  owner: string;
  /** A prepare-the-contract task is open: no prepared contract yet. */
  contractHeld?: boolean;
  /** The contract is out with the signers. */
  contractSent?: boolean;
}

/**
 * The quick actions for a record, chosen from its stage and flags (never by the model). Prompts name
 * the record by its reference only: applicant names are outsiders' text. Every action only asks the
 * copilot to propose or draft; the Confirm click (or the user's own send) is what acts.
 * `pendingSigners`: roles that have not signed yet (from contract_status), one resend action each.
 */
/** Who may run each card action: the roles of the propose or draft tool the prompt leads to. */
const PROPOSERS: readonly StaffRole[] = ["leasing_officer", "leasing_manager"];
const DRAFTERS: readonly StaffRole[] = ["leasing_officer", "leasing_manager", "finance"];

export function recordActions(r: RecordRowDto, pendingSigners: string[], role: StaffRole): RecordAction[] {
  const out: RecordAction[] = [];
  const say = (key: string, label: string, prompt: string) => {
    const allowed = (key === "email" ? DRAFTERS : PROPOSERS).includes(role);
    out.push({
      type: "prompt",
      key,
      label,
      prompt,
      ...(allowed
        ? {}
        : {
            blocked:
              key === "email" ? "Leasing or finance staff can do this" : "Leasing officers and managers can do this",
          }),
    });
  };
  if (r.kind === "application" && r.stage === "Enquiry")
    say(
      "invite",
      "Invite to viewing",
      `Propose inviting application ${r.ref} to a viewing: check the free slots and propose the earliest one.`,
    );
  if (r.kind === "application" && (r.stage === "Viewing" || r.stage === "Documents")) {
    say("docs", "Request documents", `Propose requesting the screening documents from the applicant on ${r.ref}.`);
    say("email", "Email applicant", `Draft an email to the applicant on ${r.ref}.`);
  }
  if (r.kind === "lease" && r.stage === "Contract") {
    if (r.contractHeld) say("prepare", "Prepare contract", `Propose preparing the contract for lease ${r.ref}.`);
    for (const role of pendingSigners)
      say(
        `resend-${role}`,
        pendingSigners.length > 1 ? `Resend signing link (${role})` : "Resend signing link",
        `Propose resending the signing link to the ${role} on lease ${r.ref}.`,
      );
  }
  out.push({ type: "link", key: "open", label: "Open in the Workspace", href: workHref(r.kind, r.id) });
  return out;
}

/** A record row as the card the chat shows (the name is shown raw: it is display, not model input). */
export const recordCard = (r: RecordRowDto, pendingSigners: string[], role: StaffRole): RecordCard => ({
  kind: "record",
  recordKind: r.kind,
  id: r.id,
  ref: r.ref,
  name: r.title,
  unit: r.unitCode,
  stage: r.stage,
  nextStep: r.nextStep,
  href: workHref(r.kind, r.id),
  actions: recordActions(r, pendingSigners, role),
});

/** The model's view of a record: applicant names are typed by outsiders, so they are wrapped. */
export const recordForModel = (r: RecordRowDto) => ({
  ref: r.ref,
  kind: r.kind,
  name: r.kind === "application" ? untrusted(r.title) : r.title,
  unit: r.unitCode,
  stage: r.stage,
  nextStep: r.nextStep,
  owner: r.owner,
});

export const listRecords: CopilotTool<typeof Input, typeof Output> = {
  name: "list_records",
  kind: "read",
  description:
    "Applications and leases on the pipeline, newest first, with ref, name, unit, stage, next step and owner, plus the total that match. Filter by stage, name or unit, company, category, or 'mine' (waiting for the user). Use it to list or count what is in a stage, e.g. offers waiting on applicants. The records show as cards in the chat.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ stage, q, company, category, mine, limit }, { engine, user }) {
    const params = [
      stage ? `stage=${stage}` : null,
      q ? `q=${encodeURIComponent(q)}` : null,
      company ? `company=${encodeURIComponent(company)}` : null,
      category ? `category=${category}` : null,
      mine === undefined ? null : `mine=${mine ? 1 : 0}`,
      `limit=${limit}`,
    ].filter(Boolean);
    const r = await engine.get<{ total: number; rows: RecordRowDto[] }>(`/api/copilot/records?${params.join("&")}`);
    return {
      total: r.total,
      shown: r.rows.length,
      records: r.rows.map(recordForModel),
      note: "Same records as the Workspace. For more detail on one, use get_record. The cards link to the Workspace.",
      ui: { cards: r.rows.map((x) => recordCard(x, [], user.role)) },
    };
  },
};
