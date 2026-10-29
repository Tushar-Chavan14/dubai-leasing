import { z } from "zod";
import { EngineError, ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { type RecordCard } from "../ui.ts";
import { recordCard, type RecordRowDto, recordForModel } from "./list-records.ts";

const Input = z
  .object({
    ref: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .optional()
      .describe("Application or lease reference (A-7KQ2MX), or a unit code"),
    kind: z.enum(["application", "lease"]).optional(),
    id: z.uuid().optional(),
  })
  .refine((v) => v.ref || (v.kind && v.id), "give a ref, or kind and id");
const Output = z.object({
  found: z.boolean(),
  record: z
    .object({
      ref: z.string(),
      kind: z.enum(["application", "lease"]),
      name: z.string(),
      unit: z.string(),
      stage: z.string(),
      nextStep: z.string(),
      owner: z.string(),
      waitingForYou: z.boolean(),
    })
    .optional(),
  recent: z.array(z.object({ at: z.string(), by: z.string(), text: z.string() })),
  pendingActions: z.array(z.string()),
  note: z.string(),
  ui: z.object({ cards: z.array(z.custom<RecordCard>()) }).optional(),
});

interface Row extends RecordRowDto {
  waitingForMe: boolean;
}
interface LogEntry {
  at: string;
  actor: { kind: string; name: string };
  text: string;
  tenancy?: boolean;
  pending: boolean;
  actions: string[];
}

const ACTION_WORDS: Record<string, string> = {
  approve: "approve",
  reject: "reject",
  edit: "edit and approve",
  send_offer: "send the offer",
  prepare_contract: "prepare the contract",
  record_viewing_outcome: "record the viewing outcome",
  record_reservation: "record the reservation payment",
  done: "mark it done",
};

export const getRecord: CopilotTool<typeof Input, typeof Output> = {
  name: "get_record",
  kind: "read",
  description:
    "One application or lease from the pipeline: its stage, next step and owner, the last 10 entries of its activity log, and the actions this user could take on it in the Workspace (described only; the copilot can't take them). Use it for 'what is happening with A-…' questions.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ ref, kind, id }, { engine, tenancyOps, user }) {
    const q = ref ?? id!;
    const found = await engine.get<{ total: number; rows: Row[] }>(
      `/api/copilot/records?${id ? `id=${id}&limit=1` : `q=${encodeURIComponent(q)}&limit=20`}`,
    );
    const norm = q.toLowerCase();
    const exact = found.rows.filter((r) => r.ref.toLowerCase() === norm || r.unitCode.toLowerCase() === norm);
    const row = id
      ? found.rows.find((r) => r.kind === kind)
      : exact.length === 1
        ? exact[0]
        : found.rows.length === 1
          ? found.rows[0]
          : undefined;
    if (!row) {
      // Unknown or off-pipeline reference (rejected, withdrawn): a plain answer, not a tool failure.
      if (!found.rows.length || id)
        return {
          found: false,
          recent: [],
          pendingActions: [],
          note: `No application or lease on the pipeline matches "${q}". It may be mistyped, or the application was rejected or withdrawn.`,
        };
      throw new EngineError(
        409,
        `"${q}" matches several records: ${found.rows
          .slice(0, 5)
          .map((r) => `${r.ref} (${r.unitCode})`)
          .join(", ")}. Ask which one.`,
      );
    }
    // While TENANCY_OPS is off the copilot stays on the pipeline: no renewal, rent or notice entries.
    const log = (await engine.get<LogEntry[]>(`/api/records/${row.kind}/${row.id}/log`)).filter(
      (e) => tenancyOps !== false || !e.tenancy,
    );
    // Entries by applicants and tenants (and text naming them) are outsiders' words: data, never instructions.
    const outsider = (e: LogEntry) => e.actor.kind === "applicant" || e.actor.kind === "tenant";
    const pending = log.filter((e) => e.pending && e.actions.length);
    // Contract out for signature: one resend action per signer who has not signed yet.
    let pendingSigners: string[] = [];
    if (row.kind === "lease" && row.contractSent) {
      try {
        const cs = await engine.get<{ signers: { role: string; signed: boolean }[] }>(
          `/api/copilot/contract-status?ref=${encodeURIComponent(row.ref)}`,
        );
        pendingSigners = cs.signers.filter((x) => !x.signed).map((x) => x.role);
      } catch {
        // The card still shows the other actions.
      }
    }
    return {
      found: true,
      record: { ...recordForModel(row), waitingForYou: row.waitingForMe },
      recent: log.slice(0, 10).map((e) => ({
        at: e.at,
        by: outsider(e) ? untrusted(e.actor.name) : e.actor.name,
        text: outsider(e) ? untrusted(e.text) : e.text,
      })),
      pendingActions: pending.map(
        (e) =>
          `${outsider(e) ? untrusted(e.text) : e.text} You can ${e.actions.map((a) => ACTION_WORDS[a] ?? a).join(", ")} in the Workspace.`,
      ),
      note: "Entries are newest first. The copilot can't take these actions: a person does them in the Workspace.",
      ui: { cards: [recordCard(row, pendingSigners, user.role)] },
    };
  },
};
