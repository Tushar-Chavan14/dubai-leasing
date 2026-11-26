import { newId } from "@platform/kernel/ids";
import { maskPii } from "@platform/kernel/pii";
import type { Llm } from "@platform/llm";
import type { SpaActor, SpaRole } from "@spa/core";
import {
  type AmlHitRule,
  amlCases,
  amlHits,
  dealParties,
  deals,
  helperRuns,
  riskAssessments,
  type ScreeningTrigger,
  SCREENING_TRIGGERS,
  screenings,
  withSpaTx,
} from "@spa/db";
import {
  AML_LIST_LABEL,
  AML_SUMMARY_PROMPT_VERSION,
  type AmlSummary,
  type ScreeningAdapter,
  evaluateAml,
  summariseAml,
  templateSummary,
  instructionLike,
} from "@spa/helpers";
import { getSalesRulebook } from "@spa/rulebook";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { advance } from "./advance.ts";
import { currentAmlPolicy, recordRiskAssessmentIn } from "./aml.ts";
import { clearedHitKeys, hitKey, latestScreenings, type StoredHit } from "./aml-facts.ts";
import { dealAmlSubjects } from "./aml-subjects.ts";
import { proposeApproval } from "./approvals.ts";
import { driveAfter } from "./drive.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { AML_SCREEN_JOB } from "../jobs.ts";
import { hasAnyRole } from "@spa/core";

export { AML_SCREEN_JOB };
/**
 * One screening job per deal, trigger and day (rule 7). `subject` tells two new subjects of the same trigger and day apart
 * (a second non-buyer payer on a day must not be dropped as a repeat of the first): a payment's id, say.
 */
export const amlJobKey = (dealId: string, trigger: string, today: string, subject?: string) =>
  `${dealId}:aml:${trigger}:${today}${subject ? `:${subject}` : ""}`;
const AML_ACTOR: SpaActor = "system:aml";
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);
/** States a flag puts on hold (S50): the check itself, and the re-screen before the agreement. */
const HOLDABLE = new Set(["PARTY_CHECK", "AGREEMENT_DRAFT", "LEGAL_REVIEW"]);

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
const STARTERS: readonly SpaRole[] = [
  "sales_officer",
  "sales_manager",
  "sales_admin",
  "admin",
  "compliance_officer",
  "mlro",
];
/** Reading a case, hit, screening or the helper's summary: the compliance roles only (S6, tipping-off). */
const READERS: readonly SpaRole[] = ["compliance_officer", "mlro"];

/** What screening needs from outside: the lists, and optionally a model that writes the compliance-only summary. */
export interface ScreeningDeps {
  screening: ScreeningAdapter;
  llm?: Llm | null | undefined;
}
export interface ScreenResult {
  screeningIds: string[];
  /** A flagging hit exists that no cleared hit covers. */
  flagged: boolean;
  caseId: string | null;
  approvalId: string | null;
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : "");

/**
 * Screens every party, company, beneficial owner and non-party payer against the lists, then runs the code rules and
 * the risk assessment (S50). Code alone decides: a flag opens an `aml_case`, an `aml_flag` approval for the compliance
 * officer and (from `PARTY_CHECK`, `AGREEMENT_DRAFT` or `LEGAL_REVIEW`) puts the deal on `AML_HOLD`. A model writes only
 * the compliance-only summary, after a flag exists; a summary that contradicts a hit is replaced. Safe to run twice:
 * an open case keeps its one pending approval and takes only hits it hasn't got.
 */
export async function screenDeal(
  ctx: SpaContext,
  deps: ScreeningDeps,
  input: { dealId: string; trigger: ScreeningTrigger },
  actor: SpaActor = AML_ACTOR,
): Promise<ScreenResult> {
  const r = await screenDealOnce(ctx, deps, input, actor);
  // A finished screening can be the last fact the checks were waiting for (S59). The driver moves a deal only on facts.
  await driveAfter(ctx, input.dealId);
  return r;
}

