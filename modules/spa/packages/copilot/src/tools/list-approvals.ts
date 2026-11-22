import { z } from "zod";
import { DEAL_ROLES, fence, limitOf, qs } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({
  scope: z.enum(["inbox", "deal"]).default("inbox"),
  dealId: z.uuid().optional(),
  status: z.enum(["pending", "decided", "all"]).default("pending"),
  limit: limitOf(20),
});
const Output = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      gateLabel: z.string(),
      title: z.string(),
      status: z.string(),
      approverRole: z.string().nullable(),
      canYouDecide: z.boolean(),
      createdAt: z.string().nullable(),
    }),
  ),
  more: z.boolean(),
});
const Raw = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      gate: z.string().optional(),
      gateLabel: z.string().optional(),
      title: z.string(),
      status: z.string(),
      approverRole: z.string().nullable().optional(),
      createdAt: z.string().nullable().optional(),
      mayDecide: z.object({ ok: z.boolean() }).optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

export const listApprovals: CopilotTool<typeof Input, typeof Output> = {
  name: "list_approvals",
  description:
    "The approvals waiting for the user's role (inbox), or the approvals of one deal. Says what each is, whose it is to decide and whether the user may. It cannot approve or reject anything.",
  kind: "read",
  roles: DEAL_ROLES,
  input: Input,
  output: Output,
  async run(client, a) {
    const scope = a.dealId ? "deal" : a.scope;
    const r = Raw.parse(
      await client.get(`/api/approvals${qs({ scope, status: a.status, dealId: a.dealId, limit: a.limit })}`),
    );
    return Output.parse({
      items: r.items.map((x) => ({
        id: x.id,
        gateLabel: x.gateLabel ?? "Compliance review",
        title: fence(x.title),
        status: x.status,
        approverRole: x.approverRole ?? null,
        canYouDecide: x.mayDecide?.ok === true,
        createdAt: x.createdAt ?? null,
      })),
      more: !!r.nextCursor,
    });
  },
};
