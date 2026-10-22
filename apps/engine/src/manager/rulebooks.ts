/**
 * Rulebook versions stored in the database (decision D23). The code version is the base and is
 * kept as a published row; admins edit drafts and publish them with an effective-from date.
 * Published rows are immutable (DB trigger) and are loaded into the in-memory registry of
 * `packages/rulebook`, so every rule lookup stays synchronous and by version.
 */
import { type Actor, type CalendarDate, isCalendarDate, newId } from "@leasing/core";
import { type Database, rulebooks, type Tx, withTx } from "@leasing/db";
import {
  activeRulesVersion,
  baseRulebooks,
  deepEqual,
  getRulebook,
  type Loosened,
  loosenedVsBase,
  ReferenceRules,
  type ReferenceRule,
  registerRulebook,
  resetRulebookRegistry,
  type Rulebook,
  rulebookFromRow,
  RulebookValues,
  rulebookValues,
  rulebookVersions,
} from "@leasing/rulebook";
import { asc, eq, like } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { appendEvent } from "./events.ts";

type Row = typeof rulebooks.$inferSelect;

/**
 * Engine startup and test setup: store each code version as a published row (once), refuse to
 * start if a stored base row differs from code, then register every published row.
 */
export async function syncRulebooks(database: Database): Promise<void> {
  resetRulebookRegistry();
  await withTx(database, async (tx) => {
    for (const base of baseRulebooks) {
      await tx.db
        .insert(rulebooks)
        .values({
          id: newId(),
          version: base.version,
          emirate: base.emirate,
          status: "published",
          basedOn: null,
          effectiveFrom: base.effectiveFrom as CalendarDate,
          values: rulebookValues(base),
          referenceRules: [...base.referenceRules],
          createdBy: "system",
          publishedBy: "system",
          // The code version has been in force since its effective date (Dubai midnight).
          publishedAt: new Date(`${base.effectiveFrom}T00:00:00+04:00`),
        })
        .onConflictDoNothing({ target: rulebooks.version });
    }
  });
  const rows = await database.db
    .select()
    .from(rulebooks)
    .where(eq(rulebooks.status, "published"))
    .orderBy(asc(rulebooks.publishedAt), asc(rulebooks.createdAt));
  for (const base of baseRulebooks) {
    const row = rows.find((r) => r.version === base.version);
    if (!row || row.status !== "published" || !deepEqual(rulebookFromRow(row), base))
      throw new Error(
        `rulebook ${base.version} in the database differs from packages/rulebook; a published version must never change (D23)`,
      );
  }
  for (const row of rows) registerRulebook(rulebookFromRow(row));
}

/** The code version stored drafts are compared with for loosened tenant protection. */
export function baseFor(emirate: Rulebook["emirate"]): Rulebook {
  const base = baseRulebooks.find((r) => r.emirate === emirate);
  if (!base) throw new Error(`no base rulebook for ${emirate}`);
  return base;
}

export interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

type Contents = {
  values: RulebookValues;
  referenceRules: readonly ReferenceRule[];
  effectiveFrom?: string | undefined;
};

function flatten(prefix: string, v: unknown, out: Map<string, unknown>) {
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
  } else out.set(prefix, v);
}

function flat(c: Contents): Map<string, unknown> {
  const out = new Map<string, unknown>();
  flatten("", c.values, out);
  // Reference rules are matched by id, so removing one doesn't show every later one as changed.
  for (const r of c.referenceRules) {
    out.set(`referenceRules.${r.id}.title`, r.title);
    out.set(`referenceRules.${r.id}.text`, r.text);
  }
  if (c.effectiveFrom !== undefined) out.set("effectiveFrom", c.effectiveFrom);
  return out;
}

/** Field-level changes from `a` to `b` (`undefined` = absent on that side). */
export function diffContents(a: Contents, b: Contents): Change[] {
  const fa = flat(a);
  const fb = flat(b);
  const keys = [...new Set([...fa.keys(), ...fb.keys()])];
  return keys.filter((k) => fa.get(k) !== fb.get(k)).map((k) => ({ field: k, from: fa.get(k), to: fb.get(k) }));
}

