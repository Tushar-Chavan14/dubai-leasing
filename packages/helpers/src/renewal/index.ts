import { formatAed, type Helper, isCalendarDate } from "@leasing/core";
import { getRulebook, maxIncreasePercent, maxRenewalRent } from "@leasing/rulebook";
import { z } from "zod";

/**
 * Renewal helper (pure code, no model). Looks at the SRI value the Manager found for this lease
 * and works out the legal cap from the rulebook. It proposes the cap as the renewal rent; a
 * manager can lower it when approving the notice. It never decides anything itself.
 */
export const RenewalContext = z.object({
  leaseRef: z.string(),
  currentRentFils: z.number().int().positive(),
  leaseEndOn: z.string().refine(isCalendarDate),
  community: z.string(),
  bedrooms: z.number().int().min(0).nullable(),
  /** SRI average for similar homes, if one is on record. */
  sri: z
    .object({
      avgAnnualRentFils: z.number().int().positive(),
      source: z.enum(["override", "table"]),
      label: z.string(),
    })
    .nullable(),
});
export type RenewalContext = z.infer<typeof RenewalContext>;

export const RenewalData = z.object({
  sriAverageFils: z.number().int().positive().nullable(),
  sriSource: z.enum(["override", "table", "none"]),
  sriLabel: z.string().nullable(),
  /** How far current rent is below the SRI average, in basis points (rounded down). Display only. */
  gapBasisPoints: z.number().int().nullable(),
  maxIncreasePercent: z.number().int().min(0),
  maxRentFils: z.number().int().positive(),
  proposedRentFils: z.number().int().positive(),
});
export type RenewalData = z.infer<typeof RenewalData>;

export const renewalHelper: Helper<RenewalContext, RenewalData> = {
  name: "renewal",
  async run(input) {
    const r = getRulebook(input.rulesVersion);
    const c = input.context;
    if (!c.sri) {
      return {
        status: "ok",
        data: {
          sriAverageFils: null,
          sriSource: "none",
          sriLabel: null,
          gapBasisPoints: null,
          maxIncreasePercent: 0,
          maxRentFils: c.currentRentFils,
          proposedRentFils: c.currentRentFils,
        },
        reasons: [
          `No SRI average on record for ${c.bedrooms === 0 ? "studios" : `${c.bedrooms}-bed units`} in ${c.community}, so only renewal at the current rent is provably within the cap.`,
          "Record an SRI value for this lease to propose an increase.",
        ],
        sourceDocIds: [],
      };
    }
    const sri = c.sri.avgAnnualRentFils;
    const pct = maxIncreasePercent(c.currentRentFils, sri, r);
    const max = maxRenewalRent(c.currentRentFils, sri, r);
    const gap = Math.floor(((sri - c.currentRentFils) * 10_000) / sri);
    return {
      status: "ok",
      data: {
        sriAverageFils: sri,
        sriSource: c.sri.source,
        sriLabel: c.sri.label,
        gapBasisPoints: gap,
        maxIncreasePercent: pct,
        maxRentFils: max,
        proposedRentFils: max,
      },
      reasons: [
        gap <= 0
          ? `Current rent ${formatAed(c.currentRentFils)} is at or above the SRI average ${formatAed(sri)}: no increase allowed.`
          : `Current rent is ${(gap / 100).toFixed(2)}% below the SRI average ${formatAed(sri)}: up to ${pct}% is allowed (${r.version}).`,
        pct > 0
          ? `Proposed renewal rent ${formatAed(max)}, the legal cap. A manager may lower it.`
          : "Proposed renewal at the current rent.",
      ],
      sourceDocIds: [],
    };
  },
};
