import { z } from "zod";
import { DEAL_ROLES, limitOf, qs } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ dealId: z.uuid(), limit: limitOf(20) });
const Output = z.object({
  items: z.array(z.object({ label: z.string(), at: z.string(), by: z.string(), toState: z.string().nullable() })),
  more: z.boolean(),
});
const Raw = z.object({
  items: z.array(
    z.object({
      label: z.string(),
      at: z.string(),
      actor: z.object({ label: z.string() }),
      toState: z.string().nullable().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

export const getDealTimeline: CopilotTool<typeof Input, typeof Output> = {
  name: "get_deal_timeline",
  description:
    "The latest events on one deal, newest first, with who did each (a person, the system or a helper) and when. Use it for 'what happened' and 'who did' questions.",
  kind: "read",
  roles: DEAL_ROLES,
  input: Input,
  output: Output,
  async run(client, a) {
    const r = Raw.parse(await client.get(`/api/deals/${a.dealId}/events${qs({ limit: a.limit })}`));
    return Output.parse({
      items: r.items.map((e) => ({ label: e.label, at: e.at, by: e.actor.label, toState: e.toState ?? null })),
      more: !!r.nextCursor,
    });
  },
};
