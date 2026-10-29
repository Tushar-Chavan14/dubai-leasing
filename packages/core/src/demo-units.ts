import type { PropertyCategory, PropertySubtype } from "./portfolio.ts";

/**
 * Demo portfolio (all fictional) shared by the engine's demo seed and the simulated Ejari registry,
 * so every seeded unit is known to the registry (ruling P9). Rents are integer fils and sit inside
 * the allowed range of the unit's company rent rule applied to the SRI average, so these units are
 * bookable without approval.
 */
export interface DemoCompany {
  slug: string;
  name: string;
  kind: "developer" | "realty" | "owner";
}

/**
 * Company names may be real for pitch realism; all units, people, numbers and rules in this demo
 * are fictional and do not represent those companies.
 */
export const DEMO_COMPANIES: DemoCompany[] = [
  { slug: "silverline", name: "Silverline Properties", kind: "developer" },
  { slug: "qamar-realty", name: "Qamar Realty", kind: "realty" },
  { slug: "al-noor-holdings", name: "Al Noor Family Holdings", kind: "owner" },
  { slug: "sobha", name: "Sobha Realty", kind: "developer" },
  { slug: "modon", name: "Modon Properties", kind: "developer" },
];

/**
 * Legal (landlord) details and authorised signatory of each demo company (D44). All names and numbers are fictional
 * demo data: the Emirates ID serials use birth year 1900 (no real holder), licence numbers carry "DEMO", emails use
 * the reserved `.example` domain. The simulated Ejari registers each demo unit to its company's legal name.
 */
export interface DemoCompanyLegal {
  legalNameEn: string;
  legalNameAr: string;
  tradeLicenceNo: string;
  tradeLicenceAuthority: string;
  tradeLicenceExpiresOn: string;
  reraOrn: string | null;
  registeredAddress: string;
  email: string;
  phone: string;
  chequePayeeName: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  /** Serial after `784-1900-`; the check digit is added by the seed. */
  signatoryEidSerial: string;
  signatoryIdExpiresOn: string;
}

