import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { type UnitCard } from "@leasing/core";
import { unitHref, type UnitCardItem } from "../ui.ts";
import { aed, Money } from "./shared.ts";

const Input = z.object({
  unitCode: z
    .string()
    .regex(/^[A-Za-z0-9-]{2,40}$/)
    .optional()
    .describe("One unit by its code, e.g. JVC-0412. Use this when the user names a unit; no other filters needed"),
  bedrooms: z.number().int().min(0).max(4).optional().describe("0 = studio, 4 = four or more"),
  community: z.string().min(2).max(120).optional().describe("Area exactly as listed, e.g. Dubai Marina"),
  company: z.string().min(2).max(120).optional().describe("Only this company's units, by name, e.g. Silverline"),
  category: z
    .enum(["residential", "commercial", "retail", "all"])
    .optional()
    .describe("Property type; homes only when left out, 'all' for every type"),
  sizeBand: z.enum(["small", "medium", "large"]).optional().describe("Floor-area band for commercial and retail units"),
  maxRentAed: z.number().int().positive().max(10_000_000).optional().describe("Highest annual asking rent, in AED"),
});
const Output = z.object({
  units: z.array(
    z.object({
      unitId: z.string(),
      code: z.string(),
      company: z.string().nullable(),
      category: z.string(),
      building: z.string(),
      community: z.string(),
      bedrooms: z.number().nullable(),
      areaSqft: z.number().nullable(),
      furnished: z.boolean().nullable(),
      askingRent: Money,
      nextViewingSlots: z.array(z.object({ at: z.string(), label: z.string() })),
    }),
  ),
  note: z.string(),
  ui: z.object({ cards: z.array(z.custom<UnitCardItem>()) }).optional(),
});

interface Row {
  unitId: string;
  company: string | null;
  category: string;
  card: UnitCard | null;
  code: string;
  building: string;
  community: string;
  bedrooms: number | null;
  areaSqft: number | null;
  furnished: boolean | null;
  askingRentFils: number;
  nextViewingSlots: { at: string; label: string }[];
}

export const findAvailableUnits: CopilotTool<typeof Input, typeof Output> = {
  name: "find_available_units",
  kind: "read",
  description:
    "Units that can be booked for a viewing now (listed, approved price, no lease being signed), cheapest first (up to 10), with the approved annual asking rent and the next free viewing slots (Dubai time). Filter by area, bedrooms, company, category, size band and maximum rent. Use it for 'what is available' and 'find a 2-bed in Marina under 120k' questions, and before proposing an application. When the user names a unit, pass only unitCode. An empty list means nothing matches. The units show as cards in the chat.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ unitCode, bedrooms, community, company, category, sizeBand, maxRentAed }, { engine }) {
    const q = [
      unitCode ? `code=${unitCode}` : null,
      bedrooms !== undefined ? `bedrooms=${bedrooms}` : null,
      community ? `community=${encodeURIComponent(community)}` : null,
      company ? `company=${encodeURIComponent(company)}` : null,
      category ? `category=${category}` : null,
      sizeBand ? `sizeBand=${sizeBand}` : null,
      maxRentAed ? `maxRentFils=${maxRentAed * 100}` : null,
    ].filter(Boolean);
    const rows = await engine.get<Row[]>(`/api/available-units${q.length ? `?${q.join("&")}` : ""}`);
    return {
      units: rows.map((r) => ({
        unitId: r.unitId,
        code: r.code,
        company: r.company,
        category: r.category,
        building: r.building,
        community: r.community,
        bedrooms: r.bedrooms,
        areaSqft: r.areaSqft,
        furnished: r.furnished,
        askingRent: aed(r.askingRentFils),
        nextViewingSlots: r.nextViewingSlots,
      })),
      ui: {
        cards: rows.flatMap((r) => (r.card ? [{ kind: "unit" as const, card: r.card, href: unitHref(r.unitId) }] : [])),
      },
      note: "Rent is the approved annual asking rent from the unit record. Slots follow company viewing hours; staff may also book other times.",
    };
  },
};