export const contentsOf = (r: Rulebook): Contents => ({
  values: rulebookValues(r),
  referenceRules: r.referenceRules,
  effectiveFrom: r.effectiveFrom,
});
const rowContents = (row: Row): Contents => ({
  values: RulebookValues.parse(row.values),
  referenceRules: ReferenceRules.parse(row.referenceRules),
  effectiveFrom: row.effectiveFrom,
});

async function lockRow(tx: Tx, version: string): Promise<Row> {
  const [row] = await tx.db.select().from(rulebooks).where(eq(rulebooks.version, version)).for("update");
  if (!row) throw notFound("rulebook version");
  return row;
}

const requireDraft = (row: Row) => {
  if (row.status !== "draft")
    throw conflict(`rulebook ${row.version} is published and can't be changed; create a new draft`, "published");
};

function requireFutureOrToday(ctx: EngineContext, effectiveFrom: string) {
  if (effectiveFrom < ctx.clock.today())
    throw unprocessable(
      `effective-from ${effectiveFrom} is in the past (today is ${ctx.clock.today()} in Dubai)`,
      [],
      "effective_from_past",
    );
}

/** New draft copied from a published version, named `dubai-YYYY-MM-NN` from today's date. */
export async function createDraft(ctx: EngineContext, basedOn: string, actor: Actor): Promise<Row> {
  let source: Rulebook;
  try {
    source = getRulebook(basedOn);
  } catch {
    throw notFound("published rulebook version");
  }
  const today = ctx.clock.today();
  return withTx(ctx.database, async (tx) => {
    // Serialise version numbering.
    await tx.boss.executeSql("SELECT pg_advisory_xact_lock(hashtext('rulebooks:new-version'))", []);
    const prefix = `${source.emirate}-${today.slice(0, 7)}-`;
    const taken = await tx.db
      .select({ version: rulebooks.version })
      .from(rulebooks)
      .where(like(rulebooks.version, `${prefix}%`));
    const n = Math.max(0, ...taken.map((t) => Number(t.version.slice(prefix.length)) || 0)) + 1;
    if (n > 99) throw conflict(`too many rulebook versions this month (${prefix}99 reached)`, "version_limit");
    const version = `${prefix}${String(n).padStart(2, "0")}`;
    const [row] = await tx.db
      .insert(rulebooks)
      .values({
        id: newId(),
        version,
        emirate: source.emirate,
        status: "draft",
        basedOn,
        effectiveFrom: today,
        values: rulebookValues(source),
        referenceRules: source.referenceRules.map((r) => ({ ...r })),
        createdBy: actor,
      })
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "rulebook", id: row!.id },
      type: "RULEBOOK_DRAFT_CREATED",
      actor,
      payload: { version, basedOn, effectiveFrom: today },
      rulesVersion: version,
    });
    return row!;
  });
}

export const DraftPatch = z.strictObject({
  values: z.unknown().optional(),
  referenceRules: z.unknown().optional(),
  effectiveFrom: z.string().refine(isCalendarDate, "must be a calendar date YYYY-MM-DD").optional(),
});
export type DraftPatch = z.infer<typeof DraftPatch>;