export const DEMO_COMPANY_LEGAL: Record<string, DemoCompanyLegal> = {
  silverline: {
    legalNameEn: "Silverline Properties L.L.C. (demo)",
    legalNameAr: "سيلفرلاين للعقارات ذ.م.م (تجريبي)",
    tradeLicenceNo: "DEMO-TL-100201",
    tradeLicenceAuthority: "Demo Department of Economy and Tourism",
    tradeLicenceExpiresOn: "2035-12-31",
    reraOrn: "DEMO-ORN-1001",
    registeredAddress: "Demo Tower, Business Bay, Dubai (fictional address)",
    email: "leasing@silverline.demo.example",
    phone: "+971 4 000 0201",
    chequePayeeName: "Silverline Properties L.L.C. (demo)",
    signatoryName: "Idris Example Malik",
    signatoryTitle: "Chief Executive Officer",
    signatoryEmail: "signatory@silverline.demo.example",
    signatoryEidSerial: "2000001",
    signatoryIdExpiresOn: "2035-12-31",
  },
  "qamar-realty": {
    legalNameEn: "Qamar Realty L.L.C. (demo)",
    legalNameAr: "قمر للعقارات ذ.م.م (تجريبي)",
    tradeLicenceNo: "DEMO-TL-100202",
    tradeLicenceAuthority: "Demo Department of Economy and Tourism",
    tradeLicenceExpiresOn: "2035-12-31",
    reraOrn: "DEMO-ORN-1002",
    registeredAddress: "Demo Plaza, Deira, Dubai (fictional address)",
    email: "leasing@qamar.demo.example",
    phone: "+971 4 000 0202",
    chequePayeeName: "Qamar Realty L.L.C. (demo)",
    signatoryName: "Zainab Sample Qureshi",
    signatoryTitle: "Managing Director",
    signatoryEmail: "signatory@qamar.demo.example",
    signatoryEidSerial: "2000002",
    signatoryIdExpiresOn: "2035-12-31",
  },
  "al-noor-holdings": {
    legalNameEn: "Al Noor Family Holdings L.L.C. (demo)",
    legalNameAr: "النور القابضة العائلية ذ.م.م (تجريبي)",
    tradeLicenceNo: "DEMO-TL-100203",
    tradeLicenceAuthority: "Demo Department of Economy and Tourism",
    tradeLicenceExpiresOn: "2035-12-31",
    reraOrn: null,
    registeredAddress: "Demo House, Al Barsha, Dubai (fictional address)",
    email: "office@alnoor.demo.example",
    phone: "+971 4 000 0203",
    chequePayeeName: "Al Noor Family Holdings L.L.C. (demo)",
    signatoryName: "Faisal Demo Al Noor",
    signatoryTitle: "Chairman",
    signatoryEmail: "signatory@alnoor.demo.example",
    signatoryEidSerial: "2000003",
    signatoryIdExpiresOn: "2035-12-31",
  },
  sobha: {
    legalNameEn: "Sobha Realty L.L.C. (demo)",
    legalNameAr: "صبحا العقارية ذ.م.م (تجريبي)",
    tradeLicenceNo: "DEMO-TL-100204",
    tradeLicenceAuthority: "Demo Department of Economy and Tourism",
    tradeLicenceExpiresOn: "2035-12-31",
    reraOrn: "DEMO-ORN-1004",
    registeredAddress: "Demo Hartland, Sobha, Dubai (fictional address)",
    email: "leasing@sobha.demo.example",
    phone: "+971 4 000 0204",
    chequePayeeName: "Sobha Realty L.L.C. (demo)",
    signatoryName: "Karthik Specimen Nair",
    signatoryTitle: "Head of Leasing",
    signatoryEmail: "signatory@sobha.demo.example",
    signatoryEidSerial: "2000004",
    signatoryIdExpiresOn: "2035-12-31",
  },
  modon: {
    legalNameEn: "Modon Properties L.L.C. (demo)",
    legalNameAr: "مدن للعقارات ذ.م.م (تجريبي)",
    tradeLicenceNo: "DEMO-TL-100205",
    tradeLicenceAuthority: "Demo Department of Economy and Tourism",
    tradeLicenceExpiresOn: "2035-12-31",
    reraOrn: "DEMO-ORN-1005",
    registeredAddress: "Demo Centre, Jumeirah Lakes Towers, Dubai (fictional address)",
    email: "leasing@modon.demo.example",
    phone: "+971 4 000 0205",
    chequePayeeName: "Modon Properties L.L.C. (demo)",
    signatoryName: "Mariam Test Haddad",
    signatoryTitle: "Director of Operations",
    signatoryEmail: "signatory@modon.demo.example",
    signatoryEidSerial: "2000005",
    signatoryIdExpiresOn: "2035-12-31",
  },
};

export interface DemoListedUnit {
  code: string;
  /** Company slug. */
  company: string;
  category: PropertyCategory;
  subtype: PropertySubtype;
  building: string;
  community: string;
  unitNo: string;
  makaniNo: string;
  /** Null for commercial and retail units. */
  bedrooms: number | null;
  furnished: boolean;
  areaSqft: number;
  askingRentFils: number;
  description: string;
}

const aed = (n: number) => n * 100;

