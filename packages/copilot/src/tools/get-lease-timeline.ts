import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { actorKind, dubaiDay, fetchLease, LeaseArg, milestoneName } from "./shared.ts";

const Input = z.object({
  lease: LeaseArg,
  limit: z.number().int().min(1).max(30).default(15).describe("How many of the most recent events"),
});
const Output = z.object({
  leaseRef: z.string(),
  events: z.array(
    z.object({
      on: z.string().nullable(),
      type: z.string(),
      by: z.string(),
      toState: z.string().nullable(),
      detail: z.string().nullable(),
    }),
  ),
});

/**
 * A short line per event. Text from the engine itself (milestones, engine-written titles and
 * reasons) is plain; anything a person outside the system could have written is wrapped.
 */
function detailOf(p: Record<string, unknown>, actor: string): string | null {
  const engineWrote = actor === "system" || actor.startsWith("helper:");
  const text = (s: string) => (engineWrote ? s : untrusted(s));
  if (typeof p.comment === "string") return untrusted(p.comment);
  if (typeof p.milestone === "string") return milestoneName(p.milestone);
  if (typeof p.title === "string") return text(p.title);
  if (typeof p.reason === "string") return text(p.reason);
  if (typeof p.choice === "string") return `tenant chose ${p.choice}`;
  return null;
}

export const getLeaseTimeline: CopilotTool<typeof Input, typeof Output> = {
  name: "get_lease_timeline",
  kind: "read",
  description:
    "The lease's audit trail, newest first: state changes, milestones, approvals, notices sent, tenant replies. Use it for 'what happened' questions.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ lease, limit }, { engine }) {
    const l = await fetchLease(engine, lease);
    return {
      leaseRef: l.ref,
      events: l.events
        .toReversed()
        .slice(0, limit)
        .map((e) => ({
          on: dubaiDay(e.at),
          type: e.type,
          by: actorKind(e.actor),
          toState: e.toState,
          detail: detailOf(e.payload, e.actor),
        })),
    };
  },
};