async function screenDealOnce(
  ctx: SpaContext,
  deps: ScreeningDeps,
  input: { dealId: string; trigger: ScreeningTrigger },
  actor: SpaActor,
): Promise<ScreenResult> {
  const db = ctx.database.db;
  const [deal0] = await db.select().from(deals).where(eq(deals.id, input.dealId));
  if (!deal0) throw notFound("deal");
  if (CLOSED.has(deal0.state)) throw conflict("deal_closed", `a deal in ${deal0.state} needs no screening`);
  const rb = (ctx.rulebook ?? getSalesRulebook)(deal0.rulesVersion);
  if (!rb) throw unprocessable("rulebook_missing", `the rulebook ${deal0.rulesVersion} isn't available`);
  const policy = await currentAmlPolicy(db);
  const subjects = await dealAmlSubjects(db, deal0);
  if (!subjects.length) throw unprocessable("no_parties", "the deal has no parties to screen");

  // Screen and evaluate (no database transaction open while the lists are asked).
  const { results } = await evaluateAml(deps.screening, subjects, rb, policy.values);
  const listVersion = deps.screening.listVersion;
  const labelOf = new Map(subjects.map((s, i) => [s.key, `Party ${letter(i)}`]));
  const scoreOf = (r: (typeof results)[number], rule: string) =>
    rule === "sanctions"
      ? (r.screening?.sanctionsScore ?? null)
      : rule === "pep"
        ? (r.screening?.pepScore ?? null)
        : null;

  // The wording, only if a flag exists that nobody cleared. It never decides anything.
  const cleared0 = await clearedHitKeys(db, deal0.id);
  const flagging = (cleared: ReadonlySet<string>) =>
    results.flatMap((r) =>
      r.hits.filter((h) => h.flags && !cleared.has(hitKey(r.subject.key, h.rule, listVersion))).map((h) => ({ r, h })),
    );
  let wording: AmlSummary | null = null;
  const pre = flagging(cleared0);
  if (pre.length) {
    const wordingInput = {
      hits: pre.map(({ r, h }) => ({
        partyLabel: labelOf.get(r.subject.key)!,
        rule: h.rule,
        score: scoreOf(r, h.rule),
      })),
      names: [...new Set(pre.map(({ r }) => r.subject.key))].map((k) => ({
        label: labelOf.get(k)!,
        name: subjects.find((s) => s.key === k)!.name,
      })),
      eddDocuments: policy.values.edd.documents,
    };
    wording = deps.llm
      ? await summariseAml(deps.llm, wordingInput)
      : {
          summary: templateSummary(wordingInput),
          suggestedDocuments: [],
          instructionLike: wordingInput.names.some((n) => instructionLike(n.name)),
          fromModel: false,
          model: null,
        };
  }

  return withSpaTx(ctx.database, async (tx) => {
    const [deal] = await tx.db.select().from(deals).where(eq(deals.id, input.dealId)).for("update");
    if (!deal) throw notFound("deal");
    if (CLOSED.has(deal.state)) throw conflict("deal_closed", `a deal in ${deal.state} needs no screening`);
    const now = ctx.clock.now();

    // One screening row per subject, with what code evaluated (the facts read these, never a model).
    const screeningIds: string[] = [];
    for (const r of results) {
      const id = newId();
      screeningIds.push(id);
      const hits: StoredHit[] = r.hits.map((h) => ({
        rule: h.rule,
        severity: h.severity,
        detail: h.detail,
        flags: h.flags,
      }));
      await tx.db.insert(screenings).values({
        id,
        dealId: deal.id,
        partyId: r.subject.partyId,
        subjectKey: r.subject.key,
        trigger: input.trigger,
        listVersion,
        sanctionsScore: r.screening?.sanctionsScore ?? null,
        pepScore: r.screening?.pepScore ?? null,
        exact: r.screening?.exact ?? false,
        matches: { entries: r.screening?.matches ?? [], hits },
        screenedAt: now,
      });
    }

    // The risk assessment by code for each party on the deal (high risk opens `edd_signoff`). A repeat screening with
    // the same hits under the same policy records nothing new, so a decided sign-off isn't opened again.
    const onDeal = new Set(
      (await tx.db.select({ id: dealParties.partyId }).from(dealParties).where(eq(dealParties.dealId, deal.id))).map(
        (p) => p.id,
      ),
    );
    for (const r of results) {
      if (!r.subject.partyId || !onDeal.has(r.subject.partyId)) continue;
      const rules = r.hits.map((h) => h.rule);
      const [last] = await tx.db
        .select()
        .from(riskAssessments)
        .where(and(eq(riskAssessments.dealId, deal.id), eq(riskAssessments.partyId, r.subject.partyId)))
        .orderBy(desc(riskAssessments.createdAt), desc(riskAssessments.id))
        .limit(1);
      const lastRules = ((last?.detail.hits ?? []) as { rule: string }[]).map((h) => h.rule);
      if (last && last.policyVersion === policy.version && lastRules.toSorted().join() === rules.toSorted().join())
        continue;
      await recordRiskAssessmentIn(
        tx,
        ctx,
        {
          dealId: deal.id,
          partyId: r.subject.partyId,
          hits: rules.map((rule) => ({ rule })),
          partyType: r.subject.kind,
          paymentMethod: deal.buyerMortgage ? "mortgage" : "transfer",
        },
        actor,
      );
    }

    // Flagging hits nobody cleared (read again: a decision may have landed while the lists were asked).
    const cleared = await clearedHitKeys(tx.db, deal.id);
    const uncovered = flagging(cleared);
    const [existing] = await tx.db
      .select()
      .from(amlCases)
      .where(and(eq(amlCases.dealId, deal.id), inArray(amlCases.status, ["open", "info_requested"])))
      .orderBy(desc(amlCases.openedAt), desc(amlCases.id))
      .limit(1)
      .for("update");
    // A case waiting for information gets a new round on any screening, even one that finds nothing new: otherwise
    // the hold could never be decided.
    const reopen = existing?.status === "info_requested";
    if (!uncovered.length && !reopen) return { screeningIds, flagged: false, caseId: null, approvalId: null };

    const text =
      wording ??
      ({
        summary: templateSummary({
          hits: uncovered.map(({ r, h }) => ({
            partyLabel: labelOf.get(r.subject.key)!,
            rule: h.rule,
            score: scoreOf(r, h.rule),
          })),
        }),
        suggestedDocuments: [],
        instructionLike: false,
        fromModel: false,
        model: null,
      } satisfies AmlSummary);
    const caseId = existing?.id ?? newId();
    let approvalId = existing?.approvalId ?? null;
    // A new round needs a new approval: a new case, or one waiting for information.
    if (!existing || reopen) {
      const p = await proposeApproval(
        ctx,
        {
          gate: "aml_flag",
          entity: { kind: "deal", id: deal.id },
          dedupeKey: `${deal.id}:aml_flag:${screeningIds[0]}`,
          title: "Compliance review",
          proposal: { caseId },
          proposedBy: actor,
        },
        tx,
      );
      approvalId = p.id;
      if (!existing)
        await tx.db.insert(amlCases).values({
          id: caseId,
          dealId: deal.id,
          status: "open",
          approvalId,
          summary: text.summary,
          summaryModel: text.fromModel ? text.model : null,
          instructionLike: text.instructionLike,
          openedAt: now,
        });
      else await tx.db.update(amlCases).set({ status: "open", approvalId }).where(eq(amlCases.id, caseId));
    }

    // Every hit of this round the case doesn't have yet (flags and warnings alike: clearing covers what compliance saw).
    const have = new Set(
      (await tx.db.select().from(amlHits).where(eq(amlHits.caseId, caseId))).map((h) =>
        hitKey(h.subjectKey, h.rule, h.listVersion),
      ),
    );
    for (const r of results)
      for (const h of r.hits) {
        const key = hitKey(r.subject.key, h.rule, listVersion);
        if (have.has(key)) continue;
        have.add(key);
        await tx.db.insert(amlHits).values({
          id: newId(),
          caseId,
          partyId: r.subject.partyId,
          subjectKey: r.subject.key,
          rule: h.rule as AmlHitRule,
          severity: h.severity,
          detail: h.detail,
          listVersion,
          createdAt: now,
        });
      }

    // The wording is kept as a compliance-only helper run, never a `staff` one.
    if (uncovered.length)
      await tx.db.insert(helperRuns).values({
        id: newId(),
        helper: "spa_aml",
        dealId: deal.id,
        entityKind: "deal",
        entityId: deal.id,
        status: deps.llm && !text.fromModel ? "needs_human" : "ok",
        result: maskPii({
          caseId,
          summary: text.summary,
          suggestedDocuments: text.suggestedDocuments,
          instructionLike: text.instructionLike,
          fromModel: text.fromModel,
        }),
        reasons: [],
        modelTag: text.fromModel ? text.model : null,
        promptVersion: AML_SUMMARY_PROMPT_VERSION,
        rulesVersion: deal.rulesVersion,
        amlPolicyVersion: policy.version,
        visibility: "compliance",
        createdAt: now,
      });

    // The hold: the move is written as a compliance review, and the guard reads the screenings just stored.
    if (uncovered.length && HOLDABLE.has(deal.state))
      await advance(ctx, { kind: "deal", id: deal.id }, "AML_FLAGGED", { actor, tx });
    else
      await appendDealEvent(tx, ctx, {
        entity: { kind: "deal", id: deal.id },
        type: "COMPLIANCE_REVIEW_RECORDED",
        actor,
        rulesVersion: deal.rulesVersion,
        payload: { screeningId: screeningIds[0] },
      });
    return { screeningIds, flagged: uncovered.length > 0, caseId, approvalId };
  });
}