/** Units the demo seed walks to LISTED, beyond JVC-0412: 12 residential, 4 commercial, 3 retail. */
export const DEMO_LISTED_UNITS: DemoListedUnit[] = [
  {
    code: "MRN-0709",
    company: "silverline",
    category: "residential",
    subtype: "apartment",
    building: "Demo Marina Tower",
    community: "Dubai Marina",
    unitNo: "709",
    makaniNo: "1111166666",
    bedrooms: 0,
    furnished: true,
    areaSqft: 520,
    askingRentFils: aed(64_000),
    description: "Furnished studio near the marina walk. Sofa bed, full kitchen, balcony, one parking space.",
  },
  {
    code: "BBY-0903",
    company: "silverline",
    category: "residential",
    subtype: "apartment",
    building: "Demo Canal Heights",
    community: "Business Bay",
    unitNo: "903",
    makaniNo: "5555511111",
    bedrooms: 0,
    furnished: false,
    areaSqft: 480,
    askingRentFils: aed(54_000),
    description: "Bright studio with a canal glimpse. Compact kitchen, built-in storage, gym and pool in the building.",
  },
  {
    code: "BBY-1710",
    company: "silverline",
    category: "residential",
    subtype: "apartment",
    building: "Demo Canal Heights",
    community: "Business Bay",
    unitNo: "1710",
    makaniNo: "5555522222",
    bedrooms: 3,
    furnished: false,
    areaSqft: 2050,
    askingRentFils: aed(240_000),
    description: "Spacious three-bedroom with a canal-facing living room, maid's room and two parking spaces.",
  },
  {
    code: "JVC-0221",
    company: "qamar-realty",
    category: "residential",
    subtype: "apartment",
    building: "Demo Circle Residence",
    community: "Jumeirah Village Circle",
    unitNo: "221",
    makaniNo: "2222244444",
    bedrooms: 2,
    furnished: false,
    areaSqft: 1150,
    askingRentFils: aed(100_000),
    description:
      "Two-bedroom on a low floor next to the park, with a private terrace. New flooring, pool and gym in the building.",
  },
  {
    code: "ALB-0314",
    company: "qamar-realty",
    category: "residential",
    subtype: "apartment",
    building: "Demo Barsha Gardens",
    community: "Al Barsha",
    unitNo: "314",
    makaniNo: "6666611111",
    bedrooms: 2,
    furnished: false,
    areaSqft: 1240,
    askingRentFils: aed(96_000),
    description: "Two-bedroom on the third floor with a balcony, built-in wardrobes and one covered parking space.",
  },
  {
    code: "ARR-0017",
    company: "al-noor-holdings",
    category: "residential",
    subtype: "villa",
    building: "Demo Ranches Villas",
    community: "Arabian Ranches",
    unitNo: "17",
    makaniNo: "7777711111",
    bedrooms: 4,
    furnished: false,
    areaSqft: 4300,
    askingRentFils: aed(375_000),
    description: "Four-bedroom villa with a private garden and pool, maid's room and a two-car garage.",
  },
  {
    code: "ARR-0042",
    company: "al-noor-holdings",
    category: "residential",
    subtype: "villa",
    building: "Demo Ranches Villas",
    community: "Arabian Ranches",
    unitNo: "42",
    makaniNo: "7777722222",
    bedrooms: 3,
    furnished: false,
    areaSqft: 3100,
    askingRentFils: aed(265_000),
    description: "Three-bedroom villa on a quiet street with a small garden, study and a two-car garage.",
  },
  {
    code: "ARR-0108",
    company: "al-noor-holdings",
    category: "residential",
    subtype: "townhouse",
    building: "Demo Ranches Townhouses",
    community: "Arabian Ranches",
    unitNo: "108",
    makaniNo: "7777733333",
    bedrooms: 3,
    furnished: false,
    areaSqft: 2400,
    askingRentFils: aed(250_000),
    description: "Three-bedroom townhouse with a courtyard, a shared pool and one covered parking space.",
  },
  {
    code: "SHL-1306",
    company: "sobha",
    category: "residential",
    subtype: "apartment",
    building: "Demo Hartland Residence",
    community: "Sobha Hartland",
    unitNo: "1306",
    makaniNo: "4444411111",
    bedrooms: 1,
    furnished: false,
    areaSqft: 780,
    askingRentFils: aed(96_000),
    description: "One-bedroom with a lagoon-side balcony, built-in wardrobes and one covered parking space.",
  },
  {
    code: "SHL-2108",
    company: "sobha",
    category: "residential",
    subtype: "apartment",
    building: "Demo Hartland Residence",
    community: "Sobha Hartland",
    unitNo: "2108",
    makaniNo: "4444422222",
    bedrooms: 2,
    furnished: false,
    areaSqft: 1280,
    askingRentFils: aed(150_000),
    description: "Two-bedroom on a high floor with a skyline view, a study nook and two parking spaces.",
  },
  {
    code: "BBY-OF-0905",
    company: "sobha",
    category: "commercial",
    subtype: "office",
    building: "Demo Sobha Offices",
    community: "Business Bay",
    unitNo: "905",
    makaniNo: "4444433333",
    bedrooms: null,
    furnished: false,
    areaSqft: 1000,
    askingRentFils: aed(78_000),
    description: "Fitted office with a meeting room and a pantry. One parking space.",
  },
  {
    code: "DCH-1411",
    company: "modon",
    category: "residential",
    subtype: "apartment",
    building: "Demo Harbour Gate",
    community: "Dubai Creek Harbour",
    unitNo: "1411",
    makaniNo: "3333322222",
    bedrooms: 1,
    furnished: false,
    areaSqft: 820,
    askingRentFils: aed(110_000),
    description: "One-bedroom with a creek view, open kitchen and one parking space. Pool and gym in the building.",
  },
  {
    code: "DCH-2503",
    company: "modon",
    category: "residential",
    subtype: "apartment",
    building: "Demo Harbour Gate",
    community: "Dubai Creek Harbour",
    unitNo: "2503",
    makaniNo: "3333333333",
    bedrooms: 2,
    furnished: false,
    areaSqft: 1320,
    askingRentFils: aed(170_000),
    description: "Two-bedroom on a high floor with a balcony facing the creek, maid's room and two parking spaces.",
  },
  {
    code: "BBY-OF-1105",
    company: "silverline",
    category: "commercial",
    subtype: "office",
    building: "Demo Business Tower",
    community: "Business Bay",
    unitNo: "1105",
    makaniNo: "8888811111",
    bedrooms: null,
    furnished: false,
    areaSqft: 1200,
    askingRentFils: aed(92_000),
    description: "Open-plan office on the 11th floor with a meeting room and a pantry. Two parking spaces.",
  },
  {
    code: "BBY-OF-1402",
    company: "silverline",
    category: "commercial",
    subtype: "office",
    building: "Demo Business Tower",
    community: "Business Bay",
    unitNo: "1402",
    makaniNo: "8888822222",
    bedrooms: null,
    furnished: false,
    areaSqft: 2000,
    askingRentFils: aed(150_000),
    description: "Large office floor with four private rooms and a reception area. Four parking spaces.",
  },
  {
    code: "BBY-OF-0806",
    company: "qamar-realty",
    category: "commercial",
    subtype: "office",
    building: "Demo Executive Offices",
    community: "Business Bay",
    unitNo: "806",
    makaniNo: "8888833333",
    bedrooms: null,
    furnished: false,
    areaSqft: 900,
    askingRentFils: aed(68_000),
    description: "Fitted office with two private rooms and a shared reception. One parking space.",
  },
  {
    code: "ALB-SH-11",
    company: "qamar-realty",
    category: "retail",
    subtype: "shop",
    building: "Demo Barsha Retail Row",
    community: "Al Barsha",
    unitNo: "11",
    makaniNo: "9999911111",
    bedrooms: null,
    furnished: false,
    areaSqft: 500,
    askingRentFils: aed(64_000),
    description: "Ground-floor shop with street frontage, a storeroom and a customer parking bay.",
  },
  {
    code: "ALB-SH-12",
    company: "qamar-realty",
    category: "retail",
    subtype: "shop",
    building: "Demo Barsha Retail Row",
    community: "Al Barsha",
    unitNo: "12",
    makaniNo: "9999922222",
    bedrooms: null,
    furnished: false,
    areaSqft: 700,
    askingRentFils: aed(88_000),
    description: "Corner ground-floor shop with a wide shopfront and a small back office.",
  },
  {
    code: "MRN-SH-05",
    company: "silverline",
    category: "retail",
    subtype: "shop",
    building: "Demo Marina Promenade",
    community: "Dubai Marina",
    unitNo: "5",
    makaniNo: "9999933333",
    bedrooms: null,
    furnished: false,
    areaSqft: 600,
    askingRentFils: aed(155_000),
    description: "Shop on the marina walk with outdoor seating space and a storeroom.",
  },
];

