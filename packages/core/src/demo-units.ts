import type { Emirate } from "./emirates.ts";
import { type PropertyCategory, type PropertySubtype, propertyUsageFor } from "./portfolio.ts";

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
export const DEMO_COMPANIES: DemoCompany[] = [{ slug: "silverline", name: "Silverline Properties", kind: "developer" }];

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
  /** Defaults to Dubai. */
  emirate?: Emirate;
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
  {
    code: "JVC-0221",
    company: "silverline",
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
    code: "ARR-0017",
    company: "silverline",
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
];

const EMIRATE_PREFIX: Record<Emirate, string> = {
  dubai: "DLD",
  abu_dhabi: "AUH",
  sharjah: "SHJ",
  ajman: "AJM",
  ras_al_khaimah: "RAK",
  fujairah: "FUJ",
  umm_al_quwain: "UAQ",
};

/** Demo property number of a unit: Dubai keeps `DEMO-DLD-00<unit>`; the others use their emirate prefix. */
export const demoPropertyNo = (emirate: Emirate, unitNo: string) =>
  `DEMO-${EMIRATE_PREFIX[emirate]}-00${unitNo.padStart(4, "0")}`;

type EmirateUnitInput = Omit<DemoListedUnit, "company" | "emirate" | "makaniNo" | "furnished" | "subtype"> & {
  subtype?: PropertySubtype;
};

function emirateUnits(emirate: Emirate, rows: EmirateUnitInput[]): DemoListedUnit[] {
  return rows.map((r) => ({
    ...r,
    emirate,
    company: "silverline",
    subtype: r.subtype ?? (r.category === "residential" ? "apartment" : r.category === "retail" ? "shop" : "office"),
    furnished: false,
    // Non-Dubai units have no Makani number: a demo address code fills the required field.
    makaniNo: `DEMO-ADDR-${EMIRATE_PREFIX[emirate]}-${r.code.split("-").pop()}`,
  }));
}

/**
 * Two fictional listed units in each of the six other emirates (D55): a residential apartment and a commercial
 * office or retail shop. Asking rents come from the demo rent index of their community (general public data, low to
 * medium confidence), so they are inside the rent rule's range and bookable without approval.
 */
