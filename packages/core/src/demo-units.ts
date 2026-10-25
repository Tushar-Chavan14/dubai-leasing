/**
 * Demo units (all fictional) shared by the engine's demo seed and the simulated Ejari registry,
 * so every seeded unit is known to the registry (ruling P9). Rents are integer fils and sit inside
 * the default company asking-rent range, so these homes are bookable without approval.
 */
export interface DemoListedUnit {
  code: string;
  building: string;
  community: string;
  unitNo: string;
  makaniNo: string;
  bedrooms: number;
  furnished: boolean;
  areaSqft: number;
  askingRentFils: number;
  description: string;
}

/** Units the demo seed walks to LISTED, beyond JVC-0412. */
export const DEMO_LISTED_UNITS: DemoListedUnit[] = [
  {
    code: "DWN-2801",
    building: "Demo Boulevard Residences",
    community: "Downtown Dubai",
    unitNo: "2801",
    makaniNo: "4444411111",
    bedrooms: 2,
    furnished: true,
    areaSqft: 1320,
    askingRentFils: 18_500_000,
    description:
      "Furnished two-bedroom high up in the tower with a boulevard view. Two balconies, two covered parking spaces, pool and gym.",
  },
  {
    code: "DWN-1205",
    building: "Demo Boulevard Residences",
    community: "Downtown Dubai",
    unitNo: "1205",
    makaniNo: "4444422222",
    bedrooms: 1,
    furnished: true,
    areaSqft: 860,
    askingRentFils: 9_800_000,
    description:
      "Furnished one-bedroom a short walk from the mall. Floor-to-ceiling windows, walk-in wardrobe, one parking space.",
  },
  {
    code: "BBY-0903",
    building: "Demo Canal Heights",
    community: "Business Bay",
    unitNo: "903",
    makaniNo: "5555511111",
    bedrooms: 0,
    furnished: false,
    areaSqft: 480,
    askingRentFils: 5_200_000,
    description: "Bright studio with a canal glimpse. Compact kitchen, built-in storage, gym and pool in the building.",
  },
  {
    code: "BBY-1710",
    building: "Demo Canal Heights",
    community: "Business Bay",
    unitNo: "1710",
    makaniNo: "5555522222",
    bedrooms: 3,
    furnished: false,
    areaSqft: 2050,
    askingRentFils: 24_000_000,
    description: "Spacious three-bedroom with a canal-facing living room, maid's room and two parking spaces.",
  },
  {
    code: "MRN-0709",
    building: "Demo Marina Tower",
    community: "Dubai Marina",
    unitNo: "709",
    makaniNo: "1111166666",
    bedrooms: 0,
    furnished: true,
    areaSqft: 520,
    askingRentFils: 6_400_000,
    description: "Furnished studio near the marina walk. Sofa bed, full kitchen, balcony, one parking space.",
  },
  {
    code: "JVC-0221",
    building: "Demo Circle Residence",
    community: "Jumeirah Village Circle",
    unitNo: "221",
    makaniNo: "2222244444",
    bedrooms: 2,
    furnished: false,
    areaSqft: 1150,
    askingRentFils: 9_500_000,
    description:
      "Two-bedroom on a low floor next to the park, with a private terrace. New flooring, pool and gym in the building.",
  },
];

/** [DLD property number, unit number, Makani number] for a unit the seed creates. */
export type DemoProperty = [dld: string, unitNo: string, makaniNo: string];

export const demoDldNo = (unitNo: string) => `DEMO-DLD-00${unitNo.padStart(4, "0")}`;

/** MRN-1502 is seeded in PREP with this Makani number (the registry needs one to match). */
export const DEMO_MRN_1502_MAKANI = "1111155555";

/** Every unit the demo seed creates: the let and in-progress units (including MRN-1502), then the listed ones. */
export const DEMO_PROPERTIES: DemoProperty[] = [
  ["DEMO-DLD-001204", "1204", "1111122222"],
  ["DEMO-DLD-000807", "807", "1111133333"],
  ["DEMO-DLD-000310", "310", "2222211111"],
  ["DEMO-DLD-001608", "1608", "1111144444"],
  ["DEMO-DLD-000412", "412", "2222233333"],
  ["DEMO-DLD-002205", "2205", "3333311111"],
  [demoDldNo("1502"), "1502", DEMO_MRN_1502_MAKANI],
  ...DEMO_LISTED_UNITS.map((u): DemoProperty => [demoDldNo(u.unitNo), u.unitNo, u.makaniNo]),
];
