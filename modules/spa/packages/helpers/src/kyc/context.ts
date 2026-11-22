import type { CalendarDate } from "@platform/kernel/dates";
import type { KycRules } from "@platform/readers/kyc/config";
import type { KycContext } from "@platform/readers/kyc/schema";
import type { SpaKycConfig } from "@spa/core";

/** A stored document: its id and SPA kind (`documents.kind`). */
export interface SpaKycDocument {
  docId: string;
  kind: string;
}

/** The SPA kinds the person check reads, as the reader's document kind and side (C20 adds the company kinds). */
const PERSON_READS: Record<string, Pick<KycContext["documents"][number], "kind" | "side" | "fieldKey">> = {
  passport: { kind: "passport", side: "page" },
  emirates_id_front: { kind: "emirates_id", side: "front" },
  emirates_id_back: { kind: "emirates_id", side: "back" },
  visa: { kind: "visa", side: "page" },
  proof_of_address: { kind: "extra", side: "page", fieldKey: "proof_of_address" },
};

/** The document kinds the person check reads. */
export const SPA_PERSON_READ_KINDS = Object.keys(PERSON_READS);

/**
 * The reader's rules from a role's SPA config: the confidence and the three cross checks with their severities; the
 * company's rules next to them. A rule on a company-only value (the licence number as an answer) waits for C20.
 */
function rulesOf(config: SpaKycConfig): KycRules {
  const { cross } = config.rules;
  const company = config.rules.company.flatMap((r): unknown[] => {
    if (r.type === "answer_matches_document")
      return r.identityField === "licenceNo" ? [] : [{ ...r, identityField: r.identityField }];
    if (r.type === "document_value_pattern")
      return [{ ...r, identityField: r.identityField === "licenceNo" ? "tradeLicenceNo" : r.identityField }];
    if (r.type === "answer_required" || r.type === "document_required") return [{ ...r, appliesTo: "both" as const }];
    return [r];
  });
  return {
    base: {
      validityDays: 30,
      minConfidence: config.rules.minConfidence,
      requiredDocuments: cross.required_documents.severity !== "off",
      emiratesIdFormat: true,
      passportMrz: true,
      visaFormat: true,
      namesConsistent: cross.names_consistent.severity !== "off",
      applicantName: cross.name_matches_deal.severity === "off" ? "off" : "lenient",
      idNumbersConsistent: true,
      checks: {
        cross: {
          required_documents: cross.required_documents,
          names_consistent: cross.names_consistent,
          applicant_name: cross.name_matches_deal,
        },
        applicantNameMode: "lenient",
      },
    },
    company,
  } as unknown as KycRules;
}

/**
 * What the reader needs to check one party's documents under the role's published config (S19, S41). Validity is
 * counted from `today` (there is no lease start). Documents of kinds the person check doesn't read are left out.
 */
export function spaKycContext(input: {
  config: SpaKycConfig;
  partyName: string;
  documents: readonly SpaKycDocument[];
  today: CalendarDate;
  answers?: Record<string, string>;
}): KycContext {
  const documents = input.documents.flatMap((d) => {
    const read = PERSON_READS[d.kind];
    return read ? [{ docId: d.docId, ...read }] : [];
  });
  return {
    applicant: { nameEn: input.partyName, kind: "individual" },
    leaseStartOn: input.today,
    today: input.today,
    minValidityDays: 30,
    minConfidence: input.config.rules.minConfidence,
    documents,
    rules: rulesOf(input.config),
    form: input.config.form as unknown as KycContext["form"] & object,
    ...(input.answers ? { answers: input.answers } : {}),
  };
}
