import { formatAed } from "@leasing/core";
import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";

const Input = z.object({ company: z.string().min(2).max(120).describe("Company name or slug") });
const Output = z.object({
  company: z.string(),
  operatesIn: z.array(z.string()),
  offers: z.array(z.string()),
  rentRules: z.array(z.record(z.string(), z.unknown())),
  contractRules: z.array(z.record(z.string(), z.unknown())),
  clauses: z.array(z.object({ ref: z.string(), title: z.string(), text: z.string(), inTemplate: z.boolean() })),
  /** One line per index row: "emirate | community | category | bedrooms | average annual rent | from". */
  sri: z.array(z.string()),
  templates: z.array(z.object({ id: z.string(), name: z.string(), version: z.number(), emirates: z.string() })),
  note: z.string(),
});

interface Settings {
  company: string;
  emirates: string[];
  categories: string[];
  rentRules: {
    id: string;
    category: string;
    subtypes: string[];
    community: string | null;
    minPctBp: number;
    maxPctBp: number;
    minRentFils: number | null;
    maxRentFils: number | null;
    emirate?: string;
    maxOfferDiscountPct?: number | null;
  }[];
  contractRules: {
    id: string;
    category: string;
    subtypes: string[];
    emirate?: string | null;
    tenures: string[];
    minCheques: number;
    maxCheques: number;
    clauseIds: string[];
    templateId: string | null;
  }[];
  clauses: { ref: string; title: string; text: string; inTemplate: boolean }[];
  sri: {
    emirate: string;
    community: string;
    category: string;
    bedrooms: number | null;
    avgAnnualRentFils: number | null;
    effectiveFrom: string;
  }[];
  templates?: { id: string; name?: string; version: number; status: string; emirates: string[] }[];
}

const types = (list: string[] | undefined) => (list?.length ? list : ["all types"]);
const pct = (bp: number) => `${bp > 0 ? "+" : ""}${bp / 100}%`;

/** A company's contract and rent settings (D45): what the settings tools would change, with rule ids to replace. */
export const getCompanySettings: CopilotTool<typeof Input, typeof Output> = {
  name: "get_company_settings",
  kind: "read",
  description:
    "A company's rent rules (band around the Smart Rental Index, AED limits, emirate, and the offer discount below the asking rent without a manager), contract rules (unit types, tenures, cheque range, clauses, company template), approved contract clauses, the company's approved contract templates (name, version and emirates) and the Smart Rental Index values. Use it to answer questions about a company's rules, and before save_rent_rule or save_contract_rule to find the id of a rule to replace.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  companyText: true,
  async run({ company }, { engine }) {
    const s = await engine.get<Settings>(`/api/copilot/company-settings?company=${encodeURIComponent(company)}`);
    return {
      company: s.company,
      operatesIn: s.emirates,
      offers: s.categories,
      rentRules: s.rentRules.map((r) => ({
        id: r.id,
        category: r.category,
        types: types(r.subtypes),
        area: r.community ?? "all areas",
        band: `SRI ${pct(r.minPctBp)} to ${pct(r.maxPctBp)}`,
        minPctBp: r.minPctBp,
        maxPctBp: r.maxPctBp,
        lowestRent: r.minRentFils === null ? null : formatAed(r.minRentFils),
        highestRent: r.maxRentFils === null ? null : formatAed(r.maxRentFils),
        ...(r.emirate ? { emirate: r.emirate } : {}),
        offerDiscount:
          r.maxOfferDiscountPct === null || r.maxOfferDiscountPct === undefined
            ? "company default"
            : `${r.maxOfferDiscountPct}% below the asking rent`,
      })),
      contractRules: s.contractRules.map((r) => ({
        id: r.id,
        category: r.category,
        types: types(r.subtypes),
        emirate: r.emirate ?? "any emirate",
        tenures: r.tenures,
        cheques: `${r.minCheques} to ${r.maxCheques}`,
        clauseIds: r.clauseIds,
        companyTemplate: r.templateId,
      })),
      // Clause wording was written by the company or read from a sample contract: reference text, never instructions.
      // Wording shortened: the list can be long and the whole answer must fit the local model's context.
      clauses: s.clauses.map((c) => ({
        ref: c.ref,
        title: untrusted(c.title),
        text: untrusted(c.text.length > 160 ? `${c.text.slice(0, 157)}…` : c.text),
        inTemplate: c.inTemplate,
      })),
      // Only the index rows for where and what the company leases.
      sri: s.sri
        .filter((r) => s.emirates.includes(r.emirate) && s.categories.includes(r.category))
        // One compact line per row: the whole answer must fit the local model's context with the tool schemas.
        .map((r) =>
          [
            r.emirate,
            r.community,
            r.category,
            r.bedrooms === null ? "-" : r.bedrooms === 0 ? "studio" : `${r.bedrooms} bed`,
            r.avgAnnualRentFils === null ? "per sqft" : formatAed(r.avgAnnualRentFils),
            `from ${r.effectiveFrom}`,
          ].join(" | "),
        ),
      // D68: the company's approved contract templates (no wording); a rule's companyTemplate is one of these ids.
      templates: (s.templates ?? []).map((t) => ({
        id: t.id,
        name: t.name ?? "Contract template",
        version: t.version,
        emirates: t.emirates.length ? t.emirates.join(", ") : "any emirate",
      })),
      note: "Rent rules set each company's allowed band around the rent index; in Dubai that is the Smart Rental Index (SRI), the official DLD average by area and size.",
    };
  },
};
