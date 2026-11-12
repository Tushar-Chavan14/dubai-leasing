import { Emirate } from "@leasing/core";
import { z } from "zod";
import { EngineError, ALL_STAFF, type CopilotTool } from "../types.ts";
import { unitHref, type UnitCardItem } from "../ui.ts";
import { Money } from "./shared.ts";

const Input = z.object({ unit: z.string().trim().min(2).max(60).describe("Unit code (JVC-0412) or id") });
const Output = z.object({
  unitId: z.string(),
  code: z.string(),
  building: z.string(),
  community: z.string(),
  company: z.string().nullable(),
  category: z.string(),
  emirate: Emirate.optional(),
  state: z.string(),
  bedrooms: z.number().nullable(),
  areaSqft: z.number().nullable(),
  furnished: z.boolean().nullable(),
  askingRent: Money.nullable(),
  priceApproved: z.boolean(),
  pricing: z.object({
    sriLabel: z.string().nullable(),
    sriAverage: Money.nullable(),
    allowedMin: Money.nullable(),
    allowedMax: Money.nullable(),
    hasRule: z.boolean(),
    withinRange: z.boolean().nullable(),
  }),
  offerLimits: z
    .object({
      maxDiscountPercent: z.number(),
      discountFrom: z
        .string()
        .optional()
        .describe("rent rule: the unit's rent rule sets it; company default otherwise"),
      lowestRentWithoutApproval: Money.nullable(),
      minCheques: z.number(),
      maxCheques: z.number(),
      chequesFrom: z.string(),
    })
    .optional(),
  note: z.string(),
  ui: z.object({ cards: z.array(z.custom<UnitCardItem>()) }),
});

interface Unit {
  unitId: string;
  code: string;
  building: string;
  community: string;
  company: string | null;
  category: "residential" | "commercial" | "retail";
  emirate?: z.infer<typeof Emirate>;
  subtype: string | null;
  state: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnished: boolean | null;
  askingRent: { fils: number; text: string } | null;
  priceApproved: boolean;
  pricing: {
    sriLabel: string | null;
    sriAverage: { fils: number; text: string } | null;
    allowedMin: { fils: number; text: string } | null;
    allowedMax: { fils: number; text: string } | null;
    hasRule: boolean;
    withinRange: boolean | null;
  };
  offerLimits?: {
    maxDiscountPercent: number;
    discountFrom?: string;
    lowestRentWithoutApproval: { fils: number; text: string } | null;
    minCheques: number;
    maxCheques: number;
    chequesFrom: string;
  };
}

export const getUnit: CopilotTool<typeof Input, typeof Output> = {
  name: "get_unit",
  kind: "read",
  description:
    "One unit by code or id: its details (including its emirate), state, approved asking rent, the Smart Rental Index (SRI) average for its area and bedrooms, the rent rule's range for the asking rent (pricing.allowedMin/allowedMax: where staff may set the asking rent, never a negotiation limit), and offerLimits: the lowest rent and the cheques an offer or a tenant's counter may have without a manager. All computed by the engine. Use it for 'SRI range for JVC-0412', 'what is the rent of …' and 'how low can the offer go'. A range side that is null has no limit.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ unit }, { engine }) {
    let u: Unit;
    try {
      u = await engine.get<Unit>(`/api/copilot/unit?ref=${encodeURIComponent(unit)}`);
    } catch (e) {
      if (!(e instanceof EngineError) || e.status !== 404) throw e;
      // Not an exact code: let search find a single unit by what the user typed.
      const rows = await engine.get<{ unitCode: string }[]>(`/api/search?q=${encodeURIComponent(unit)}`);
      const codes = [...new Set(rows.map((r) => r.unitCode))];
      if (codes.length !== 1) throw new EngineError(404, `no unit found for "${unit}"`);
      u = await engine.get<Unit>(`/api/copilot/unit?ref=${encodeURIComponent(codes[0]!)}`);
    }
    return {
      unitId: u.unitId,
      code: u.code,
      building: u.building,
      community: u.community,
      company: u.company,
      category: u.category,
      ...(u.emirate ? { emirate: u.emirate } : {}),
      state: u.state,
      bedrooms: u.bedrooms,
      areaSqft: u.areaSqft,
      furnished: u.furnished,
      askingRent: u.askingRent,
      priceApproved: u.priceApproved,
      pricing: u.pricing,
      ...(u.offerLimits ? { offerLimits: u.offerLimits } : {}),
      note: [
        u.pricing.hasRule
          ? "pricing.allowedMin/allowedMax: the rent rule's range for setting the asking rent (company rent rule applied to the SRI average). It is not a negotiation limit."
          : "No rent rule applies to this unit, so no asking-rent range is set.",
        u.offerLimits?.lowestRentWithoutApproval
          ? `Offers and counters: rent from ${u.offerLimits.lowestRentWithoutApproval.text} (asking rent less ${u.offerLimits.maxDiscountPercent}%) and ${u.offerLimits.minCheques} to ${u.offerLimits.maxCheques} cheques go out without a manager; anything else needs a manager's offer_out_of_limits approval.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      ui: {
        cards: [
          {
            kind: "unit",
            card: {
              unitId: u.unitId,
              code: u.code,
              building: u.building,
              community: u.community,
              bedrooms: u.bedrooms,
              bathrooms: u.bathrooms,
              areaSqft: u.areaSqft,
              category: u.category,
              subtype: u.subtype,
              furnished: u.furnished ?? false,
              rent: u.askingRent?.text ?? "Not set",
              photoUrl: null,
            },
            href: unitHref(u.unitId),
          },
        ],
      },
    };
  },
};
