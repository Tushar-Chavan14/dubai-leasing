import { type Actor, addDays, type LeaseState, maskPiiText, newId, type UnitState } from "@leasing/core";
import { companies, leaseParties, leases, parties, type Tx, units, withTx } from "@leasing/db";
import { getRulebook, rulesVersionForTerm } from "@leasing/rulebook";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { scheduleTermPayments } from "./collections.ts";
import { ensureMoveInInspection } from "./move-in.ts";
import { parseCsv } from "../import/csv.ts";
import { importedLeaseState, LeaseImportRow } from "../import/lease-row.ts";
import { parseUnitRow } from "../import/unit-row.ts";
import { DomainError } from "../errors.ts";
import { companyLandlord } from "./company-legal.ts";
import { appendEvent } from "./events.ts";
import { createSameRentFallbackTask, scheduleLeaseMilestones } from "./milestones.ts";
import { createUnitInTx } from "./units.ts";

export interface ImportRowResult {
  row: number;
  status: "imported" | "skipped" | "error";
  ref?: string;
  leaseId?: string;
  state?: LeaseState;
  reasons: string[];
}

export interface UnitImportRowResult {
  row: number;
  status: "imported" | "skipped" | "error";
  /** Unit code. */
  ref?: string;
  unitId?: string;
  state?: UnitState;
  reasons: string[];
}

const LIVE: LeaseState[] = ["CONTRACT", "REGISTRATION", "MOVE_IN", "ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE"];

/**
 * Imports existing leases from CSV. Each row runs in its own transaction, so one bad row
 * doesn't block the rest. Re-importing the same file skips rows already imported
 * (same unit + start date). Lease state comes from the dates (see `importedLeaseState`).
 */
