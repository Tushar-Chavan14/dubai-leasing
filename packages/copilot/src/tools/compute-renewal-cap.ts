import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { aed, LeaseArg, Money } from "./shared.ts";

const Input = z.object({ lease: LeaseArg });
const Output = z.object({
  leaseRef: z.string(),
  unitCode: z.string(),
  rulesVersion: z.string(),
  currentRent: Money,
  sriAverage: Money.nullable(),
  sriSource: z.string(),
  sriLabel: z.string().nullable(),
  gapBelowSriPercent: z.number().nullable(),
  maxIncreasePercent: z.number(),
  maxRent: Money,
  maxIncrease: Money,
  noticeSendOn: z.string(),
  noticeLegalDeadline: z.string(),
  reasons: z.array(z.string()),
});

interface Cap {
  leaseRef: string;
  unitCode: string;
  rulesVersion: string;
  currentRentFils: number;
  sriAverageFils: number | null;
  sriSource: string;
  sriLabel: string | null;
  gapBelowSriPercent: number | null;
  maxIncreasePercent: number;
  maxRentFils: number;
  maxIncreaseFils: number;
  noticeSendOn: string;
  noticeLegalDeadline: string;
  reasons: string[];
}

export const computeRenewalCap: CopilotTool<typeof Input, typeof Output> = {
  name: "compute_renewal_cap",
  kind: "read",
  description:
    "The legal maximum renewal rent for a lease from the rulebook and the Smart Rental Index (SRI): current rent, SRI average, gap, max increase %, max rent, notice dates. Use for any 'how much can rent go up' question.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ lease }, { engine }) {
    const id = await resolveLeaseId(engine, lease);
    const c = await engine.get<Cap>(`/api/leases/${id}/renewal-cap`);
    return {
      leaseRef: c.leaseRef,
      unitCode: c.unitCode,
      rulesVersion: c.rulesVersion,
      currentRent: aed(c.currentRentFils),
      sriAverage: c.sriAverageFils ? aed(c.sriAverageFils) : null,
      sriSource: c.sriSource,
      sriLabel: c.sriLabel,
      gapBelowSriPercent: c.gapBelowSriPercent,
      maxIncreasePercent: c.maxIncreasePercent,
      maxRent: aed(c.maxRentFils),
      maxIncrease: aed(c.maxIncreaseFils),
      noticeSendOn: c.noticeSendOn,
      noticeLegalDeadline: c.noticeLegalDeadline,
      reasons: c.reasons,
    };
  },
};
