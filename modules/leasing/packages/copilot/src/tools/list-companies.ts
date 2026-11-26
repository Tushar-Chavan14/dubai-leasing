import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";

const Input = z.object({});
const Output = z.object({
  companies: z.array(z.object({ name: z.string(), kind: z.string(), listedUnits: z.number().int() })),
  note: z.string(),
});

export const listCompanies: CopilotTool<typeof Input, typeof Output> = {
  name: "list_companies",
  kind: "read",
  description:
    "The companies (developers, realty companies, owners) with their kind and how many units each has listed. Use it for 'which companies' or 'how many units does X have'; then find_available_units with company to show them.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run(_args, { engine }) {
    const rows = await engine.get<{ name: string; kind: string; listedUnits: number }[]>("/api/copilot/companies");
    return {
      companies: rows.map((r) => ({ name: r.name, kind: r.kind, listedUnits: r.listedUnits })),
      note: "listedUnits counts listed units with an asking rent, in every category; find_available_units shows the ones bookable now.",
    };
  },
};