/** Smart Rental Index rows: residential by bedrooms (annual AED), commercial and retail per sqft (annual AED). */
export interface DemoSriRow {
  community: string;
  category: PropertyCategory;
  bedrooms: number | null;
  avgAnnualRentAed?: number;
  avgAnnualRentPerSqftAed?: number;
}

export const DEMO_SRI: DemoSriRow[] = [
  { community: "Dubai Marina", category: "residential", bedrooms: 0, avgAnnualRentAed: 62_000 },
  // MRN-1204 at 85,000 is 15% below 100,000 → up to 5%.
  { community: "Dubai Marina", category: "residential", bedrooms: 1, avgAnnualRentAed: 100_000 },
  { community: "Dubai Marina", category: "residential", bedrooms: 2, avgAnnualRentAed: 158_000 },
  { community: "Dubai Marina", category: "residential", bedrooms: 3, avgAnnualRentAed: 215_000 },
  { community: "Jumeirah Village Circle", category: "residential", bedrooms: 0, avgAnnualRentAed: 50_000 },
  { community: "Jumeirah Village Circle", category: "residential", bedrooms: 1, avgAnnualRentAed: 74_000 },
  { community: "Jumeirah Village Circle", category: "residential", bedrooms: 2, avgAnnualRentAed: 105_000 },
  { community: "Sobha Hartland", category: "residential", bedrooms: 1, avgAnnualRentAed: 95_000 },
  { community: "Sobha Hartland", category: "residential", bedrooms: 2, avgAnnualRentAed: 150_000 },
  { community: "Dubai Creek Harbour", category: "residential", bedrooms: 1, avgAnnualRentAed: 112_000 },
  { community: "Dubai Creek Harbour", category: "residential", bedrooms: 2, avgAnnualRentAed: 168_000 },
  { community: "Business Bay", category: "residential", bedrooms: 0, avgAnnualRentAed: 52_000 },
  { community: "Business Bay", category: "residential", bedrooms: 3, avgAnnualRentAed: 235_000 },
  { community: "Al Barsha", category: "residential", bedrooms: 2, avgAnnualRentAed: 95_000 },
  { community: "Arabian Ranches", category: "residential", bedrooms: 3, avgAnnualRentAed: 260_000 },
  { community: "Arabian Ranches", category: "residential", bedrooms: 4, avgAnnualRentAed: 380_000 },
  { community: "Business Bay", category: "commercial", bedrooms: null, avgAnnualRentPerSqftAed: 75 },
  { community: "Al Barsha", category: "retail", bedrooms: null, avgAnnualRentPerSqftAed: 120 },
  { community: "Dubai Marina", category: "retail", bedrooms: null, avgAnnualRentPerSqftAed: 250 },
];