/** Queues a screening: one job per deal, trigger and Dubai day (rule 7). The answer says nothing about the result. */
export async function enqueueAmlScreening(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  input: { dealId: string; trigger: ScreeningTrigger; subject?: string },
  user?: Person,
): Promise<{ key: string; jobId: string | null; queued: boolean }> {
  if (user && !hasAnyRole(user, STARTERS)) throw forbidden("you can't start a screening");
  if (!SCREENING_TRIGGERS.includes(input.trigger)) throw unprocessable("invalid_trigger", "unknown screening trigger");
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, input.dealId));
  if (!d) throw notFound("deal");
  const key = amlJobKey(input.dealId, input.trigger, ctx.clock.today(), input.subject);
  const jobId = await boss.send(
    AML_SCREEN_JOB,
    { dealId: input.dealId, trigger: input.trigger },
    { singletonKey: key },
  );
  return { key, jobId, queued: jobId !== null };
}

/**
 * The cases, hits, latest screenings and the helper's summaries for a deal. Compliance roles only: everyone else gets
 * 403 and no data (S6, tipping-off).
 */
export async function listAmlCases(ctx: SpaContext, dealId: string, user: Person) {
  if (!hasAnyRole(user, READERS)) throw forbidden("only compliance roles can read this");
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  return amlCasesView(ctx, dealId);
}

