import type { ContractFieldName } from "@leasing/core";
import type { Spec } from "@platform/readers/testing/sample-pdf";

/**
 * Fictional sample contracts for tests and `bun run eval -- contract-structure`, generated with
 * pdf-lib. Nothing here is a real company: names are invented and the logos are simple shapes.
 */
export interface Expect {
  sections: number;
  blanks: number;
  /** A blank whose last 30 characters before it contain `near` must map to `field`. */
  maps: { near: string; field: ContractFieldName }[];
  signatures: number;
  numbering: string;
  style: {
    family: "serif" | "sans";
    page: [number, number];
    accent: string;
    headerHas?: string;
    footerHas?: string;
    logo: boolean;
    authorityMarks: boolean;
  };
}

const U = "____________________";
export const SAMPLES: { spec: Spec; expect: Expect }[] = [
  {
    spec: {
      id: "serif-classic",
      serif: true,
      size: [595, 842],
      accent: [26, 51, 178],
      leftMargin: 72,
      header: "ACME PROPERTIES LLC | Residential Tenancy Contract",
      footer: "Page {n} of {N}",
      logo: { colour: [200, 40, 40] },
      title: "RESIDENTIAL TENANCY CONTRACT",
      intro: ["This contract is made between the landlord and the tenant named below."],
      sections: [
        {
          heading: "1. PARTIES",
          lines: [`Landlord name: ${U}`, `Tenant name: ${U}`, `Tenant Emirates ID number: ${U}`],
        },
        {
          heading: "2. PROPERTY",
          lines: ["Building: ______________   Unit number: ________", `Makani number: ${U}`],
        },
        {
          heading: "3. TERM AND RENT",
          lines: [
            "3.1 The tenancy starts on ________________ and ends on ________________.",
            "3.2 The annual rent is AED ______________ payable in ____ cheques.",
            "3.3 Security deposit: AED ____________.",
          ],
        },
        {
          heading: "4. GENERAL CONDITIONS",
          pageBreakBefore: true,
          lines: [
            "4.1 The tenant shall keep the unit clean and pay for minor repairs caused by ordinary use.",
            "4.2 The tenant may not sublet the unit without the landlord's written consent.",
          ],
        },
        { heading: "5. SIGNATURES", lines: [`Tenant signature: ${U}`] },
      ],
    },
    expect: {
      sections: 5,
      blanks: 12,
      signatures: 1,
      numbering: "decimal_nested",
      maps: [
        { near: "Landlord name:", field: "landlordNameEn" },
        { near: "Tenant name:", field: "tenantNameEn" },
        { near: "Tenant Emirates ID number:", field: "tenantEmiratesIdNo" },
        { near: "Building:", field: "building" },
        { near: "Unit number:", field: "unitNo" },
        { near: "Makani number:", field: "makaniNo" },
        { near: "starts on", field: "startOn" },
        { near: "ends on", field: "endOn" },
        { near: "annual rent is AED", field: "annualRentFils" },
        { near: "payable in", field: "cheques" },
        { near: "Security deposit: AED", field: "depositFils" },
      ],
      style: {
        family: "serif",
        page: [595, 842],
        accent: "#1a33b2",
        headerHas: "ACME PROPERTIES LLC",
        footerHas: "Page {page} of {pages}",
        logo: true,
        authorityMarks: false,
      },
    },
  },
  {
    spec: {
      id: "sans-article",
      serif: false,
      size: [612, 792],
      accent: [20, 120, 70],
      leftMargin: 60,
      header: "HARBOUR VIEW REALTY - Tenancy Agreement",
      footer: "Harbour View Realty | Page {n}",
      logo: { colour: [20, 120, 70] },
      title: "TENANCY AGREEMENT",
      intro: ["The parties agree as follows."],
      sections: [
        {
          heading: "Article I: Parties",
          lines: ["Tenant full name: << >>", "Tenant email: {   }", "Tenant phone: [____]"],
        },
        {
          heading: "Article II: Rent",
          lines: ["Annual rent (AED): [ ]", "Start date: ........", "End date: ........", "Rent-free days: ........"],
        },
        {
          heading: "Article III: Use",
          pageBreakBefore: true,
          lines: ["The unit is for residential use only and may not be sublet."],
        },
      ],
    },
    expect: {
      sections: 3,
      blanks: 7,
      signatures: 0,
      numbering: "article",
      maps: [
        { near: "Tenant full name:", field: "tenantNameEn" },
        { near: "Tenant email:", field: "tenantEmail" },
        { near: "Tenant phone:", field: "tenantPhone" },
        { near: "Annual rent (AED):", field: "annualRentFils" },
        { near: "Start date:", field: "startOn" },
        { near: "End date:", field: "endOn" },
        { near: "Rent-free days:", field: "rentFreeDays" },
      ],
      style: {
        family: "sans",
        page: [612, 792],
        accent: "#147846",
        headerHas: "HARBOUR VIEW REALTY",
        footerHas: "Page {page}",
        logo: true,
        authorityMarks: false,
      },
    },
  },
  {
    spec: {
      id: "sans-roman",
      serif: false,
      size: [595, 842],
      accent: [210, 100, 20],
      leftMargin: 56,
      footer: "Palm Court Leasing - confidential - {n}/{N}",
      title: "LEASE OF A RESIDENTIAL UNIT",
      intro: ["Between the landlord and the tenant named below."],
      sections: [
        {
          heading: "I. THE PARTIES",
          lines: ["Landlord name: ________________ (the landlord)", "Tenant nationality: ____________"],
        },
        {
          heading: "II. THE PREMISES",
          lines: ["Unit no.: ________", "Bedrooms: ____", "Move-in date: ____________"],
        },
        {
          heading: "III. DEPOSIT",
          pageBreakBefore: true,
          lines: ["Deposit: ____________ AED"],
        },
      ],
    },
    expect: {
      sections: 3,
      blanks: 6,
      signatures: 0,
      numbering: "roman",
      maps: [
        { near: "Landlord name:", field: "landlordNameEn" },
        { near: "Tenant nationality:", field: "tenantNationality" },
        { near: "Unit no.:", field: "unitNo" },
        { near: "Bedrooms:", field: "bedrooms" },
        { near: "Move-in date:", field: "moveInOn" },
        { near: "Deposit:", field: "depositFils" },
      ],
      style: {
        family: "sans",
        page: [595, 842],
        accent: "#d26414",
        footerHas: "Palm Court Leasing",
        logo: false,
        authorityMarks: false,
      },
    },
  },
  {
    spec: {
      id: "dld-header",
      serif: true,
      size: [595, 842],
      accent: [60, 60, 60].map((c) => c) as [number, number, number],
      leftMargin: 72,
      header: "Dubai Land Department - Ejari Tenancy Contract",
      footer: "Page {n} of {N}",
      logo: { colour: [0, 0, 0] },
      title: "TENANCY CONTRACT",
      intro: ["Fictional sample with look-alike authority wording, used only to test the flag."],
      sections: [
        { heading: "1. PARTIES", lines: [`Landlord name: ${U}`, `Tenant name: ${U}`] },
        { heading: "2. RENT", pageBreakBefore: true, lines: ["The annual rent is AED ______________."] },
      ],
    },
    expect: {
      sections: 2,
      blanks: 3,
      signatures: 0,
      numbering: "decimal",
      maps: [
        { near: "Landlord name:", field: "landlordNameEn" },
        { near: "Tenant name:", field: "tenantNameEn" },
        { near: "annual rent is AED", field: "annualRentFils" },
      ],
      style: { family: "serif", page: [595, 842], accent: "", logo: true, authorityMarks: true },
    },
  },
];
export { generatePdf, hexOf, type Spec, type SpecSection } from "@platform/readers/testing/sample-pdf";