export interface DemoRentRule {
  company: string;
  category: PropertyCategory;
  community?: string;
  minPctBp: number;
  maxPctBp: number;
  minRentAed?: number;
  maxRentAed?: number;
}

export const DEMO_RENT_RULES: DemoRentRule[] = [
  { company: "silverline", category: "residential", minPctBp: -500, maxPctBp: 1000 },
  // More specific than the category rule: Dubai Marina units follow a tighter band.
  { company: "silverline", category: "residential", community: "Dubai Marina", minPctBp: -300, maxPctBp: 800 },
  { company: "silverline", category: "commercial", minPctBp: -500, maxPctBp: 1000 },
  { company: "silverline", category: "retail", minPctBp: -500, maxPctBp: 1000 },
  { company: "qamar-realty", category: "residential", minPctBp: -1000, maxPctBp: 1000 },
  { company: "qamar-realty", category: "commercial", minPctBp: -1000, maxPctBp: 1000, minRentAed: 50_000 },
  { company: "qamar-realty", category: "retail", minPctBp: 0, maxPctBp: 1500, minRentAed: 60_000 },
  { company: "al-noor-holdings", category: "residential", minPctBp: -800, maxPctBp: 600 },
  { company: "sobha", category: "residential", minPctBp: -500, maxPctBp: 1000 },
  { company: "sobha", category: "commercial", minPctBp: -500, maxPctBp: 1000 },
  { company: "modon", category: "residential", minPctBp: -800, maxPctBp: 800 },
];