export const DEMO_EMIRATE_UNITS: DemoListedUnit[] = [
  ...emirateUnits("abu_dhabi", [
    {
      code: "AUH-0101",
      category: "residential",
      building: "Demo Reem Bay Residences",
      community: "Al Reem Island",
      unitNo: "2101",
      bedrooms: 2,
      areaSqft: 1250,
      askingRentFils: aed(115_000),
      description: "Two-bedroom apartment with a marina view, built-in wardrobes, pool, gym and one parking space.",
    },
    {
      code: "AUH-OF-0201",
      category: "commercial",
      building: "Demo Yas Business Centre",
      community: "Yas Island",
      unitNo: "2102",
      bedrooms: null,
      areaSqft: 1000,
      askingRentFils: aed(90_000),
      description: "Fitted office with a meeting room and pantry, two parking spaces and reception cover.",
    },
  ]),
  ...emirateUnits("sharjah", [
    {
      code: "SHJ-0101",
      category: "residential",
      building: "Demo Nahda Heights",
      community: "Al Nahda",
      unitNo: "2201",
      bedrooms: 2,
      areaSqft: 1100,
      askingRentFils: aed(45_000),
      description: "Two-bedroom family apartment with a balcony, covered parking and a children's play area.",
    },
    {
      code: "SHJ-SH-0201",
      category: "retail",
      building: "Demo Majaz Arcade",
      community: "Al Majaz",
      unitNo: "2202",
      bedrooms: null,
      areaSqft: 500,
      askingRentFils: aed(75_000),
      description: "Ground-floor shop on a busy street near the waterfront, with a small storeroom.",
    },
  ]),
  ...emirateUnits("ajman", [
    {
      code: "AJM-0101",
      category: "residential",
      building: "Demo Nuaimiya Court",
      community: "Al Nuaimiya",
      unitNo: "2301",
      bedrooms: 1,
      areaSqft: 700,
      askingRentFils: aed(24_000),
      description: "One-bedroom apartment with a balcony, central air conditioning and a parking space.",
    },
    {
      code: "AJM-OF-0201",
      category: "commercial",
      building: "Demo Downtown Offices",
      community: "Ajman Downtown",
      unitNo: "2302",
      bedrooms: null,
      areaSqft: 800,
      askingRentFils: aed(40_000),
      description: "Open office with two private rooms and a pantry, close to the main road.",
    },
  ]),
  ...emirateUnits("ras_al_khaimah", [
    {
      code: "RAK-0101",
      category: "residential",
      building: "Demo Hamra Beach Residences",
      community: "Al Hamra",
      unitNo: "2401",
      bedrooms: 2,
      areaSqft: 1200,
      askingRentFils: aed(75_000),
      description: "Two-bedroom apartment a short walk from the beach, with a pool, gym and a parking space.",
    },
    {
      code: "RAK-SH-0201",
      category: "retail",
      building: "Demo Mina Boardwalk",
      community: "Mina Al Arab",
      unitNo: "2402",
      bedrooms: null,
      areaSqft: 600,
      askingRentFils: aed(78_000),
      description: "Boardwalk shop with a glass front and outdoor seating space.",
    },
  ]),
  ...emirateUnits("fujairah", [
    {
      code: "FUJ-0101",
      category: "residential",
      building: "Demo Sakamkam Gardens",
      community: "Sakamkam",
      unitNo: "2501",
      bedrooms: 2,
      areaSqft: 1000,
      askingRentFils: aed(40_000),
      description: "Two-bedroom apartment with mountain views, a balcony and covered parking.",
    },
    {
      code: "FUJ-OF-0201",
      category: "commercial",
      building: "Demo City Centre Offices",
      community: "Fujairah City Centre",
      unitNo: "2502",
      bedrooms: null,
      areaSqft: 700,
      askingRentFils: aed(49_000),
      description: "Office in the city centre with a reception area and a meeting room.",
    },
  ]),
  ...emirateUnits("umm_al_quwain", [
    {
      code: "UAQ-0101",
      category: "residential",
      building: "Demo Salamah Residence",
      community: "Al Salamah",
      unitNo: "2601",
      bedrooms: 1,
      areaSqft: 650,
      askingRentFils: aed(21_000),
      description: "One-bedroom apartment in a quiet block, with a balcony and a parking space.",
    },
    {
      code: "UAQ-OF-0201",
      category: "commercial",
      building: "Demo Modern City Offices",
      community: "Emirates Modern City",
      unitNo: "2602",
      bedrooms: null,
      areaSqft: 1000,
      askingRentFils: aed(50_000),
      description: "Office suite with an open plan, a private room and two parking spaces.",
    },
  ]),
];

/** Smart Rental Index rows: residential by bedrooms (annual AED), commercial and retail per sqft (annual AED). */
export interface DemoSriRow {
  /** Defaults to Dubai. */
  emirate?: Emirate;
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
  // Other emirates: a rent index row per community of the seeded units (general public data, low to medium confidence).
  { emirate: "abu_dhabi", community: "Al Reem Island", category: "residential", bedrooms: 1, avgAnnualRentAed: 80_000 },
  {
    emirate: "abu_dhabi",
    community: "Al Reem Island",
    category: "residential",
    bedrooms: 2,
    avgAnnualRentAed: 115_000,
  },
  {
    emirate: "abu_dhabi",
    community: "Yas Island",
    category: "commercial",
    bedrooms: null,
    avgAnnualRentPerSqftAed: 90,
  },
  { emirate: "sharjah", community: "Al Nahda", category: "residential", bedrooms: 1, avgAnnualRentAed: 32_000 },
  { emirate: "sharjah", community: "Al Nahda", category: "residential", bedrooms: 2, avgAnnualRentAed: 45_000 },
  { emirate: "sharjah", community: "Al Majaz", category: "retail", bedrooms: null, avgAnnualRentPerSqftAed: 150 },
  { emirate: "ajman", community: "Al Nuaimiya", category: "residential", bedrooms: 1, avgAnnualRentAed: 24_000 },
  { emirate: "ajman", community: "Al Nuaimiya", category: "residential", bedrooms: 2, avgAnnualRentAed: 33_000 },
  {
    emirate: "ajman",
    community: "Ajman Downtown",
    category: "commercial",
    bedrooms: null,
    avgAnnualRentPerSqftAed: 50,
  },
  { emirate: "ras_al_khaimah", community: "Al Hamra", category: "residential", bedrooms: 1, avgAnnualRentAed: 55_000 },
  { emirate: "ras_al_khaimah", community: "Al Hamra", category: "residential", bedrooms: 2, avgAnnualRentAed: 75_000 },
  {
    emirate: "ras_al_khaimah",
    community: "Mina Al Arab",
    category: "retail",
    bedrooms: null,
    avgAnnualRentPerSqftAed: 130,
  },
  { emirate: "fujairah", community: "Sakamkam", category: "residential", bedrooms: 1, avgAnnualRentAed: 28_000 },
  { emirate: "fujairah", community: "Sakamkam", category: "residential", bedrooms: 2, avgAnnualRentAed: 40_000 },
  {
    emirate: "fujairah",
    community: "Fujairah City Centre",
    category: "commercial",
    bedrooms: null,
    avgAnnualRentPerSqftAed: 70,
  },
  { emirate: "umm_al_quwain", community: "Al Salamah", category: "residential", bedrooms: 1, avgAnnualRentAed: 21_000 },
  { emirate: "umm_al_quwain", community: "Al Salamah", category: "residential", bedrooms: 2, avgAnnualRentAed: 30_000 },
  {
    emirate: "umm_al_quwain",
    community: "Emirates Modern City",
    category: "commercial",
    bedrooms: null,
    avgAnnualRentPerSqftAed: 50,
  },
];