export async function importLeasesCsv(
  ctx: EngineContext,
  csv: string,
  actor: Actor,
  companyId: string,
): Promise<ImportRowResult[]> {
  let records: Record<string, string>[];
  try {
    records = parseCsv(csv);
  } catch (e) {
    return [{ row: 0, status: "error", reasons: [(e as Error).message] }];
  }
  const results: ImportRowResult[] = [];
  for (const [i, record] of records.entries()) {
    const row = i + 2; // header is row 1
    const parsed = LeaseImportRow.safeParse(record);
    if (!parsed.success) {
      results.push({
        row,
        status: "error",
        reasons: parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`),
      });
      continue;
    }
    try {
      results.push({
        row,
        ...(await withTx(ctx.database, (tx) => importRow(ctx, tx, parsed.data, actor, row, companyId))),
      });
    } catch (e) {
      results.push({ row, status: "error", reasons: [safeMessage(e)] });
    }
  }
  return results;
}

const OTHER_COMPANY = "unit belongs to another company";
const UNIT_EXISTS = "unit already exists — edit it in Units";

/**
 * Imports units from CSV. Each row runs in its own transaction. Units are created through the
 * same path as the unit form (`createUnitInTx`): `UnitFields` validation, PREP state and a
 * UNIT_CREATED event with `source: "import"`. Existing codes are skipped, never overwritten.
 * Each row names its company (name or slug); the company is the landlord (D44). Unknown company: row error.
 */
export async function importUnitsCsv(
  ctx: EngineContext,
  csv: string,
  actor: Actor,
  /** Default company for rows without a `company` value (the upload's `?company=`). */
  defaultCompanyId: string | null,
): Promise<UnitImportRowResult[]> {
  let records: Record<string, string>[];
  try {
    records = parseCsv(csv);
  } catch (e) {
    return [{ row: 0, status: "error", reasons: [(e as Error).message] }];
  }
  const results: UnitImportRowResult[] = [];
  const known = await ctx.database.db
    .select({ id: companies.id, name: companies.name, slug: companies.slug, active: companies.active })
    .from(companies);
  for (const [i, record] of records.entries()) {
    const row = i + 2; // header is row 1
    const parsed = parseUnitRow(record, defaultCompanyId, known);
    if (!parsed.ok) {
      results.push({
        row,
        status: "error",
        ...(record.unit_code ? { ref: record.unit_code } : {}),
        reasons: parsed.reasons,
      });
      continue;
    }
    const { fields } = parsed;
    const companyId = fields.companyId;
    try {
      const result = await withTx(ctx.database, async (tx): Promise<Omit<UnitImportRowResult, "row">> => {
        const [existing] = await tx.db
          .select({ id: units.id, companyId: units.companyId })
          .from(units)
          .where(eq(units.code, fields.code));
        if (existing && existing.companyId !== companyId)
          return { status: "error", ref: fields.code, reasons: [OTHER_COMPANY] };
        if (existing) return { status: "skipped", ref: fields.code, unitId: existing.id, reasons: [UNIT_EXISTS] };
        const unit = await createUnitInTx(ctx, tx, fields, actor, { source: "import" });
        return { status: "imported", ref: unit.code, unitId: unit.id, state: unit.state, reasons: [] };
      });
      results.push({ row, ...result });
    } catch (e) {
      // Another import or the unit form took the code between our check and the insert.
      const duplicate =
        (e instanceof DomainError && e.code === "duplicate_code") ||
        [(e as { code?: string }).code, (e as { cause?: { code?: string } }).cause?.code].includes("23505");
      results.push(
        duplicate
          ? { row, status: "skipped", ref: fields.code, reasons: [UNIT_EXISTS] }
          : { row, status: "error", ref: fields.code, reasons: [safeMessage(e)] },
      );
    }
  }
  return results;
}

/**
 * Database errors from Drizzle include the query parameters (tenant names, IDs, phones). Report
 * the underlying Postgres message (e.g. the violated constraint) instead, PII-masked.
 */
function safeMessage(e: unknown): string {
  const err = e as { cause?: { message?: string }; message?: string };
  return maskPiiText(err.cause?.message ?? err.message ?? "import failed");
}

async function importRow(
  ctx: EngineContext,
  tx: Tx,
  r: LeaseImportRow,
  actor: Actor,
  rowNo: number,
  companyId: string,
): Promise<Omit<ImportRowResult, "row">> {
  const today = ctx.clock.today();
  // The version in force when this term started (D23), not the import day.
  const rulesVersion = rulesVersionForTerm(r.start_on);
  const decided = importedLeaseState(r, today, rulesVersion);
  if (!decided.ok) return { status: "error", reasons: [decided.reason] };
  const leaseState = decided.state;
  // A contracted future lease takes the unit off the market (READY, not LISTED); it becomes
  // OCCUPIED when the lease turns ACTIVE.
  const unitState: UnitState = leaseState === "ACTIVE" || leaseState === "RENEWAL" ? "OCCUPIED" : "READY";

  // The company is the landlord (D44); `landlord_name` / `landlord_email` columns in old files are ignored.
  const { party: landlordParty } = await companyLandlord(tx, companyId);
  const landlordId = landlordParty.id;
  const tenantId = await findOrCreateParty(tx, {
    fullNameEn: r.tenant_name,
    email: r.tenant_email,
    phone: r.tenant_phone,
    emiratesIdNo: r.tenant_emirates_id,
    nationality: r.tenant_nationality,
  });

  let [unit] = await tx.db.select().from(units).where(eq(units.code, r.unit_code)).for("update");
  if (unit) {
    if (unit.companyId !== companyId) return { status: "error", reasons: [OTHER_COMPANY] };
    const [dup] = await tx.db
      .select({ ref: leases.ref })
      .from(leases)
      .where(and(eq(leases.unitId, unit.id), eq(leases.startOn, r.start_on)));
    if (dup) return { status: "skipped", ref: dup.ref, reasons: ["already imported (same unit and start date)"] };
    if (unit.ownUseLockUntil && r.start_on < unit.ownUseLockUntil) {
      return {
        status: "error",
        reasons: [`unit ${r.unit_code} is under an own-use lock until ${unit.ownUseLockUntil}`],
      };
    }
    const live = await tx.db
      .select({ ref: leases.ref, endOn: leases.endOn })
      .from(leases)
      .where(and(eq(leases.unitId, unit.id), inArray(leases.state, LIVE), ne(leases.startOn, r.start_on)));
    const overlapping = live.filter((l) => l.endOn >= r.start_on);
    if (overlapping.length)
      return {
        status: "error",
        reasons: [`unit ${r.unit_code} already has a live lease ${overlapping.map((l) => l.ref).join(", ")}`],
      };
    // A unit with another (earlier) live lease keeps its state; that lease drives it.
    const nextUnitState = live.length ? unit.state : unitState;
    // Fill missing unit details from the file; never overwrite what staff entered.
    await tx.db
      .update(units)
      .set({
        dldPropertyNo: unit.dldPropertyNo ?? r.dld_property_no,
        makaniNo: unit.makaniNo ?? r.makani_no,
        dewaPremiseNo: unit.dewaPremiseNo ?? r.dewa_premise_no,
        unitNo: unit.unitNo ?? r.unit_no,
        bedrooms: unit.bedrooms ?? r.bedrooms,
        areaSqft: unit.areaSqft ?? r.area_sqft ?? null,
        furnished: unit.furnished ?? r.furnished,
        state: nextUnitState,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(units.id, unit.id));
    if (unit.state !== nextUnitState) {
      await appendEvent(tx, ctx, {
        entity: { kind: "unit", id: unit.id },
        type: "IMPORTED",
        actor,
        fromState: unit.state,
        toState: nextUnitState,
        payload: { row: rowNo },
      });
    }
  } else {
    [unit] = await tx.db
      .insert(units)
      .values({
        id: newId(),
        code: r.unit_code,
        building: r.building,
        community: r.community,
        companyId,
        unitNo: r.unit_no,
        dldPropertyNo: r.dld_property_no,
        makaniNo: r.makani_no,
        dewaPremiseNo: r.dewa_premise_no,
        bedrooms: r.bedrooms,
        areaSqft: r.area_sqft ?? null,
        furnished: r.furnished,
        state: unitState,
      })
      .returning();
    if (!unit) throw new Error("unit insert failed");
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id: unit.id },
      type: "IMPORTED",
      actor,
      toState: unitState,
      payload: { row: rowNo },
    });
  }

  const leaseId = newId();
  const ref = `${r.unit_code}/${r.start_on.slice(0, 7)}`;
  const [lease] = await tx.db
    .insert(leases)
    .values({
      id: leaseId,
      ref,
      unitId: unit.id,
      state: leaseState,
      startOn: r.start_on,
      endOn: r.end_on,
      annualRentFils: r.annual_rent_aed,
      cheques: r.cheques,
      depositFils: r.deposit_aed,
      rulesVersion,
      ejariNo: r.ejari_no,
      source: "import",
    })
    .returning();
  if (!lease) throw new Error("lease insert failed");
  await tx.db.insert(leaseParties).values([
    { leaseId, partyId: tenantId, role: "tenant" },
    { leaseId, partyId: landlordId, role: "landlord" },
  ]);
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: leaseId },
    type: "IMPORTED",
    actor,
    toState: leaseState,
    payload: {
      row: rowNo,
      unitCode: r.unit_code,
      startOn: r.start_on,
      endOn: r.end_on,
      annualRentFils: r.annual_rent_aed,
    },
    rulesVersion,
  });

  const reasons: string[] = [];
  if (leaseState === "MOVE_IN") await ensureMoveInInspection(ctx, tx, lease.id);
  if (leaseState === "ACTIVE" || leaseState === "RENEWAL") {
    await scheduleLeaseMilestones(ctx, tx, lease);
    // Running leases: instalments already due are assumed paid (flagged); later ones are chased.
    await scheduleTermPayments(ctx, tx, lease, { assumePastPaid: true, actor });
    const r2 = getRulebook(rulesVersion);
    if (today > addDays(r.end_on, -r2.renewalNoticeDays)) {
      reasons.push(
        `the ${r2.renewalNoticeDays}-day notice deadline has passed: no rent increase is possible for this renewal`,
      );
      await createSameRentFallbackTask(ctx, tx, lease);
    }
  }
  return { status: "imported", ref, leaseId, state: leaseState, reasons };
}

interface PartyInput {
  fullNameEn: string;
  email: string | null;
  phone?: string | null;
  emiratesIdNo?: string | null;
  nationality?: string | null;
}

export async function findOrCreateParty(tx: Tx, p: PartyInput): Promise<string> {
  const match = p.emiratesIdNo
    ? eq(parties.emiratesIdNo, p.emiratesIdNo)
    : p.email
      ? and(eq(parties.email, p.email), eq(parties.fullNameEn, p.fullNameEn))
      : eq(parties.fullNameEn, p.fullNameEn);
  const [existing] = await tx.db.select({ id: parties.id }).from(parties).where(match).limit(1);
  if (existing) return existing.id;
  const id = newId();
  await tx.db.insert(parties).values({
    id,
    kind: "individual",
    fullNameEn: p.fullNameEn,
    email: p.email,
    phone: p.phone ?? null,
    emiratesIdNo: p.emiratesIdNo ?? null,
    nationality: p.nationality ?? null,
  });
  return id;
}
