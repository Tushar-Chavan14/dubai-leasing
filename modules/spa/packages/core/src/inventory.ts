import { z } from "zod";

/** S75: the details of a unit, a project and a listing, and what a marketing photo can belong to. */
export const UNIT_TYPES = ["apartment", "villa", "townhouse", "penthouse", "office", "retail"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export const FURNISHED = ["unfurnished", "semi", "furnished"] as const;
export type Furnished = (typeof FURNISHED)[number];
/** The words a screen prints for each code; the public site and the staff screens share them. */
export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
  office: "Office",
  retail: "Retail",
};
export const FURNISHED_LABELS: Record<Furnished, string> = {
  unfurnished: "Unfurnished",
  semi: "Semi-furnished",
  furnished: "Furnished",
};
export const MEDIA_OWNER_KINDS = ["project", "unit", "listing"] as const;
export type MediaOwnerKind = (typeof MEDIA_OWNER_KINDS)[number];

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const whole = (lo: number, hi: number) => `Enter a whole number from ${lo} to ${hi}`;
const int = (lo: number, hi: number) =>
  z.preprocess(
    blank,
    z
      .number({ error: whole(lo, hi) })
      .int(whole(lo, hi))
      .min(lo, whole(lo, hi))
      .max(hi, whole(lo, hi))
      .nullish(),
  );
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max, `at most ${max} characters`).nullish());

/** The descriptive fields of a unit. All optional and nullable: a missing one is left as it is, a null clears it. */
export const UnitDetails = z.object({
  type: z.enum(UNIT_TYPES).nullish(),
  bedrooms: int(0, 10),
  bathrooms: int(0, 10),
  internalSqft: z.preprocess(
    blank,
    z
      .number({ error: "Enter the area in sq ft" })
      .int("Enter the area in whole sq ft")
      .positive("Enter the area in sq ft")
      .max(1_000_000, "That area is too large")
      .nullish(),
  ),
  balconySqft: z.preprocess(
    blank,
    z
      .number({ error: "Enter the area in sq ft" })
      .int("Enter the area in whole sq ft")
      .min(0, "The area can't be negative")
      .max(1_000_000, "That area is too large")
      .nullish(),
  ),
  floor: int(-5, 200),
  view: text(60),
  parkingSpaces: int(0, 10),
  description: text(2000),
});
export type UnitDetails = z.infer<typeof UnitDetails>;

export const ProjectDetails = z.object({
  community: text(80),
  location: text(120),
  description: text(2000),
});
export type ProjectDetails = z.infer<typeof ProjectDetails>;
