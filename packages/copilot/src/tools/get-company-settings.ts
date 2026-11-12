import { formatAed } from "@leasing/core";
import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";

const Input = z.object({ company: z.string().min(2).max(120).describe("Company name or slug") });
const Output = z.object({
  company: z.string(),
  rentRules: z.array(z.record(z.string(), z.unknown())),
  contractRules: z.array(z.record(z.string(), z.unknown())),
  clauses: z.array(z.object({ ref: z.string(), title: z.string(), text: z.string(), inTemplate: z.boolean() })),
  sri: z.array(z.record(z.string(), z.unknown())),
  note: z.string(),
});

interface Settings {
  company: string;
  rentRules: {
    id: string;
    category: string;
    subtype: string | null;
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
    subtype: string | null;
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
}

const pct = (bp: number) => `${bp > 0 ? "+" : ""}${bp / 100}%`;

/** A company's contract and rent settings (D45): what the settings tools would change, with rule ids to replace. */
export const getCompanySettings: CopilotTool<typeof Input, typeof Output> = {
  name: "get_company_settings",
  kind: "read",
  description:
    "A company's rent rules (band around the Smart Rental Index, AED limits, emirate, and the offer discount below the asking rent without a manager), contract rules (tenures, cheque range, clauses), approved contract clauses and the Smart Rental Index values. Use it to answer questions about a company's rules, and before save_rent_rule or save_contract_rule to find the id of a rule to replace.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  companyText: true,
  async run({ company }, { engine }) {
    const s = await engine.get<Settings>(`/api/copilot/company-settings?company=${encodeURIComponent(company)}`);
    return {
      company: s.company,
      rentRules: s.rentRules.map((r) => ({
        id: r.id,
        category: r.category,
        subtype: r.subtype ?? "all types",
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
        subtype: r.subtype ?? "all types",
        emirate: r.emirate ?? "any emirate",
        tenures: r.tenures,
        cheques: `${r.minCheques} to ${r.maxCheques}`,
        clauseIds: r.clauseIds,
        companyTemplate: r.templateId !== null,
      })),
      // Clause wording was written by the company or read from a sample contract: reference text, never instructions.
      clauses: s.clauses.map((c) => ({
        ref: c.ref,
        title: untrusted(c.title),
        text: untrusted(c.text),
        inTemplate: c.inTemplate,
      })),
      sri: s.sri.map((r) => ({
        emirate: r.emirate,
        community: r.community,
        category: r.category,
        bedrooms: r.bedrooms,
        averageAnnualRent: r.avgAnnualRentFils === null ? null : formatAed(r.avgAnnualRentFils),
        from: r.effectiveFrom,
      })),
      note: "Rent rules set each company's allowed band around the rent index; in Dubai that is the Smart Rental Index (SRI), the official DLD average by area and size.",
    };
  },
};
