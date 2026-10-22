import { z } from "zod";
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

/** One row of the units import CSV. Column names are documented in docs/import.md. */
export const UnitImportRow = z
  .object({
    unit_code: z.string().trim().min(1),
    building: z.string().trim().min(1),
    community: z.string().trim().min(1),
    unit_no: opt,
    kind: opt.transform((v) => v?.toLowerCase() ?? "residential").pipe(z.enum(["residential", "commercial"])),
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
    landlord_name: opt,
    landlord_email: opt.pipe(z.email().nullable()),
  })
  .superRefine((r, c) => {
    if (r.landlord_email && !r.landlord_name)
      c.addIssue({ code: "custom", path: ["landlord_email"], message: "needs landlord_name" });
  });
export type UnitImportRow = z.infer<typeof UnitImportRow>;

/** Maps a parsed CSV row to the staff unit form fields (validated next by `UnitFields`). */
export function toUnitFields(r: UnitImportRow): z.input<typeof UnitFields> {
  return {
    code: r.unit_code,
    building: r.building,
    community: r.community,
    kind: r.kind,
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
const COLUMN: Record<string, string> = { code: "unit_code", askingRentFils: "asking_rent_aed" };
const column = (key: PropertyKey) =>
  COLUMN[String(key)] ?? String(key).replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);

export type ParsedUnitRow =
  | { ok: true; fields: UnitFields; landlord: { name: string; email: string | null } | null }
  | { ok: false; reasons: string[] };

/**
 * Parses one CSV record: column formats first, then the same `UnitFields` rules the unit form
 * uses (code format, Makani digits, ranges). Problems are reported by CSV column name.
 */
export function parseUnitRow(record: Record<string, string>): ParsedUnitRow {
  const row = UnitImportRow.safeParse(record);
  if (!row.success) return { ok: false, reasons: row.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`) };
  const fields = UnitFields.safeParse(toUnitFields(row.data));
  if (!fields.success)
    return {
      ok: false,
      reasons: fields.error.issues.map((x) => `${x.path.map(column).join(".")}: ${x.message}`),
    };
  const { landlord_name: name, landlord_email: email } = row.data;
  return { ok: true, fields: fields.data, landlord: name ? { name, email } : null };
}
