import { type Addendum, CONTRACT_CLAUSES, type ContractFields, formatAed } from "@leasing/core";
import type { NoticeBlock, NoticeDocument } from "../renewal/notice.ts";

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
        "The rent above is fixed for the whole term. It can only change at renewal, with written notice given in time under Dubai law.",
        "The tenant pays the rent by the cheques listed above. A bounced cheque is handled under the law and the company's collection process.",
        "The security deposit is refunded at the end of the tenancy, less the cost of any damage beyond normal wear.",
        "The landlord keeps the unit fit to live in and does structural repairs and repairs to the building's main systems.",
        "The tenant uses the unit for the use stated above and keeps it in good condition.",
        "This contract is registered in Ejari after both parties sign.",
      ],
    },
  ];
  const chosen = addendum.clauses.map((c) => `${CONTRACT_CLAUSES[c].title}: ${CONTRACT_CLAUSES[c].text}`);
  if (chosen.length || addendum.freeText) {
    blocks.push({ kind: "heading", text: "Addendum" });
    if (chosen.length) blocks.push({ kind: "list", items: chosen });
    if (addendum.freeText) {
      blocks.push({ kind: "para", text: "Additional terms agreed by the parties:" });
      for (const p of addendum.freeText.split(/\n{2,}/)) blocks.push({ kind: "para", text: p.trim() });
    }
  }
  blocks.push({ kind: "heading", text: "Signatures" });
  blocks.push({
    kind: "para",
    text: "Each party signs this contract electronically through a personal link. The signature record is added as the last page of the signed copy.",
  });
  blocks.push({
    kind: "small",
    text: o.demo
      ? "Demo template written for this product. It is not the Dubai Land Department's standard form and has not been reviewed by a lawyer. All people and numbers in the demo are fictional."
      : "Template wording to be reviewed by a Dubai property lawyer before use.",
  });
  return { title: `Tenancy contract ${f.leaseRef} (v${o.version})`, blocks };
}