export interface DemoRentRule {
  /** Defaults to Dubai. */
  emirate?: Emirate;
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
  // Other emirates: residential -10%..+10% around the rent index, commercial and retail with AED bounds.
  ...(["abu_dhabi", "sharjah", "ajman", "ras_al_khaimah", "fujairah", "umm_al_quwain"] as const).flatMap(
    (emirate): DemoRentRule[] => [
      { emirate, company: "silverline", category: "residential", minPctBp: -1000, maxPctBp: 1000 },
      {
        emirate,
        company: "silverline",
        category: "commercial",
        minPctBp: -1000,
        maxPctBp: 1000,
        minRentAed: 30_000,
        maxRentAed: 200_000,
      },
      {
        emirate,
        company: "silverline",
        category: "retail",
        minPctBp: -1000,
        maxPctBp: 1000,
        minRentAed: 30_000,
        maxRentAed: 200_000,
      },
    ],
  ),
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
];

/**
 * [property number, unit number, Makani (or demo address) number, company slug, permitted use] for a unit the seed
 * creates. The use defaults to residential.
 */
export type DemoProperty = [
  dld: string,
  unitNo: string,
  makaniNo: string,
  companySlug: string,
  usage?: "residential" | "commercial",
];

export const demoDldNo = (unitNo: string) => `DEMO-DLD-00${unitNo.padStart(4, "0")}`;

/** MRN-1502 is seeded in PREP with this Makani number (the registry needs one to match). */
export const DEMO_MRN_1502_MAKANI = "1111155555";

/** Every unit the demo seed creates: the let and in-progress units (including MRN-1502), then the listed ones. */
export const DEMO_PROPERTIES: DemoProperty[] = [
  ["DEMO-DLD-001204", "1204", "1111122222", "silverline"],
  ["DEMO-DLD-000807", "807", "1111133333", "silverline"],
  ["DEMO-DLD-000310", "310", "2222211111", "silverline"],
  ["DEMO-DLD-001608", "1608", "1111144444", "silverline"],
  ["DEMO-DLD-000412", "412", "2222233333", "silverline"],
  ["DEMO-DLD-002205", "2205", "3333311111", "silverline"],
  [demoDldNo("1502"), "1502", DEMO_MRN_1502_MAKANI, "silverline"],
  ...DEMO_LISTED_UNITS.map((u): DemoProperty => [
    demoDldNo(u.unitNo),
    u.unitNo,
    u.makaniNo,
    u.company,
    propertyUsageFor(u.category),
  ]),
  ...DEMO_EMIRATE_UNITS.map((u): DemoProperty => [
    demoPropertyNo(u.emirate ?? "dubai", u.unitNo),
    u.unitNo,
    u.makaniNo,
    u.company,
    propertyUsageFor(u.category),
  ]),
];
