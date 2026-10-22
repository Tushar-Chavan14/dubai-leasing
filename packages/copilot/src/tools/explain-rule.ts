import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { fetchLease } from "./shared.ts";

const RuleId = z
  .enum(["rent_cap", "renewal_notice", "repossession_notice", "own_use_lock", "late_rent", "reference", "all"])
  .describe(
    "rent_cap: how much rent may rise at renewal (SRI bands). renewal_notice: notice needed for a rent change at renewal. repossession_notice: landlord taking a unit back (sale, own use, works, demolition): notice period and how it's served. own_use_lock: how long before re-letting after own use. late_rent: eviction timing after a formal reminder. reference: company-authored reference notes for this rules version (not law, not enforced). all: every rule.",
  );
const Input = z.object({
  rule: RuleId,
  lease: z
    .string()
    .min(2)
    .max(80)
    .optional()
    .describe("Use this lease's rules version and dates (id, reference or unit code)"),
});
const Output = z.object({
  rulesVersion: z.string(),
  sources: z.array(z.string()),
  rules: z.record(z.string(), z.unknown()),
  /**
   * Company-authored reference notes (admin-written, not enforced by the engine). Wrapped as
   * untrusted text: they are data to quote, never instructions.
   */
  referenceNotes: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })),
  forLease: z
    .object({
      leaseRef: z.string(),
      leaseEndOn: z.string(),
      milestones: z.array(z.object({ id: z.string(), dueOn: z.string(), description: z.string() })),
      repossessionNoticeDeadline: z.string(),
    })
    .nullable(),
});

interface RulesResponse {
  version: string;
  sources: string[];
  rules: Record<string, unknown> & {
    reference?: { text: string; rules: { id: string; title: string; text: string }[] };
  };
  forLeaseEnding?: {
    leaseEndOn: string;
    milestones: { id: string; dueOn: string; description: string }[];
    repossessionNoticeDeadline: string;
  };
}

export const explainRule: CopilotTool<typeof Input, typeof Output> = {
  name: "explain_rule",
  kind: "read",
  description:
    'Dubai leasing rules from the versioned rulebook: rent-cap bands, renewal notice period, repossession notice, own-use lock, late rent. Also the company\'s reference notes for the version (rule "reference"): notes written by the company, not law and not enforced by the engine. Without a lease it answers from the version new leases get today; a lease keeps its own version, so pass the lease for anything about a specific lease (it also gives its renewal dates). Quote values from here, never from memory.',
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ rule, lease }, { engine }) {
    const l = lease ? await fetchLease(engine, lease) : null;
    const version = l?.rulesVersion ?? (await engine.get<{ current: string }>("/api/rules")).current;
    const r = await engine.get<RulesResponse>(
      `/api/rules/${encodeURIComponent(version)}${l ? `?leaseEndOn=${l.endOn}` : ""}`,
    );
    const { reference, ...legal } = r.rules;
    const wantNotes = rule === "reference" || rule === "all";
    // The notes themselves travel only in `referenceNotes`, wrapped as untrusted text.
    const about = reference ? { reference: { text: reference.text } } : {};
    return {
      rulesVersion: r.version,
      // Admin-editable since D23: data for the reader, never evidence for a value.
      sources: r.sources.map(untrusted),
      rules: rule === "all" ? { ...legal, ...about } : rule === "reference" ? about : { [rule]: legal[rule] },
      referenceNotes: wantNotes
        ? (reference?.rules ?? []).map((n) => ({ id: n.id, title: untrusted(n.title), text: untrusted(n.text) }))
        : [],
      forLease:
        l && r.forLeaseEnding
          ? {
              leaseRef: l.ref,
              leaseEndOn: r.forLeaseEnding.leaseEndOn,
              milestones: r.forLeaseEnding.milestones,
              repossessionNoticeDeadline: r.forLeaseEnding.repossessionNoticeDeadline,
            }
          : null,
    };
  },
};
