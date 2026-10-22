import { formatDubaiDateTime } from "@leasing/adapters";
import { type CalendarDate, formatAed, maskPii } from "@leasing/core";
import { helperRuns, leaseParties, leases, parties, units, withTx } from "@leasing/db";
import { RenewalContext, renewalHelper } from "@leasing/helpers";
import {
  activeRulesVersion,
  getRulebook,
  renewalMilestones,
  renewalNoticeDeadline,
  repossessionNoticeDeadline,
  rulebookVersions,
} from "@leasing/rulebook";
import { eq, ilike, or } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import { bookableUnitsWithSlots } from "../manager/availability.ts";
import { getCompanyPolicy } from "../manager/events.ts";
import { lookupSri } from "../manager/sri.ts";
import type { AuthEnv } from "./auth.ts";

/** An instant as Dubai wall time with its offset, e.g. "2026-11-03T10:00:00+04:00" (UTC+4, no DST). */
const dubaiIso = (at: Date) => `${new Date(at.getTime() + 4 * 3_600_000).toISOString().slice(0, 19)}+04:00`;

/**
 * Read-only routes the staff copilot uses (architecture §8b); any signed-in staff role may read.
 * Nothing here writes: the renewal cap runs the pure renewal helper without recording a run.
 */
export function registerReadRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  /**
   * Units that can be booked for a viewing now (listed, settled price, no lease being signed),
   * cheapest first, with their next free viewing slots (company policy hours, Asia/Dubai).
   */
  api.get("/available-units", async (c) => {
    const q = z
      .object({
        bedrooms: z.coerce.number().int().min(0).max(4).optional(),
        community: z.string().trim().min(2).max(120).optional(),
        maxRentFils: z.coerce.number().int().positive().optional(),
        code: z.string().trim().min(2).max(40).optional(),
      })
      .parse(c.req.query());
    const now = ctx.clock.now();
    const found = await withTx(ctx.database, async (tx) =>
      bookableUnitsWithSlots(tx, now, await getCompanyPolicy(tx, ctx.clock.today()), q, { units: 10, slotsPerUnit: 6 }),
    );
    return c.json(
      found.map(({ unit: u, slots }) => ({
        unitId: u.id,
        code: u.code,
        building: u.building,
        community: u.community,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        areaSqft: u.areaSqft,
        furnished: u.furnished,
        askingRentFils: u.askingRentFils,
        askingRent: formatAed(u.askingRentFils ?? 0),
        nextViewingSlots: slots.map((at) => ({ at: dubaiIso(at), label: formatDubaiDateTime(at) })),
      })),
    );
  });

  /** Units, leases and tenants by code, reference or name. Names only; no identifiers. */
  api.get("/search", async (c) => {
    const q = z.string().trim().min(2).max(80).parse(c.req.query("q"));
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const rows = await db
      .select({
        leaseId: leases.id,
        ref: leases.ref,
        state: leases.state,
        endOn: leases.endOn,
        unitId: units.id,
        unitCode: units.code,
        building: units.building,
        community: units.community,
        tenant: parties.fullNameEn,
        role: leaseParties.role,
      })
      .from(units)
      .leftJoin(leases, eq(leases.unitId, units.id))
      .leftJoin(leaseParties, eq(leaseParties.leaseId, leases.id))
      .leftJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(
        or(
          ilike(units.code, like),
          ilike(units.building, like),
          ilike(leases.ref, like),
          ilike(parties.fullNameEn, like),
        ),
      )
      .limit(40);
    const seen = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const key = r.leaseId ?? `unit:${r.unitId}`;
      const prev = seen.get(key);
      if (prev && r.role === "tenant") prev.tenant = r.tenant;
      if (prev) continue;
      seen.set(key, {
        unitId: r.unitId,
        unitCode: r.unitCode,
        building: r.building,
        community: r.community,
        leaseId: r.leaseId,
        leaseRef: r.ref,
        leaseState: r.state,
        leaseEndOn: r.endOn,
        tenant: r.role === "tenant" ? r.tenant : null,
      });
    }
    return c.json([...seen.values()].slice(0, 10));
  });

  /**
   * The legal renewal cap for a lease's current term, with its inputs and rules version. Same
   * numbers the renewal notice uses (same pure helper, same SRI lookup).
   */
  api.get("/leases/:id/renewal-cap", async (c) => {
    const result = await withTx(ctx.database, async (tx) => {
      const [row] = await tx.db
        .select({ lease: leases, unit: units })
        .from(leases)
        .innerJoin(units, eq(units.id, leases.unitId))
        .where(eq(leases.id, z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"))));
      if (!row) throw notFound("lease");
      const { lease, unit } = row;
      const r = getRulebook(lease.rulesVersion);
      const sri = await lookupSri(tx, lease, ctx.clock.today());
      const context = RenewalContext.parse({
        leaseRef: lease.ref,
        currentRentFils: lease.annualRentFils,
        leaseEndOn: lease.endOn,
        community: unit.community,
        bedrooms: unit.bedrooms,
        sri: sri ? { avgAnnualRentFils: sri.avgAnnualRentFils, source: sri.source, label: sri.label } : null,
      });
      const out = await renewalHelper.run({
        runId: "read-only",
        entity: { kind: "lease", id: lease.id },
        step: "RENEWAL",
        context,
        rulesVersion: lease.rulesVersion,
        now: ctx.clock.now().toISOString(),
      });
      if (out.status !== "ok" || !out.data) throw new Error("renewal cap could not be computed");
      const d = out.data;
      return {
        leaseId: lease.id,
        leaseRef: lease.ref,
        unitCode: unit.code,
        rulesVersion: r.version,
        leaseEndOn: lease.endOn,
        currentRentFils: lease.annualRentFils,
        currentRent: formatAed(lease.annualRentFils),
        sriAverageFils: d.sriAverageFils,
        sriAverage: d.sriAverageFils ? formatAed(d.sriAverageFils) : null,
        sriSource: d.sriSource,
        sriLabel: d.sriLabel,
        // Two decimals (rounded down), so a gap of 10.01% visibly falls in the "over 10%" band.
        gapBelowSriPercent: d.gapBasisPoints === null ? null : d.gapBasisPoints / 100,
        maxIncreasePercent: d.maxIncreasePercent,
        maxRentFils: d.maxRentFils,
        maxRent: formatAed(d.maxRentFils),
        // The most the rent can rise, in money: maximum renewal rent minus current rent.
        maxIncreaseFils: d.maxRentFils - lease.annualRentFils,
        noticeSendOn: renewalMilestones(lease.endOn, r).find((m) => m.id === "notice_send")!.dueOn,
        noticeLegalDeadline: renewalNoticeDeadline(lease.endOn, r),
        reasons: out.reasons,
      };
    });
    return c.json(result);
  });

  /** The rules version new leases get today, and every published version. */
  api.get("/rules", (c) =>
    c.json({ current: activeRulesVersion(ctx.clock.today()) ?? ctx.rulesVersion, versions: rulebookVersions() }),
  );

  /** One rulebook version with plain explanations of each rule. */
  api.get("/rules/:version", (c) => {
    let r: ReturnType<typeof getRulebook>;
    try {
      r = getRulebook(c.req.param("version"));
    } catch {
      throw notFound("rulebook version");
    }
    const exampleEnd = c.req.query("leaseEndOn");
    const end = exampleEnd && /^\d{4}-\d{2}-\d{2}$/.test(exampleEnd) ? (exampleEnd as CalendarDate) : null;
    const bands = r.rentCapBands.map((b, i) => ({
      // Same comparison as the rulebook: a gap of 10.01% is "over 10%".
      gapBelowSri: i === 0 ? `up to ${b.gapUpTo}%` : `over ${r.rentCapBands[i - 1]!.gapUpTo}% up to ${b.gapUpTo}%`,
      maxIncreasePercent: b.maxIncrease,
    }));
    bands.push({
      gapBelowSri: `over ${r.rentCapBands.at(-1)!.gapUpTo}%`,
      maxIncreasePercent: r.aboveLastBandMaxIncrease,
    });
    return c.json({
      version: r.version,
      emirate: r.emirate,
      effectiveFrom: r.effectiveFrom,
      sources: r.sources,
      rules: {
        rent_cap: {
          text: "At renewal, rent may rise only by the band for how far current rent is below the Smart Rental Index average for similar homes.",
          bands,
        },
        renewal_notice: {
          text: `A rent change needs written notice at least ${r.renewalNoticeDays} days before the lease ends. Without it, the lease renews at the same rent. Company policy sends at ${r.renewalSendAtDays} days.`,
          renewalNoticeDays: r.renewalNoticeDays,
          companySendAtDays: r.renewalSendAtDays,
        },
        repossession_notice: {
          text: `The landlord can end a lease at its end only for sale, own use, major works or demolition, with ${r.repossessionNoticeMonths} months' notice by notary or registered mail (never email).`,
          months: r.repossessionNoticeMonths,
        },
        own_use_lock: {
          text: `After an own-use repossession the unit can't be re-let for ${r.ownUseLockYears.residential} years (residential) or ${r.ownUseLockYears.commercial} years (commercial).`,
          years: r.ownUseLockYears,
        },
        late_rent: {
          text: `Eviction for unpaid rent can start only ${r.lateRentDaysAfterFormalReminder} days after a formal reminder.`,
          days: r.lateRentDaysAfterFormalReminder,
        },
        reference: {
          text: "Company-authored reference notes for this version. They are notes for staff, not law, and the engine does not enforce them.",
          rules: r.referenceRules.map((x) => ({ id: x.id, title: x.title, text: x.text })),
        },
      },
      ...(end
        ? {
            forLeaseEnding: {
              leaseEndOn: end,
              milestones: renewalMilestones(end, r).map((m) => ({
                id: m.id,
                dueOn: m.dueOn,
                description: m.description,
              })),
              repossessionNoticeDeadline: repossessionNoticeDeadline(end, r),
            },
          }
        : {}),
    });
  });

  api.get("/helper-runs/:id", async (c) => {
    const [run] = await db
      .select({
        id: helperRuns.id,
        helper: helperRuns.helper,
        entityKind: helperRuns.entityKind,
        entityId: helperRuns.entityId,
        status: helperRuns.status,
        output: helperRuns.output,
        model: helperRuns.model,
        confidence: helperRuns.confidence,
        latencyMs: helperRuns.latencyMs,
        attempt: helperRuns.attempt,
        at: helperRuns.at,
      })
      .from(helperRuns)
      .where(eq(helperRuns.id, z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"))));
    if (!run) throw notFound("helper run");
    // Result and reasons only: a failed run's raw error (possibly model text) stays in the database.
    const out = (run.output ?? {}) as { status?: string; data?: unknown; reasons?: unknown };
    // Identity numbers read by KYC are masked, like every other view.
    return c.json(
      maskPii({ ...run, output: { status: out.status, data: out.data ?? null, reasons: out.reasons ?? [] } }),
    );
  });
}