/** Edit a draft. Values and reference rules are replaced whole and validated. */
export async function updateDraft(ctx: EngineContext, version: string, patch: DraftPatch, actor: Actor) {
  const values = patch.values === undefined ? undefined : RulebookValues.parse(patch.values);
  const referenceRules = patch.referenceRules === undefined ? undefined : ReferenceRules.parse(patch.referenceRules);
  if (patch.effectiveFrom !== undefined) requireFutureOrToday(ctx, patch.effectiveFrom);
  return withTx(ctx.database, async (tx) => {
    const row = await lockRow(tx, version);
    requireDraft(row);
    const before = rowContents(row);
    const after: Contents = {
      values: values ?? before.values,
      referenceRules: referenceRules ?? before.referenceRules,
      effectiveFrom: patch.effectiveFrom ?? before.effectiveFrom,
    };
    const changes = diffContents(before, after);
    const [updated] = await tx.db
      .update(rulebooks)
      .set({
        values: after.values,
        referenceRules: [...after.referenceRules],
        effectiveFrom: after.effectiveFrom as CalendarDate,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(rulebooks.id, row.id))
      .returning();
    if (changes.length)
      await appendEvent(tx, ctx, {
        entity: { kind: "rulebook", id: row.id },
        type: "RULEBOOK_DRAFT_UPDATED",
        actor,
        payload: { version, changes, loosened: loosenedVsBase(after.values, baseFor(row.emirate)) },
        rulesVersion: version,
      });
    return updated!;
  });
}

export async function deleteDraft(ctx: EngineContext, version: string, actor: Actor): Promise<void> {
  await withTx(ctx.database, async (tx) => {
    const row = await lockRow(tx, version);
    requireDraft(row);
    await tx.db.delete(rulebooks).where(eq(rulebooks.id, row.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "rulebook", id: row.id },
      type: "RULEBOOK_DRAFT_DELETED",
      actor,
      payload: { version, basedOn: row.basedOn },
      rulesVersion: version,
    });
  });
}

/**
 * Publish a draft. It takes effect for new leases from its effective-from date; existing leases
 * keep their pinned version. Weaker tenant protection than the code base needs
 * `confirmLegalReview: true` (a lawyer reviewed it), recorded in the audit event.
 */
export async function publishRulebook(
  ctx: EngineContext,
  version: string,
  opts: { confirmLegalReview?: boolean | undefined },
  actor: Actor,
): Promise<{ row: Row; loosened: Loosened[] }> {
  const result = await withTx(ctx.database, async (tx) => {
    const row = await lockRow(tx, version);
    requireDraft(row);
    requireFutureOrToday(ctx, row.effectiveFrom);
    const rulebook = rulebookFromRow(row);
    const loosened = loosenedVsBase(rulebookValues(rulebook), baseFor(row.emirate));
    if (loosened.length && opts.confirmLegalReview !== true)
      throw unprocessable(
        "these changes weaken tenant protection compared with the base rules; confirm a legal review to publish",
        loosened.map((l) => `${l.field}: ${String(l.base)} → ${String(l.value)}`),
        "legal_review_required",
      );
    const active = activeRulesVersion(ctx.clock.today(), row.emirate);
    const changes = active ? diffContents(contentsOf(getRulebook(active)), contentsOf(rulebook)) : [];
    const [updated] = await tx.db
      .update(rulebooks)
      .set({ status: "published", publishedBy: actor, publishedAt: ctx.clock.now(), updatedAt: ctx.clock.now() })
      .where(eq(rulebooks.id, row.id))
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "rulebook", id: row.id },
      type: "RULEBOOK_PUBLISHED",
      actor,
      fromState: "draft",
      toState: "published",
      payload: {
        version,
        effectiveFrom: row.effectiveFrom,
        comparedWith: active,
        // What this version takes over from on its own date, and published versions after it.
        supersedes: activeRulesVersion(row.effectiveFrom as CalendarDate, row.emirate),
        laterVersions: rulebookVersions().filter((v) => {
          const r = getRulebook(v);
          return r.emirate === row.emirate && r.effectiveFrom > row.effectiveFrom;
        }),
        changes,
        loosened,
        legalReviewConfirmed: loosened.length ? true : (opts.confirmLegalReview ?? false),
      },
      rulesVersion: version,
    });
    return { row: updated!, loosened, rulebook };
  });
  // After commit: the version is now immutable in the database.
  registerRulebook(result.rulebook);
  return { row: result.row, loosened: result.loosened };
}
