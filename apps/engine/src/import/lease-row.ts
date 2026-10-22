import {
  type CalendarDate,
  isCalendarDate,
  isValidEmiratesId,
  type LeaseState,
  normaliseEmiratesId,
  parseAed,
} from "@leasing/core";
import { getRulebook, renewalMilestones } from "@leasing/rulebook";
import { z } from "zod";

export const opt = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : v));
const date = z
  .string()
  .refine(isCalendarDate, "expected YYYY-MM-DD")
  .transform((v) => v as CalendarDate);
export const aed = z.string().transform((v, c) => {
  try {
    return parseAed(v);
  } catch {
    c.addIssue({ code: "custom", message: "invalid AED amount" });
    return z.NEVER;
  }
});
export const yesNo = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(["yes", "no", "true", "false", "y", "n", "1", "0"]))
  .transform((v) => ["yes", "true", "y", "1"].includes(v));

/** One row of the lease import CSV. Column names are documented in docs/import.md. */
export const LeaseImportRow = z
  .object({
    unit_code: z.string().min(1),
    building: z.string().min(1),
    community: z.string().min(1),
    unit_no: z.string().min(1),
    dld_property_no: opt,
    makani_no: opt,
    dewa_premise_no: opt,
    bedrooms: z.coerce.number().int().min(0).max(10),
    area_sqft: z.coerce.number().int().positive().optional(),
    furnished: yesNo,
    landlord_name: z.string().min(1),
    landlord_email: opt.pipe(z.email().nullable()),
    tenant_name: z.string().min(1),
    tenant_email: opt.pipe(z.email().nullable()),
    tenant_phone: opt,
    tenant_emirates_id: opt,
    tenant_nationality: opt,
    start_on: date,
    end_on: date,
    annual_rent_aed: aed,
    cheques: z.coerce.number().int().min(1).max(12),
    deposit_aed: aed,
    ejari_no: opt,
  })
  .superRefine((r, c) => {
    if (r.end_on <= r.start_on) c.addIssue({ code: "custom", path: ["end_on"], message: "must be after start_on" });
    if (r.annual_rent_aed <= 0) c.addIssue({ code: "custom", path: ["annual_rent_aed"], message: "must be positive" });
    if (r.deposit_aed < 0) c.addIssue({ code: "custom", path: ["deposit_aed"], message: "can't be negative" });
    if (r.tenant_emirates_id && !isValidEmiratesId(r.tenant_emirates_id)) {
      c.addIssue({
        code: "custom",
        path: ["tenant_emirates_id"],
        message: "not a valid Emirates ID (784-YYYY-NNNNNNN-C)",
      });
    }
  })
  .transform((r) => ({
    ...r,
    tenant_emirates_id: r.tenant_emirates_id ? normaliseEmiratesId(r.tenant_emirates_id) : null,
  }));
export type LeaseImportRow = z.infer<typeof LeaseImportRow>;

/**
 * The state an imported lease starts in, from its dates and Ejari number:
 * - ended → refused (history import not supported yet)
 * - not started → MOVE_IN with Ejari, REGISTRATION without
 * - running → needs Ejari; RENEWAL from the T−5 months milestone, else ACTIVE
 */
export function importedLeaseState(
  row: Pick<LeaseImportRow, "start_on" | "end_on" | "ejari_no">,
  today: CalendarDate,
  rulesVersion: string,
): { ok: true; state: LeaseState } | { ok: false; reason: string } {
  if (row.end_on < today)
    return { ok: false, reason: `lease ended on ${row.end_on}; only current or future leases can be imported` };
  if (today < row.start_on) return { ok: true, state: row.ejari_no ? "MOVE_IN" : "REGISTRATION" };
  if (!row.ejari_no)
    return { ok: false, reason: "running lease has no Ejari number; register it first or add ejari_no" };
  const assess = renewalMilestones(row.end_on, getRulebook(rulesVersion)).find((m) => m.id === "renewal_assess");
  return { ok: true, state: assess && today >= assess.dueOn ? "RENEWAL" : "ACTIVE" };
}
