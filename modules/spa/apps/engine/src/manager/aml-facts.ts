import { diffDays, toDubaiDate, type CalendarDate } from "@platform/kernel/dates";
import { SpaAmlPolicy } from "@spa/core";
import {
  amlCases,
  amlHits,
  riskAssessments,
  screenings,
  spaAmlPolicy,
  spaApprovals,
  type SpaDb,
  type SpaTx,
} from "@spa/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { dealAmlSubjects } from "./aml-subjects.ts";
import type { DealRow, FactsEnv } from "./facts.ts";

/** What code stored about each hit it evaluated, inside `screenings.matches`. */
export interface StoredHit {
  rule: string;
  severity: "flag" | "warning";
  detail: string;
  flags: boolean;
}
export const hitKey = (subjectKey: string, rule: string, listVersion: string) => `${subjectKey}:${rule}:${listVersion}`;

/** Each subject's latest screening of a deal. */
export async function latestScreenings(db: SpaDb, dealId: string) {
  const rows = await db
    .select()
    .from(screenings)
    .where(eq(screenings.dealId, dealId))
    .orderBy(desc(screenings.screenedAt), desc(screenings.id));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.subjectKey)) latest.set(r.subjectKey, r);
  return latest;
}

/** Hits a compliance officer cleared: a later screening with the same hit (party, rule, list version) is covered. */
export async function clearedHitKeys(db: SpaDb, dealId: string): Promise<Set<string>> {
  const rows = await db
    .select({ subjectKey: amlHits.subjectKey, rule: amlHits.rule, listVersion: amlHits.listVersion })
    .from(amlHits)
    .innerJoin(amlCases, eq(amlCases.id, amlHits.caseId))
    .where(and(eq(amlCases.dealId, dealId), eq(amlCases.status, "cleared")));
  return new Set(rows.map((r) => hitKey(r.subjectKey, r.rule, r.listVersion)));
}

/** The flagging hits of the latest screenings that no cleared hit covers. */
export function uncoveredFlags(
  latest: ReadonlyMap<string, { subjectKey: string; listVersion: string; matches: Record<string, unknown> }>,
  current: ReadonlySet<string> | null,
  cleared: ReadonlySet<string>,
) {
  const out: { subjectKey: string; listVersion: string; hit: StoredHit }[] = [];
  for (const [key, s] of latest) {
    if (current && !current.has(key)) continue;
    for (const hit of (s.matches.hits ?? []) as StoredHit[])
      if (hit.flags && !cleared.has(hitKey(s.subjectKey, hit.rule, s.listVersion)))
        out.push({ subjectKey: s.subjectKey, listVersion: s.listVersion, hit });
  }
  return out;
}

/**
 * The `amlFlaggedByRule` fact (S50), fail-closed: some current party's latest screening has a flagging hit that no
 * cleared hit covers. Code evaluated those hits when it screened; nothing a model wrote is read here.
 */
export async function amlFlaggedByRuleFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  const current = new Set((await dealAmlSubjects(tx.db, deal)).map((s) => s.key));
  const latest = await latestScreenings(tx.db, deal.id);
  return uncoveredFlags(latest, current, await clearedHitKeys(tx.db, deal.id)).length > 0;
}

/** Compliance gates whose pending approval keeps a deal from passing its checks. */
const AML_GATES = ["aml_flag", "aml_report", "edd_signoff"] as const;

/**
 * How long a screening counts when the policy has no `rescreen.everyDays` (it is `null`): 90 days, the policy's own
 * default. A policy can shorten or lengthen it but can't switch freshness off (S50 amendment, review 4).
 */
export const DEFAULT_RESCREEN_DAYS = 90;

async function rescreenDays(db: SpaDb): Promise<number> {
  const [row] = await db.select().from(spaAmlPolicy).orderBy(desc(spaAmlPolicy.version)).limit(1);
  const days = row ? SpaAmlPolicy.parse(row.values).rescreen.everyDays : null;
  return days ?? DEFAULT_RESCREEN_DAYS;
}

/**
 * The `openAmlFlag` fact (S50), fail-closed, true when any of these holds:
 * - a current party, company, owner or payer has no screening yet;
 * - a current subject's latest screening is older than the policy's re-screen period (Dubai days), or was made under a
 *   list version other than the adapter's current one (`env.amlListVersion`, when the adapter is known);
 * - a case is open or waiting for information, or an `aml_flag`, `aml_report` or `edd_signoff` is pending;
 * - a current party's latest risk assessment is high and no approved `edd_signoff` covers that party and assessment
 *   (a rejected sign-off keeps blocking).
 * A deal can't pass its checks, or move on after the agreement, by silence.
 */
export async function openAmlFlagFact(
  tx: SpaTx,
  deal: DealRow,
  today: CalendarDate,
  env: FactsEnv = {},
): Promise<boolean> {
  const latest = await latestScreenings(tx.db, deal.id);
  const subjects = await dealAmlSubjects(tx.db, deal);
  if (subjects.some((s) => !latest.has(s.key))) return true;
  const days = await rescreenDays(tx.db);
  for (const s of subjects) {
    const row = latest.get(s.key)!;
    if (diffDays(toDubaiDate(row.screenedAt), today) > days) return true;
    if (env.amlListVersion && row.listVersion !== env.amlListVersion) return true;
  }
  const open = await tx.db
    .select({ id: amlCases.id })
    .from(amlCases)
    .where(and(eq(amlCases.dealId, deal.id), inArray(amlCases.status, ["open", "info_requested"])))
    .limit(1);
  if (open.length) return true;
  const gates = await tx.db
    .select({ id: spaApprovals.id })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, deal.id),
        eq(spaApprovals.status, "pending"),
        inArray(spaApprovals.gate, [...AML_GATES]),
      ),
    )
    .limit(1);
  if (gates.length) return true;
  return eddUncovered(
    tx.db,
    deal.id,
    subjects.flatMap((s) => (s.partyId ? [s.partyId] : [])),
  );
}

/** True when a party's latest assessment is `high` and no approved `edd_signoff` was given for that party and assessment. */
async function eddUncovered(db: SpaDb, dealId: string, partyIds: readonly string[]): Promise<boolean> {
  if (!partyIds.length) return false;
  const rows = await db
    .select({ id: riskAssessments.id, partyId: riskAssessments.partyId, level: riskAssessments.level })
    .from(riskAssessments)
    .where(and(eq(riskAssessments.dealId, dealId), inArray(riskAssessments.partyId, [...partyIds])))
    .orderBy(desc(riskAssessments.createdAt), desc(riskAssessments.id));
  const latestOf = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latestOf.has(r.partyId)) latestOf.set(r.partyId, r);
  const high = [...latestOf.values()].filter((r) => r.level === "high");
  if (!high.length) return false;
  const approved = await db
    .select({ proposal: spaApprovals.proposal })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, dealId),
        eq(spaApprovals.gate, "edd_signoff"),
        eq(spaApprovals.status, "approved"),
      ),
    );
  return high.some((r) => !approved.some((a) => a.proposal.assessmentId === r.id && a.proposal.partyId === r.partyId));
}
