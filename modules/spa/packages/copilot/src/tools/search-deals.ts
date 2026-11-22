import { z } from "zod";
import { DEAL_ROLES, fence, limitOf, qs } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.string().trim().max(30).optional(),
  type: z.enum(["primary_offplan", "resale_ready", "resale_offplan"]).optional(),
  mine: z.boolean().optional(),
  limit: limitOf(10).default(5),
});
const Waiting = z.object({ label: z.string(), role: z.string().nullable(), waitedDays: z.number().int() });
const Deal = z.object({
  id: z.string(),
  ref: z.string(),
  type: z.string(),
  stage: z.string(),
  stageLabel: z.string(),
  property: z.string(),
  sellers: z.array(z.string()),
  buyers: z.array(z.string()),
  priceFils: z.number().int(),
  onHold: z.boolean(),
  inDefault: z.boolean(),
  waitingFor: Waiting.nullable(),
  ageDays: z.number().int(),
});
const Output = z.object({ items: z.array(Deal), more: z.boolean() });

const Raw = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      type: z.string(),
      stage: z.string(),
      stageLabel: z.string(),
      property: z.object({ label: z.string() }),
      sellers: z.array(z.string()),
      buyers: z.array(z.string()),
      priceFils: z.number().int(),
      onHold: z.boolean(),
      inDefault: z.boolean(),
      waitingFor: Waiting.partial({ role: true }).nullable().optional(),
      ageDays: z.number().int(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});

export const searchDeals: CopilotTool<typeof Input, typeof Output> = {
  name: "search_deals",
  description:
    "Finds deals by reference (D-1001), party name, unit or stage, or lists the user's own. Returns reference, stage, property, price, who the deal waits for and how many days. Use it first when the user names a deal.",
  kind: "read",
  roles: DEAL_ROLES,
  input: Input,
  output: Output,
  async run(client, a) {
    const raw = Raw.parse(
      await client.get(`/api/deals${qs({ q: a.q, stage: a.stage, type: a.type, mine: a.mine, limit: a.limit })}`),
    );
    return Output.parse({
      items: raw.items.map((d) => ({
        id: d.id,
        ref: d.ref,
        type: d.type,
        stage: d.stage,
        stageLabel: d.stageLabel,
        property: fence(d.property.label),
        sellers: d.sellers.map(fence),
        buyers: d.buyers.map(fence),
        priceFils: d.priceFils,
        onHold: d.onHold,
        inDefault: d.inDefault,
        waitingFor: d.waitingFor
          ? { role: d.waitingFor.role ?? null, label: d.waitingFor.label, waitedDays: d.waitingFor.waitedDays }
          : null,
        ageDays: d.ageDays,
      })),
      more: !!raw.nextCursor,
    });
  },
};
