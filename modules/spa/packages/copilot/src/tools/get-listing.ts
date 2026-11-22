import { z } from "zod";
import { fence, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({ listingId: z.uuid() });
const Output = z.object({
  ref: z.string(),
  title: z.string(),
  community: z.string().nullable(),
  bedrooms: z.number().int().nullable(),
  sizeSqft: z.number().nullable(),
  askingPriceFils: z.number().int().nullable(),
  stateLabel: z.string(),
  agent: z.string().nullable(),
  sellers: z
    .array(z.object({ name: z.string(), kind: z.string(), shareBps: z.number().int().nullable(), signed: z.boolean() }))
    .nullable(),
  ownership: z.object({ kind: z.string(), matched: z.boolean().nullable() }).nullable(),
  offer: z
    .object({ label: z.string(), priceFils: z.number().int().nullable(), validUntil: z.string().nullable() })
    .nullable(),
});
const Raw = z.object({
  ref: z.string(),
  title: z.string(),
  community: z.string().nullable().optional(),
  bedrooms: z.number().int().nullable().optional(),
  sizeSqft: z.number().nullable().optional(),
  askingPriceFils: z.number().int().nullable().optional(),
  stateLabel: z.string(),
  agent: z.string().nullable().optional(),
  sellers: z
    .array(
      z.object({
        name: z.string(),
        kind: z.string(),
        shareBps: z.number().int().nullable().optional(),
        signed: z.boolean(),
      }),
    )
    .nullable()
    .optional(),
  ownership: z.object({ kind: z.string(), matched: z.boolean().nullable().optional() }).nullable().optional(),
  offer: z
    .object({
      label: z.string(),
      priceFils: z.number().int().nullable().optional(),
      validUntil: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const getListing: CopilotTool<typeof Input, typeof Output> = {
  name: "get_listing",
  description:
    "One listing: size, asking price, state, agent, the sellers and whether each signed the listing agreement (sales roles only), whether ownership matched and the latest offer.",
  kind: "read",
  roles: [...SALES, "admin"],
  input: Input,
  output: Output,
  async run(client, a) {
    const l = Raw.parse(await client.get(`/api/listings/${a.listingId}`));
    return Output.parse({
      ref: l.ref,
      title: fence(l.title),
      community: l.community ? fence(l.community) : null,
      bedrooms: l.bedrooms ?? null,
      sizeSqft: l.sizeSqft ?? null,
      askingPriceFils: l.askingPriceFils ?? null,
      stateLabel: l.stateLabel,
      agent: l.agent ? fence(l.agent) : null,
      sellers: l.sellers
        ? l.sellers.map((s) => ({ name: fence(s.name), kind: s.kind, shareBps: s.shareBps ?? null, signed: s.signed }))
        : null,
      ownership: l.ownership ? { kind: l.ownership.kind, matched: l.ownership.matched ?? null } : null,
      offer: l.offer
        ? { label: l.offer.label, priceFils: l.offer.priceFils ?? null, validUntil: l.offer.validUntil ?? null }
        : null,
    });
  },
};
