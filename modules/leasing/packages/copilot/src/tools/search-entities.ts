import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";

const Input = z.object({
  query: z.string().trim().min(2).max(80).describe("Unit code, lease reference, building or tenant name"),
});
const Output = z.object({
  results: z.array(
    z.object({
      unitCode: z.string(),
      building: z.string(),
      community: z.string(),
      leaseId: z.string().nullable(),
      leaseRef: z.string().nullable(),
      leaseState: z.string().nullable(),
      leaseEndOn: z.string().nullable(),
      tenant: z.string().nullable(),
    }),
  ),
});

export const searchEntities: CopilotTool<typeof Input, typeof Output> = {
  name: "search_entities",
  kind: "read",
  description:
    "Find units and leases by unit code, lease reference, building or tenant name. Use it when you don't know which lease the user means.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ query }, { engine }) {
    const rows = await engine.get<z.infer<typeof Output>["results"]>(`/api/search?q=${encodeURIComponent(query)}`);
    return {
      results: rows.map((r) => ({
        unitCode: r.unitCode,
        building: r.building,
        community: r.community,
        leaseId: r.leaseId,
        leaseRef: r.leaseRef,
        leaseState: r.leaseState,
        leaseEndOn: r.leaseEndOn,
        tenant: r.tenant,
      })),
    };
  },
};
