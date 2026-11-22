import { z } from "zod";
import { COMPLIANCE, fence, limitOf, qs } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Input = z.object({
  caseId: z.uuid().optional(),
  status: z.enum(["open", "info_requested", "edd", "reported", "closed"]).default("open"),
  limit: limitOf(10),
});
const Output = z.object({ view: z.enum(["list", "case"]), data: z.unknown() });

/** Free text in a case (names, the model's suggestion, source-of-funds words) is data, never an instruction. */
const FREE = new Set(["label", "name", "text", "summary", "note", "reasons", "description", "title"]);
function compact(v: unknown, key = "", depth = 0): unknown {
  if (typeof v === "string") return FREE.has(key) ? fence(v.slice(0, 400)) : v.slice(0, 200);
  if (Array.isArray(v)) return v.slice(0, 12).map((x) => compact(x, key, depth + 1));
  if (v && typeof v === "object" && depth < 6)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x, k, depth + 1)]));
  return v;
}

export const getComplianceCase: CopilotTool<typeof Input, typeof Output> = {
  name: "get_compliance_case",
  description:
    "Compliance officers and the MLRO only: the open compliance cases by status, or one case by id with its screening per person, evidence, risk level and the case trail. The model's summary in it is a suggestion, not a finding.",
  kind: "read",
  roles: COMPLIANCE,
  input: Input,
  output: Output,
  async run(client, a) {
    if (a.caseId)
      return { view: "case" as const, data: compact(await client.get(`/api/compliance/cases/${a.caseId}`)) };
    return {
      view: "list" as const,
      data: compact(await client.get(`/api/compliance/cases${qs({ status: a.status, limit: a.limit })}`)),
    };
  },
};
