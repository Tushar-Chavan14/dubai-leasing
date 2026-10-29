import { z } from "zod";
import { PropertyCategory, SUBTYPES_BY_CATEGORY, PropertySubtype } from "@leasing/core";
import { UnitFields } from "../manager/units.ts";
import { aed, opt, yesNo } from "./lease-row.ts";

/** Optional whole number; empty → null. Ranges are checked by `UnitFields`. */
const optInt = opt.pipe(
  z
    .string()
    .trim()
    .regex(/^-?\d+$/, "expected a whole number")
    .transform(Number)
    .nullable(),
);

const rowCategory = (r: { category: PropertyCategory | null; kind: PropertyCategory | null }): PropertyCategory =>
  r.category ?? r.kind ?? "residential";

/** One row of the units import CSV. Column names are documented in docs/import.md. */
export const UnitImportRow = z
  .object({
    unit_code: z.string().trim().min(1),
    building: z.string().trim().min(1),
    community: z.string().trim().min(1),
    unit_no: opt,
    category: opt.transform((v) => v?.toLowerCase() ?? null).pipe(PropertyCategory.nullable()),
    /** Alias of `category` from the old template. */
    kind: opt.transform((v) => v?.toLowerCase() ?? null).pipe(PropertyCategory.nullable()),
    subtype: opt.transform((v) => v?.toLowerCase() ?? null).pipe(PropertySubtype.nullable()),
    emirate: opt
      .transform((v) => v?.toLowerCase() ?? null)
      .refine((v) => v === null || v === "dubai", "only Dubai units can be imported for now"),
    dld_property_no: opt,
    makani_no: opt,
    plot_no: opt,
    dewa_premise_no: opt,
    bedrooms: optInt,
    bathrooms: optInt,
    area_sqft: optInt,
    floor: optInt,
    parking_spaces: optInt,
    furnished: opt.pipe(yesNo.nullable()),
    asking_rent_aed: opt.pipe(aed.nullable()),
    description: opt,
    virtual_tour_url: opt,
    /** The company that owns (and is the landlord of) the unit: its name or slug (D44). */
    company: opt,
  })
  .superRefine((r, c) => {
    if (r.category && r.kind && r.category !== r.kind)
      c.addIssue({ code: "custom", path: ["kind"], message: "kind and category differ; use category only" });
    const category = rowCategory(r);
    if (r.subtype && !SUBTYPES_BY_CATEGORY[category].includes(r.subtype))
      c.addIssue({ code: "custom", path: ["subtype"], message: `subtype ${r.subtype} isn't a ${category} type` });
  });
export type UnitImportRow = z.infer<typeof UnitImportRow>;

/** Maps a parsed CSV row to the staff unit form fields (validated next by `UnitFields`). */
export function toUnitFields(r: UnitImportRow, companyId: string): z.input<typeof UnitFields> {
  return {
    companyId,
    subtype: r.subtype,
    emirate: "dubai",
    code: r.unit_code,
    building: r.building,
    community: r.community,
    category: rowCategory(r),
    unitNo: r.unit_no,
    floor: r.floor,
    dldPropertyNo: r.dld_property_no,
    makaniNo: r.makani_no,
    plotNo: r.plot_no,
    dewaPremiseNo: r.dewa_premise_no,
    areaSqft: r.area_sqft,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    parkingSpaces: r.parking_spaces,
    furnished: r.furnished,
    askingRentFils: r.asking_rent_aed,
    description: r.description,
    virtualTourUrl: r.virtual_tour_url,
  };
}

/** `UnitFields` key → CSV column, where the names don't follow camelCase → snake_case. */
const COLUMN: Record<string, string> = { code: "unit_code", askingRentFils: "asking_rent_aed", category: "category" };
const column = (key: PropertyKey) =>
  COLUMN[String(key)] ?? String(key).replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);

export type ParsedUnitRow = { ok: true; fields: UnitFields } | { ok: false; reasons: string[] };

export interface CompanyRef {
  id: string;
  name: string;
  slug: string;
  active: boolean;
}

/** Finds a company by name or slug, ignoring case and surrounding space. */
export function findCompany(companies: CompanyRef[], ref: string): CompanyRef | null {
  const k = ref.trim().toLowerCase();
  return companies.find((c) => c.slug === k || c.name.trim().toLowerCase() === k) ?? null;
}

/**
 * Parses one CSV record: column formats first, then the same `UnitFields` rules the unit form
 * uses (code format, Makani digits, ranges). Problems are reported by CSV column name.
 */
export function parseUnitRow(
  record: Record<string, string>,
  /** Default company (the `?company=` of the upload) for rows with no `company` column value. */
  defaultCompanyId: string | null,
  companies: CompanyRef[] = [],
): ParsedUnitRow {
  const row = UnitImportRow.safeParse(record);
  if (!row.success) return { ok: false, reasons: row.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
  let companyId = defaultCompanyId;
  if (row.data.company) {
    const found = findCompany(companies, row.data.company);
    if (!found || !found.active)
      return { ok: false, reasons: [`company: unknown or inactive company "${row.data.company}"`] };
    companyId = found.id;
  }
  if (!companyId) return { ok: false, reasons: ["company: required (name or slug of the owning company)"] };
  const fields = UnitFields.safeParse(toUnitFields(row.data, companyId));
  if (!fields.success)
    return {
      ok: false,
      reasons: fields.error.issues.map((x) => `${x.path.map(column).join(".")}: ${x.message}`),
    };
  return { ok: true, fields: fields.data };
}