/** The cases and screenings with no role check: the caller (a route or the compliance record section) has made it. */
export async function amlCasesView(ctx: SpaContext, dealId: string) {
  const db = ctx.database.db;
  const cases = await db
    .select()
    .from(amlCases)
    .where(eq(amlCases.dealId, dealId))
    .orderBy(amlCases.openedAt, amlCases.id);
  const hits = cases.length
    ? await db
        .select()
        .from(amlHits)
        .where(
          inArray(
            amlHits.caseId,
            cases.map((c) => c.id),
          ),
        )
        .orderBy(amlHits.createdAt, amlHits.id)
    : [];
  const latest = [...(await latestScreenings(db, dealId)).values()];
  const runs = await db
    .select()
    .from(helperRuns)
    .where(and(eq(helperRuns.dealId, dealId), eq(helperRuns.visibility, "compliance")))
    .orderBy(helperRuns.createdAt, helperRuns.id);
  return {
    label: AML_LIST_LABEL,
    cases: cases.map((c) => ({
      id: c.id,
      status: c.status,
      approvalId: c.approvalId,
      summary: c.summary,
      summaryModel: c.summaryModel,
      instructionLike: c.instructionLike,
      openedAt: c.openedAt,
      closedAt: c.closedAt,
      hits: hits
        .filter((h) => h.caseId === c.id)
        .map((h) => ({
          partyId: h.partyId,
          subjectKey: h.subjectKey,
          rule: h.rule,
          severity: h.severity,
          detail: h.detail,
          listVersion: h.listVersion,
        })),
    })),
    screenings: latest.map((s) => ({
      id: s.id,
      subjectKey: s.subjectKey,
      partyId: s.partyId,
      trigger: s.trigger,
      listVersion: s.listVersion,
      sanctionsScore: s.sanctionsScore,
      pepScore: s.pepScore,
      exact: s.exact,
      matches: s.matches,
      screenedAt: s.screenedAt,
    })),
    summaries: runs.map((r) => ({
      id: r.id,
      status: r.status,
      result: r.result,
      modelTag: r.modelTag,
      createdAt: r.createdAt,
    })),
  };
}

/** The re-screening points tied to a state the deal enters (policy `rescreen`, S50): before the agreement and the transfer. */
const SCREEN_ON_ENTER: Readonly<Record<string, ScreeningTrigger>> = {
  AGREEMENT_DRAFT: "before_agreement",
  TRANSFER: "before_transfer",
};

/**
 * Queues the screening a state change calls for, with the same `<dealId>:aml:<trigger>:<day>` singleton key as every
 * other screening job (rule 7), so a repeat step the same day queues nothing new. A queue that is down doesn't undo the
 * step: the stale-screening rule of `openAmlFlag` still holds the deal until someone screens it.
 */
export async function enqueueOnDealEntered(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  e: { dealId: string; to: string },
): Promise<void> {
  const trigger = SCREEN_ON_ENTER[e.to];
  if (!trigger) return;
  await boss
    .send(
      AML_SCREEN_JOB,
      { dealId: e.dealId, trigger },
      { singletonKey: amlJobKey(e.dealId, trigger, ctx.clock.today()) },
    )
    .catch((err: unknown) => console.warn(`could not queue the ${trigger} screening: ${(err as Error).message}`));
}
