import { formatDubaiDateTime } from "@leasing/adapters";
import { formatAed, maskPii } from "@leasing/core";
import {
  applications,
  companies,
  companyContractTemplates,
  contracts,
  contractSigners,
  ejariSubmissions,
  leases,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import { getCompanyPolicy } from "./events.ts";
import { findRentRule, findSri, matchContractRule, priceRangeFor } from "./pricing.ts";
import { exposeRange } from "./units.ts";
import { freeViewingSlots } from "./viewing-slots.ts";
import { takenViewings } from "./availability.ts";

/** Read models behind the staff copilot's pipeline tools. Nothing here writes or decides anything. */

/** Active companies with how many units each has listed (state LISTED with an asking rent, every category). */
export async function listCompanies(ctx: EngineContext) {
  const db = ctx.database.db;
  const [active, counts] = await Promise.all([
    db
      .select({ id: companies.id, name: companies.name, kind: companies.kind })
      .from(companies)
      .where(eq(companies.active, true))
      .orderBy(asc(companies.name)),
    db
      .select({ companyId: units.companyId, n: sql<number>`count(*)::int` })
      .from(units)
      .where(and(eq(units.state, "LISTED"), isNotNull(units.askingRentFils)))
      .groupBy(units.companyId),
  ]);
  const count = new Map(counts.map((r) => [r.companyId, r.n]));
  return active.map((c) => ({ id: c.id, name: c.name, kind: c.kind, listedUnits: count.get(c.id) ?? 0 }));
}

/** The lease a reference points at: a lease reference, an application reference or a unit code. */
async function leaseFor(tx: Tx, ref: string) {
  const r = ref.trim().toLowerCase();
  const byRef = await tx.db
    .select({ l: leases, unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(sql`lower(${leases.ref}) = ${r}`);
  if (byRef[0]) return { kind: "lease" as const, ...byRef[0] };
  const [app] = await tx.db
    .select({ id: applications.id, ref: applications.ref, state: applications.state, unit: units })
    .from(applications)
    .innerJoin(units, eq(units.id, applications.unitId))
    .where(sql`lower(${applications.ref}) = ${r}`);
  if (app) {
    const [l] = await tx.db.select().from(leases).where(eq(leases.applicationId, app.id));
    return l ? { kind: "lease" as const, l, unit: app.unit } : { kind: "application" as const, app };
  }
  const byUnit = await tx.db
    .select({ l: leases, unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(sql`lower(${units.code}) = ${r}`)
    .orderBy(desc(leases.createdAt));
  if (byUnit[0]) return { kind: "lease" as const, ...byUnit[0] };
  return null;
}

/**
 * Contract and Ejari status of one record: contract version and status, who signed, the company
 * template and clauses it uses, and the Ejari submission. Names only; no ID numbers.
 */
export async function contractStatus(ctx: EngineContext, ref: string) {
  return withTx(ctx.database, async (tx) => {
    const found = await leaseFor(tx, ref);
    if (!found) throw notFound("record");
    if (found.kind === "application")
      return {
        ref: found.app.ref ?? ref,
        unitCode: found.app.unit.code,
        leaseRef: null as string | null,
        leaseState: null as string | null,
        contract: null,
        template: null,
        companyClauses: [] as string[],
        standardClauses: [] as string[],
        signers: [] as { role: string; name: string; signed: boolean; signedAt: string | null }[],
        ejari: null,
        note: `No lease or contract yet: the application is in ${found.app.state}.`,
      };
    const { l, unit } = found;
    const [c] = await tx.db
      .select()
      .from(contracts)
      .where(eq(contracts.leaseId, l.id))
      .orderBy(desc(contracts.version))
      .limit(1);
    const signers = c
      ? await tx.db
          .select()
          .from(contractSigners)
          .where(eq(contractSigners.contractId, c.id))
          .orderBy(asc(contractSigners.role))
      : [];
    const [sub] = await tx.db
      .select()
      .from(ejariSubmissions)
      .where(eq(ejariSubmissions.leaseId, l.id))
      .orderBy(desc(ejariSubmissions.createdAt))
      .limit(1);
    const rule = await matchContractRule(tx, unit);
    let template: { version: number; status: string } | null = null;
    if (rule?.templateId) {
      const [t] = await tx.db
        .select({ version: companyContractTemplates.version, status: companyContractTemplates.status })
        .from(companyContractTemplates)
        .where(
          and(eq(companyContractTemplates.id, rule.templateId), eq(companyContractTemplates.companyId, unit.companyId)),
        );
      template = t ?? null;
    }
    const addendum = c?.addendum;
    return maskPii({
      ref: l.ref,
      unitCode: unit.code,
      leaseRef: l.ref,
      leaseState: l.state,
      contract: c
        ? {
            version: c.version,
            status: c.status,
            sentAt: c.sentAt?.toISOString() ?? null,
            signedAt: c.signedAt?.toISOString() ?? null,
          }
        : null,
      template,
      companyClauses: (addendum?.companyClauses ?? []).map((k) => k.title),
      standardClauses: (addendum?.clauses ?? []).filter((k) => !String(k).startsWith("cc:")).map(String),
      signers: signers.map((s) => ({
        role: s.role,
        name: s.nameEn,
        signed: s.signedAt !== null,
        signedAt: s.signedAt?.toISOString() ?? null,
      })),
      ejari: sub
        ? { status: sub.status, attempt: sub.attempt, ejariNo: sub.ejariNo, submittedAt: sub.createdAt.toISOString() }
        : null,
      note: c ? null : "No contract has been prepared yet.",
    });
  });
}

const dubaiIso = (at: Date) => `${new Date(at.getTime() + 4 * 3_600_000).toISOString().slice(0, 19)}+04:00`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A unit by id or exact code (any case). */
async function unitByRef(tx: Tx, ref: string) {
  const rows = await tx.db
    .select()
    .from(units)
    .where(UUID.test(ref) ? eq(units.id, ref) : sql`lower(${units.code}) = lower(${ref})`)
    .limit(2);
  if (rows.length !== 1) throw notFound("unit");
  return rows[0]!;
}

/**
 * One unit with its price limits, all computed by the engine from the SRI table and the company's
 * rent rule (the same code as the unit form's price range). The copilot quotes them; it never works them out.
 */
export async function unitWithPricing(ctx: EngineContext, ref: string) {
  const today = ctx.clock.today();
  return withTx(ctx.database, async (tx) => {
    const u = await unitByRef(tx, ref);
    const [company] = await tx.db.select({ name: companies.name }).from(companies).where(eq(companies.id, u.companyId));
    const { range, sriLabel } = await priceRangeFor(tx, u, today);
    const sri = await findSri(tx, u, today);
    const rule = await findRentRule(tx, u);
    const exposed = exposeRange(range);
    const money = (f: number | null) => (f === null ? null : { fils: f, text: formatAed(f) });
    return {
      unitId: u.id,
      code: u.code,
      building: u.building,
      community: u.community,
      company: company?.name ?? null,
      category: u.category,
      subtype: u.subtype,
      state: u.state,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      areaSqft: u.areaSqft,
      furnished: u.furnished,
      askingRent: money(u.askingRentFils),
      priceApproved: u.priceApprovedAt !== null,
      pricing: {
        sriLabel,
        sriAverage: money(sri?.avgAnnualRentFils ?? null),
        allowedMin: money(exposed?.min ?? null),
        allowedMax: money(exposed?.max ?? null),
        ruleId: rule?.id ?? null,
        hasRule: rule !== null,
        withinRange:
          u.askingRentFils === null || !range ? null : u.askingRentFils >= range.min && u.askingRentFils <= range.max,
      },
    };
  });
}

/** Free viewing slots of a unit (by id or code) or of an application's unit, as the public chat offers them. */
export async function viewingSlotsFor(
  ctx: EngineContext,
  q: { unit?: string | undefined; applicationId?: string | undefined },
) {
  return withTx(ctx.database, async (tx) => {
    let unitId: string;
    let forApp: { ref: string | null; state: string; viewingAt: string | null } | null = null;
    if (q.applicationId) {
      const [a] = await tx.db.select().from(applications).where(eq(applications.id, q.applicationId));
      if (!a) throw notFound("application");
      unitId = a.unitId;
      forApp = { ref: a.ref, state: a.state, viewingAt: a.viewingAt ? dubaiIso(a.viewingAt) : null };
    } else {
      unitId = (await unitByRef(tx, q.unit ?? "")).id;
    }
    const [u] = await tx.db.select().from(units).where(eq(units.id, unitId));
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    const slots = freeViewingSlots(ctx.clock.now(), policy, await takenViewings(tx, unitId), 8);
    return {
      unitId,
      unitCode: u!.code,
      application: forApp,
      slotMinutes: policy.viewingSlotMinutes,
      slots: slots.map((at) => ({ at: dubaiIso(at), label: formatDubaiDateTime(at) })),
    };
  });
}
