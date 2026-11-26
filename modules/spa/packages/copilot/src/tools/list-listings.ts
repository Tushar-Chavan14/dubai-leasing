import { z } from "zod";
import { fence, limitOf, qs, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ scope: z.enum(["mine", "all"]).default("all"), limit: limitOf(20) });
const Output = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      title: z.string(),
      community: z.string().nullable(),
      askingPriceFils: z.number().int().nullable(),
      stateLabel: z.string(),
      permit: z.string().nullable(),
      offer: z.string().nullable(),
    }),
  ),
  more: z.boolean(),
});
const Raw = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      title: z.string(),
      community: z.string().nullable().optional(),
      askingPriceFils: z.number().int().nullable().optional(),
      stateLabel: z.string(),
      permit: z.unknown().optional(),
      offer: z.object({ label: z.string() }).nullable().optional(),
    }),
  ),
  nextCursor: z.string().nullable().optional(),
});
const permitText = (p: unknown): string | null => {
  if (!p || typeof p !== "object") return null;
  const o = p as { label?: unknown; status?: unknown };
  return typeof o.label === "string" ? o.label : typeof o.status === "string" ? o.status : null;
};

export const listListings: CopilotTool<typeof Input, typeof Output> = {
  name: "list_listings",
  description:
    "Resale listings, newest first: reference, title, community, asking price, state, permit state and the latest offer's state. Use it for 'what is on the market' questions.",
  kind: "read",
  roles: [...SALES, "admin"],
  input: Input,
  output: Output,
  async run(client, a) {
    const r = Raw.parse(await client.get(`/api/listings${qs({ scope: a.scope, limit: a.limit })}`));
    return Output.parse({
      items: r.items.map((l) => ({
        id: l.id,
        ref: l.ref,
        title: fence(l.title),
        community: l.community ? fence(l.community) : null,
        askingPriceFils: l.askingPriceFils ?? null,
        stateLabel: l.stateLabel,
        permit: permitText(l.permit),
        offer: l.offer?.label ?? null,
      })),
      more: !!r.nextCursor,
    });
  },
};
