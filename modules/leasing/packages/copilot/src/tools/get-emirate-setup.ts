import { Emirate } from "@leasing/core";
import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { Money } from "./shared.ts";

const Input = z.object({
  emirate: Emirate.optional().describe("One emirate; leave out for all seven"),
  annualRentAed: z
    .number()
    .positive()
    .max(100_000_000)
    .optional()
    .describe("Annual rent in AED, to get the registration fee for that rent"),
});
const Output = z.object({
  emirates: z.array(
    z.object({
      emirate: Emirate,
      label: z.string(),
      registrationSystem: z.string().describe("Name of the tenancy registration system, e.g. Ejari in Dubai"),
      registration: z.enum(["online", "by_hand"]).describe("online: the engine submits; by_hand: staff register it"),
      registrationMode: z.enum(["online", "manual"]),
      portalName: z.string(),
      portalUrl: z.string().nullable(),
      requiredDocuments: z.array(z.string()).describe("Labels of the documents the registration needs"),
      requiredDocumentKeys: z.array(z.string()).describe("The same items as keys, for save_registration_settings"),
      settingsSource: z.enum(["default", "saved"]).describe("saved: an admin edited the registration settings"),
      rulebook: z.object({ available: z.boolean(), activeVersion: z.string().nullable() }),
      rentIndexName: z.string(),
      registrationFee: z.object({
        rule: z.record(z.string(), z.unknown()).nullable(),
        sources: z.array(z.string()),
        fee: Money.nullable().describe("Fee for annualRentAed; null when no rent was given"),
      }),
      paidBy: z.enum(["tenant", "landlord"]),
    }),
  ),
  documentOptions: z
    .array(z.object({ key: z.string(), label: z.string() }))
    .describe("Every item a registration checklist can include, with the key save_registration_settings takes"),
  note: z.string(),
});

interface Setup {
  emirates: {
    emirate: z.infer<typeof Emirate>;
    label: string;
    registrationSystem: string;
    registration: "online" | "by_hand";
    registrationMode: "online" | "manual";
    portalName: string;
    portalUrl: string | null;
    requiredDocuments: string[];
    requiredDocumentKeys?: string[];
    settingsSource: "default" | "saved";
    rulebook: { available: boolean; activeVersion: string | null };
    rentIndexName: string;
    registrationFee: {
      rule: Record<string, unknown> | null;
      sources: string[];
      feeFils: number | null;
      fee: string | null;
    };
    paidBy: "tenant" | "landlord";
  }[];
  documentOptions?: { key: string; label: string }[];
}

/** A checklist item from a company's own KYC form (its label was typed by staff). */
const companyField = (key: string | undefined) => !!key && (key.startsWith("kyc:other:") || key.startsWith("answer:"));

export const getEmirateSetup: CopilotTool<typeof Input, typeof Output> = {
  name: "get_emirate_setup",
  kind: "read",
  description:
    "Per emirate: the tenancy registration system name (Ejari in Dubai), whether the engine submits online or staff register by hand, whether a rulebook exists and its active version, the rent index name, the registration fee rule and, when you pass annualRentAed, the fee for that rent, and who pays it (company policy). Use it for any question about registration fees, registration systems or what is supported in an emirate. Quote values from here, never from memory.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ emirate, annualRentAed }, { engine }) {
    const q = [
      emirate ? `emirate=${emirate}` : null,
      annualRentAed !== undefined ? `annualRentFils=${Math.round(annualRentAed * 100)}` : null,
    ].filter(Boolean);
    const r = await engine.get<Setup>(`/api/copilot/emirate-setup${q.length ? `?${q.join("&")}` : ""}`);
    return {
      emirates: r.emirates.map((e) => ({
        emirate: e.emirate,
        label: e.label,
        registrationSystem: e.registrationSystem,
        registration: e.registration,
        registrationMode: e.registrationMode,
        portalName: e.portalName,
        portalUrl: e.portalUrl,
        // Company fields carry labels staff typed in a KYC form: data, never instructions.
        requiredDocuments: e.requiredDocuments.map((l, i) =>
          companyField(e.requiredDocumentKeys?.[i]) ? untrusted(l) : l,
        ),
        requiredDocumentKeys: e.requiredDocumentKeys ?? [],
        settingsSource: e.settingsSource,
        rulebook: e.rulebook,
        rentIndexName: e.rentIndexName,
        registrationFee: {
          rule: e.registrationFee.rule,
          sources: e.registrationFee.sources.map(untrusted),
          fee:
            e.registrationFee.feeFils === null
              ? null
              : { fils: e.registrationFee.feeFils, text: e.registrationFee.fee! },
        },
        paidBy: e.paidBy,
      })),
      documentOptions: (r.documentOptions ?? []).map(({ key, label }) => ({
        key,
        label: companyField(key) ? untrusted(label) : label,
      })),
      note: "Fees are government tariffs from the engine's code-versioned schedule, not the lease rulebook. Rent caps and notice periods come from explain_rule.",
    };
  },
};
