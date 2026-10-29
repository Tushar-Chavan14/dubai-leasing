import { type Addendum, CONTRACT_CLAUSES, type ContractClauseId, type ContractFields, formatAed } from "@leasing/core";
import type { NoticeBlock, NoticeDocument } from "../renewal/notice.ts";

/**
 * Terms the product requires in every contract, whatever the template: the Ejari registration
 * statement, the rule that rent changes only at renewal with notice given in time (no number here:
 * the period comes from the rulebook, never from this text), and how the parties sign. A company
 * template that lacks one gets it appended under "Additional terms required by law".
 */
export const REQUIRED_TERMS = {
  rentChange:
    "The rent above is fixed for the whole term. It can only change at renewal, with written notice given in time under Dubai law.",
  ejari: "This contract is registered in Ejari after both parties sign.",
  signatures:
    "Each party signs this contract electronically through a personal link. The signature record is added as the last page of the signed copy.",
} as const;

/**
 * The addendum as document blocks: standard clauses, approved company clauses (wording copied in by
 * the Manager) and the parties' free text. Shared by the standard and the company-template contract.
 */
export function addendumBlocks(addendum: Addendum): NoticeBlock[] {
  const blocks: NoticeBlock[] = [];
  const chosen = addendum.clauses.flatMap((c) =>
    Object.hasOwn(CONTRACT_CLAUSES, c)
      ? [`${CONTRACT_CLAUSES[c as ContractClauseId].title}: ${CONTRACT_CLAUSES[c as ContractClauseId].text}`]
      : [],
  );
  // Every `cc:` ref must come with its approved wording (the Manager copies it in); never print a guess.
  const wording = new Map((addendum.companyClauses ?? []).map((c) => [`cc:${c.id}`, c]));
  const company = addendum.clauses
    .filter((c) => !Object.hasOwn(CONTRACT_CLAUSES, c))
    .map((c) => {
      const w = wording.get(c);
      if (!w) throw new Error(`company clause ${c} has no wording in the addendum`);
      return `${w.title}: ${w.text}`;
    });
  if (chosen.length || company.length || addendum.freeText) {
    blocks.push({ kind: "heading", text: "Addendum" });
    if (chosen.length) blocks.push({ kind: "list", items: chosen });
    if (company.length) {
      blocks.push({ kind: "para", text: "Additional terms (company)" });
      blocks.push({ kind: "list", items: company });
    }
    if (addendum.freeText) {
      blocks.push({ kind: "para", text: "Additional terms agreed by the parties:" });
      for (const p of addendum.freeText.split(/\n{2,}/)) blocks.push({ kind: "para", text: p.trim() });
    }
  }
  return blocks;
}

/**
 * The tenancy contract as a document (English demo template). Plain layout written for this
 * product: no DLD form layout, logo or wording is copied. Every value is a contract field, printed
 * as stored. WORDING TO BE REVIEWED BY A DUBAI PROPERTY LAWYER before real use.
 */
const dash = (v: string | number | null) => (v === null || v === "" ? "-" : String(v));

export function contractDocument(
  f: ContractFields,
  addendum: Addendum,
  o: { version: number; reference: string; preparedOn: string; demo: boolean },
): NoticeDocument {
  const tenantId: [string, string][] =
    f.tenantKind === "company"
      ? [["Trade licence no.", dash(f.tenantTradeLicenceNo)]]
      : [
          ["Emirates ID no.", dash(f.tenantEmiratesIdNo)],
          ["Passport no.", dash(f.tenantPassportNo)],
          ["Nationality", dash(f.tenantNationality)],
        ];
  const blocks: NoticeBlock[] = [
    { kind: "title", text: "Tenancy contract (demo template)" },
    {
      kind: "meta",
      rows: [
        ["Contract reference", o.reference],
        ["Version", String(o.version)],
        ["Lease", f.leaseRef],
        ["Prepared on", o.preparedOn],
      ],
    },
    { kind: "heading", text: "Landlord" },
    {
      kind: "facts",
      rows: [
        ["Name", f.landlordNameEn],
        ["ID / licence no.", dash(f.landlordIdNo)],
      ],
    },
    { kind: "heading", text: "Tenant" },
    { kind: "facts", rows: [["Name", f.tenantNameEn], ...tenantId] },
    { kind: "heading", text: "Property" },
    {
      kind: "facts",
      rows: [
        ["Building", `${f.building}, ${f.community}`],
        ["Unit no.", f.unitNo],
        ["DLD property no.", f.dldPropertyNo],
        ["Makani no.", f.makaniNo],
        ["Plot no.", dash(f.plotNo)],
        ["Use", f.propertyUsage === "residential" ? "Residential" : "Commercial"],
      ],
    },
    { kind: "heading", text: "Term and payment" },
    {
      kind: "facts",
      rows: [
        ["Term", `${f.startOn} to ${f.endOn}`],
        ["Move-in", f.moveInOn],
        ["Annual rent", formatAed(f.annualRentFils)],
        ["Payment", `${f.cheques} cheque${f.cheques === 1 ? "" : "s"}`],
        ["Security deposit", formatAed(f.depositFils)],
        ["Rent-free days", String(f.rentFreeDays)],
      ],
    },
    { kind: "heading", text: "Standard terms" },
    {
      kind: "list",
      items: [
        REQUIRED_TERMS.rentChange,
        "The tenant pays the rent by the cheques listed above. A bounced cheque is handled under the law and the company's collection process.",
        "The security deposit is refunded at the end of the tenancy, less the cost of any damage beyond normal wear.",
        "The landlord keeps the unit fit to live in and does structural repairs and repairs to the building's main systems.",
        "The tenant uses the unit for the use stated above and keeps it in good condition.",
        REQUIRED_TERMS.ejari,
      ],
    },
  ];
  blocks.push(...addendumBlocks(addendum));
  blocks.push({ kind: "heading", text: "Signatures" });
  blocks.push({
    kind: "para",
    text: REQUIRED_TERMS.signatures,
  });
  blocks.push({
    kind: "small",
    text: o.demo
      ? "Demo template written for this product. It is not the Dubai Land Department's standard form and has not been reviewed by a lawyer. All people and numbers in the demo are fictional."
      : "Template wording to be reviewed by a Dubai property lawyer before use.",
  });
  return { title: `Tenancy contract ${f.leaseRef} (v${o.version})`, blocks };
}