export interface DemoContractRule {
  company: string;
  category: PropertyCategory;
  tenures: ("annual" | "short_term")[];
  minCheques: number;
  maxCheques: number;
}

export const DEMO_CONTRACT_RULES: DemoContractRule[] = [
  { company: "silverline", category: "residential", tenures: ["annual"], minCheques: 1, maxCheques: 4 },
  { company: "silverline", category: "commercial", tenures: ["annual"], minCheques: 1, maxCheques: 2 },
  { company: "silverline", category: "retail", tenures: ["annual"], minCheques: 1, maxCheques: 2 },
  { company: "qamar-realty", category: "residential", tenures: ["annual"], minCheques: 1, maxCheques: 4 },
  { company: "qamar-realty", category: "commercial", tenures: ["annual"], minCheques: 1, maxCheques: 2 },
  { company: "qamar-realty", category: "retail", tenures: ["annual"], minCheques: 1, maxCheques: 2 },
  { company: "al-noor-holdings", category: "residential", tenures: ["annual"], minCheques: 1, maxCheques: 4 },
  { company: "sobha", category: "residential", tenures: ["annual"], minCheques: 1, maxCheques: 4 },
  { company: "sobha", category: "commercial", tenures: ["annual"], minCheques: 1, maxCheques: 2 },
  { company: "modon", category: "residential", tenures: ["annual"], minCheques: 1, maxCheques: 4 },
];

/** [DLD property number, unit number, Makani number] for a unit the seed creates. */
export type DemoProperty = [dld: string, unitNo: string, makaniNo: string, companySlug: string];

export const demoDldNo = (unitNo: string) => `DEMO-DLD-00${unitNo.padStart(4, "0")}`;

/** MRN-1502 is seeded in PREP with this Makani number (the registry needs one to match). */
export const DEMO_MRN_1502_MAKANI = "1111155555";

/** Every unit the demo seed creates: the let and in-progress units (including MRN-1502), then the listed ones. */
export const DEMO_PROPERTIES: DemoProperty[] = [
  ["DEMO-DLD-001204", "1204", "1111122222", "silverline"],
  ["DEMO-DLD-000807", "807", "1111133333", "silverline"],
  ["DEMO-DLD-000310", "310", "2222211111", "al-noor-holdings"],
  ["DEMO-DLD-001608", "1608", "1111144444", "silverline"],
  ["DEMO-DLD-000412", "412", "2222233333", "al-noor-holdings"],
  ["DEMO-DLD-002205", "2205", "3333311111", "al-noor-holdings"],
  [demoDldNo("1502"), "1502", DEMO_MRN_1502_MAKANI, "silverline"],
  ...DEMO_LISTED_UNITS.map((u): DemoProperty => [demoDldNo(u.unitNo), u.unitNo, u.makaniNo, u.company]),
];
