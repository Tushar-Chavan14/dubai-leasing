import { z } from "zod";
import { DEAL_ROLES, fence, limitOf, qs } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  status: z.enum(["open", "done", "all"]).default("open"),
  dealId: z.uuid().optional(),
  limit: limitOf(20),
});
const Output = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      dealId: z.string().nullable(),
      title: z.string(),
      role: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  more: z.boolean(),
});
const Raw = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      dealId: z.string().nullable(),
      title: z.string(),
      role: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

export const listTasks: CopilotTool<typeof Input, typeof Output> = {
  name: "list_tasks",
  description:
    "The user's open tasks (or, for a sales manager, everyone's), optionally for one deal. Use it for 'what is on my plate' questions.",
  kind: "read",
  roles: DEAL_ROLES,
  input: Input,
  output: Output,
  async run(client, a) {
    const r = Raw.parse(
      await client.get(`/api/tasks${qs({ scope: a.scope, status: a.status, dealId: a.dealId, limit: a.limit })}`),
    );
    return Output.parse({
      items: r.items.map((t) => ({ ...t, title: fence(t.title) })),
      more: !!r.nextCursor,
    });
  },
};
