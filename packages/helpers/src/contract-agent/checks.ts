import { addYears, type CalendarDate, type ContractFields, diffDays } from "@leasing/core";
import type { BlankFill, ContractAgentContext, TermCheck } from "./schema.ts";

const aed = (fils: number) => `AED ${(fils / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * The contract's terms checked against the company's contract config, in code. The agent may read these but its
 * own view of them is never used: the Manager recomputes them after the loop.
 */
export function checkContractTerms(
  c: ContractAgentContext,
  fields: ContractFields,
  blanks: BlankFill | null,
): TermCheck[] {
  const { lease } = c.contract;
  // A term of a year or more (start + 1 year - 1 day, or longer) is annual; anything shorter is short term.
  const annual = diffDays(lease.endOn as CalendarDate, addYears(lease.startOn as CalendarDate, 1)) <= 1;
  const tenure = annual ? "annual" : "short_term";
  const checks: TermCheck[] = [];
  checks.push(
    !c.rule
      ? { id: "tenure", ok: true, reason: "Tenure: no contract rule, company defaults apply" }
      : c.rule.tenures.includes(tenure)
        ? { id: "tenure", ok: true, reason: `Tenure: ${tenure.replace("_", " ")} allowed by the rule` }
        : {
            id: "tenure",
            ok: false,
            reason: `Tenure: ${tenure.replace("_", " ")} is not allowed by the contract rule`,
          },
  );
  checks.push(
    !c.rule
      ? { id: "cheques", ok: true, reason: "Cheques: no contract rule, company defaults apply" }
      : lease.cheques >= c.rule.minCheques && lease.cheques <= c.rule.maxCheques
        ? {
            id: "cheques",
            ok: true,
            reason: `Cheques: ${lease.cheques} within ${c.rule.minCheques}–${c.rule.maxCheques}`,
          }
        : {
            id: "cheques",
            ok: false,
            reason: `Cheques: ${lease.cheques} is outside the rule's ${c.rule.minCheques}–${c.rule.maxCheques}`,
          },
  );
  checks.push(
    !c.rentBand
      ? { id: "rent_band", ok: true, reason: "Rent: no rent rule band for this unit" }
      : lease.annualRentFils >= c.rentBand.minFils && lease.annualRentFils <= c.rentBand.maxFils
        ? {
            id: "rent_band",
            ok: true,
            reason: `Rent: ${aed(lease.annualRentFils)} within ${aed(c.rentBand.minFils)}–${aed(c.rentBand.maxFils)}`,
          }
        : {
            id: "rent_band",
            ok: false,
            reason: `Rent: ${aed(lease.annualRentFils)} is outside the allowed ${aed(c.rentBand.minFils)}–${aed(c.rentBand.maxFils)}`,
          },
  );
  checks.push(
    lease.depositFils <= c.depositMaxFils
      ? {
          id: "deposit",
          ok: true,
          reason: `Deposit: ${aed(lease.depositFils)} within the ${aed(c.depositMaxFils)} limit`,
        }
      : {
          id: "deposit",
          ok: false,
          reason: `Deposit: ${aed(lease.depositFils)} is above the ${aed(c.depositMaxFils)} limit`,
        },
  );
  checks.push(
    c.landlordGaps.length
      ? { id: "landlord", ok: false, reason: `Landlord details missing: ${c.landlordGaps.join(", ")}` }
      : { id: "landlord", ok: true, reason: "Landlord: legal details and signatory complete" },
  );
  checks.push(
    fields.dldPropertyNo && fields.tenantNameEn && fields.landlordNameEn
      ? { id: "required_terms", ok: true, reason: "Required terms: present" }
      : { id: "required_terms", ok: false, reason: "Required terms: property number or party names missing" },
  );
  checks.push(
    !blanks
      ? { id: "blanks", ok: true, reason: "Blanks: standard contract, no template blanks" }
      : blanks.missingCore.length
        ? { id: "blanks", ok: false, reason: `Blanks with no value: ${blanks.missingCore.join(", ")}` }
        : {
            id: "blanks",
            ok: true,
            reason: blanks.leftEmpty.length
              ? `Blanks: all legal and money blanks filled; left empty for hand-filling: ${blanks.leftEmpty.join(", ")}`
              : "Blanks: every template blank filled from the records",
          },
  );
  return checks;
}
