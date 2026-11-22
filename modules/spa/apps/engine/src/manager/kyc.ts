import { createHash } from "node:crypto";
import { checkAnswers } from "@platform/kernel/kyc-form";
import { newId } from "@platform/kernel/ids";
import { maskPii, maskPiiText } from "@platform/kernel/pii";
import type { CalendarDate } from "@platform/kernel/dates";
import type { Llm } from "@platform/llm";
import type { KycData } from "@platform/readers/kyc/schema";
import type { SpaActor, SpaKycRole, SpaRole } from "@spa/core";
import { spaKycContext, spaKycHelper } from "@spa/helpers";
import {
  deals,
  documentRequests,
  helperRuns,
  kycRuns,
  type KycRunRole,
  type KycRunStatus,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { and, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unavailable, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { proposeApproval } from "./approvals.ts";
import { currentAmlPolicy } from "./aml.ts";
import { currentPartyDocuments, type DealKycParty, dealKycParties, docsHashOf, PERSON_KYC_ROLES } from "./kyc-facts.ts";
import { effectiveKycConfig } from "./kyc-config.ts";

import { KYC_RUN_JOB } from "../jobs.ts";
import { driveAfter } from "./drive.ts";
import { mailDocumentsLink } from "./portal.ts";
import { afterHelperResult, requireHelperOn } from "./helper-modes.ts";

export { KYC_RUN_JOB };
/** The answers a person typed on the form are part of the job's identity: new answers on the same documents are a new job. */
const answersTag = (answers?: Record<string, string>) => {
  const keys = Object.keys(answers ?? {}).toSorted();
  if (!answers || !keys.length) return "";
  const h = createHash("sha256")
    .update(JSON.stringify(keys.map((k) => [k, answers[k]])))
    .digest("hex");
  return `:a${h.slice(0, 16)}`;
};
export const kycJobKey = (partyId: string, docsHash: string, answers?: Record<string, string>) =>
  `${partyId}:kyc:${docsHash}${answersTag(answers)}`;

type FormFields = Parameters<typeof checkAnswers>[0];
/**
 * The form answers a run keeps (S49 amendment): text for a question of the role's form that validates (a select must be
 * one of its choices), trimmed. Anything else (a blank, another key, a value that isn't a choice) is dropped, so
 * `source_of_funds` is in `kyc_runs.answers` only when it is truly a declared choice.
 */
export function cleanAnswers(form: FormFields, given: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of form) {
    if (f.type === "document" || f.appliesTo === "company") continue;
    const v = (given[f.key] ?? "").trim();
    if (v && !checkAnswers([f], "individual", { [f.key]: v }).length) out[f.key] = v;
  }
  return out;
}
const sameAnswers = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).toSorted()) === JSON.stringify(Object.entries(b).toSorted());
/** Recorded on every run: which prompt wording read the documents. */
export const KYC_PROMPT_VERSION = "spa-kyc.v1";
const KYC_ACTOR: SpaActor = "system:kyc";
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);

type Person = { id: string; role: SpaRole };
/** Who asks for documents and starts a check: the sales team and admin. */
const SALES_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
const need = (u: Person, what: string) => {
  if (!SALES_ROLES.includes(u.role)) throw forbidden(`only ${SALES_ROLES.join(", ")} can ${what}`);
};

/** What the reader needs from outside: a model and the stored file's bytes. Documents never leave this machine. */
export interface KycDeps {
  llm: Llm;
  readFile: (storageKey: string) => Promise<Uint8Array>;
}

async function lockOpenDeal(tx: SpaTx, dealId: string) {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d) throw notFound("deal");
  if (CLOSED.has(d.state)) throw conflict("deal_closed", `a deal in ${d.state} needs no more documents`);
  return d;
}

/**
 * Records that documents are requested from every buyer and seller (and a company's beneficial owners), with the KYC
 * config version that applies to each (S41). It records only: emailing a link is C28/C35. Safe to call again: a party
 * that already has a request keeps it.
 */
export async function requestDocuments(
  ctx: SpaContext,
  dealId: string,
  user: Person,
): Promise<{ requested: number; mail?: { sent: number; failed: { partyId: string; name: string }[] } }> {
  need(user, "request documents");
  const r = await requestDocumentsIn(ctx, dealId, user);
  // Each newly asked party gets a documents link by email (C35, S67). A failed mail is shown, never silently retried.
  let mail: { sent: number; failed: { partyId: string; name: string }[] } | undefined;
  if (ctx.mail) {
    mail = { sent: 0, failed: [] };
    const names = new Map((await dealKycParties(ctx.database.db, dealId)).map((p) => [p.partyId, p.name]));
    for (const partyId of r.newParties) {
      const m = await mailDocumentsLink(ctx, dealId, partyId, `user:${user.id}`).catch(() => ({
        status: "failed" as const,
      }));
      if (m.status === "sent") mail.sent++;
      else mail.failed.push({ partyId, name: names.get(partyId) ?? "" });
    }
  }
  // With every request recorded the deal starts its checks (S59).
  await driveAfter(ctx, dealId);
  return { requested: r.requested, ...(mail ? { mail } : {}) };
}

/** Staff send one person a new documents link (C35, S67): the old one stops working. */
export async function resendDocumentsLink(
  ctx: SpaContext,
  dealId: string,
  partyId: string,
  user: Person,
): Promise<{ status: "sent" | "failed" | "skipped" }> {
  need(user, "send a documents link");
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const [req] = await ctx.database.db
    .select({ id: documentRequests.id })
    .from(documentRequests)
    .where(and(eq(documentRequests.dealId, dealId), eq(documentRequests.partyId, partyId)));
  if (!req) throw unprocessable("not_requested", "ask this person for documents first");
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so nothing can be sent");
  const r = await mailDocumentsLink(ctx, dealId, partyId, `user:${user.id}`);
  return { status: r.status };
}

async function requestDocumentsIn(
  ctx: SpaContext,
  dealId: string,
  user: Person,
): Promise<{ requested: number; newParties: string[] }> {
  return withSpaTx(ctx.database, async (tx) => {
    const deal = await lockOpenDeal(tx, dealId);
    const list = await dealKycParties(tx.db, dealId);
    let requested = 0;
    const newParties: string[] = [];
    for (const p of list) {
      const cfg = await effectiveKycConfig(ctx.database.db, p.role, deal.dealType);
      const inserted = await tx.db
        .insert(documentRequests)
        .values({
          id: newId(),
          dealId,
          partyId: p.partyId,
          kycRole: p.role,
          configScope: cfg.scope,
          configVersion: cfg.version,
          createdAt: ctx.clock.now(),
        })
        .onConflictDoNothing()
        .returning({ id: documentRequests.id });
      requested += inserted.length;
      if (inserted.length) newParties.push(p.partyId);
    }
    if (requested)
      await appendDealEvent(tx, ctx, {
        entity: { kind: "deal", id: dealId },
        type: "DOCUMENTS_REQUESTED",
        actor: `user:${user.id}`,
        rulesVersion: deal.rulesVersion,
        payload: { requested },
      });
    return { requested, newParties };
  });
}

async function partyOnDeal(ctx: SpaContext, dealId: string, partyId: string): Promise<DealKycParty> {
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const p = (await dealKycParties(ctx.database.db, dealId)).find((x) => x.partyId === partyId);
  if (!p) throw unprocessable("party_not_on_deal", "that party isn't on this deal");
  return p;
}

/** Queues a KYC check for one party: one job per party and set of documents (S49). Safe to send twice. */
export async function enqueueKycRun(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  input: { dealId: string; partyId: string; answers?: Record<string, string> | undefined },
  user?: Person,
): Promise<{ key: string; jobId: string | null; queued: boolean }> {
  if (user) need(user, "start a KYC check");
  const member = await partyOnDeal(ctx, input.dealId, input.partyId);
  await requireHelperOn(ctx, "spa_kyc", "*", input.dealId);
  const answers = input.answers && Object.keys(input.answers).length ? input.answers : undefined;
  if (answers) {
    const [deal] = await ctx.database.db.select().from(deals).where(eq(deals.id, input.dealId));
    const cfg = await effectiveKycConfig(ctx.database.db, member.role as SpaKycRole, deal!.dealType);
    const kept = cleanAnswers(cfg.config.form as FormFields, answers);
    const bad = Object.entries(answers).filter(([k, v]) => v.trim() && kept[k] !== v.trim());
    if (bad.length)
      throw unprocessable(
        "invalid_answers",
        "an answer isn't valid for this form",
        bad.map(([k]) => `${k}: not an answer to a question on the form`),
      );
  }
  const docs = await currentPartyDocuments(ctx.database.db, input.dealId, input.partyId);
  const key = kycJobKey(input.partyId, docsHashOf(docs), answers);
  const jobId = await boss.send(
    KYC_RUN_JOB,
    { dealId: input.dealId, partyId: input.partyId, ...(answers ? { answers } : {}) },
    { singletonKey: key },
  );
  return { key, jobId, queued: jobId !== null };
}

const earliest = (...dates: (string | null | undefined)[]): CalendarDate | null => {
  const d = dates.filter((x): x is string => !!x).toSorted();
  return (d[0] as CalendarDate | undefined) ?? null;
};

export interface KycRunResult {
  /** The `kyc_runs` id: what a `kyc_review` approval names. */
  runId: string;
  status: KycRunStatus;
  /** False when the same documents had already been read under the same config version. */
  created: boolean;
}

/**
 * Reads one party's documents under the role's published KYC config (S19, S41) and records the run (S49). The model
 * only reads; `assessKyc` and the config's severities decide in code. Expired or unreadable documents never pass; a
 * blocking flag makes the run `blocked` (reasons only: asking for a new upload is the chaser's job, C25). A flag a
 * person may approve opens a `kyc_review`. The same documents under the same config version are never read twice.
 */
export async function runKyc(
  ctx: SpaContext,
  deps: KycDeps,
  input: { dealId: string; partyId: string; answers?: Record<string, string> | undefined },
  actor: SpaActor = KYC_ACTOR,
): Promise<KycRunResult> {
  const r = await runKycOnce(ctx, deps, input, actor);
  await driveAfter(ctx, input.dealId);
  return r;
}

async function runKycOnce(
  ctx: SpaContext,
  deps: KycDeps,
  input: { dealId: string; partyId: string; answers?: Record<string, string> | undefined },
  actor: SpaActor = KYC_ACTOR,
): Promise<KycRunResult> {
  const { dealId, partyId } = input;
  const member = await partyOnDeal(ctx, dealId, partyId);
  if (!PERSON_KYC_ROLES.includes(member.role))
    throw unprocessable("not_a_person", "company documents are checked separately");
  await requireHelperOn(ctx, "spa_kyc", "*", dealId);
  const db = ctx.database.db;
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw notFound("deal");
  const cfg = await effectiveKycConfig(db, member.role as SpaKycRole, deal.dealType);
  const docs = await currentPartyDocuments(db, dealId, partyId);
  const docsHash = docsHashOf(docs);
  const latest = async (d: typeof db) =>
    (
      await d
        .select()
        .from(kycRuns)
        .where(and(eq(kycRuns.dealId, dealId), eq(kycRuns.partyId, partyId)))
        .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id))
        .limit(1)
    )[0];
  const before = await latest(db);
  // What the person declared on the form (S49 amendment). Not sent this time: the latest run's answers stand.
  const answers = input.answers ? cleanAnswers(cfg.config.form as FormFields, input.answers) : (before?.answers ?? {});
  const same = (r: Awaited<ReturnType<typeof latest>>) =>
    r &&
    sameAnswers(r.answers, answers) &&
    r.docsHash === docsHash &&
    r.configVersion === cfg.version &&
    r.configScope === cfg.scope &&
    r.status !== "needs_human";
  if (before && same(before)) return { runId: before.id, status: before.status, created: false };

  // Read (no database transaction open while the model works).
  const today = ctx.clock.today();
  let data: KycData | null = null;
  let reasons: string[];
  let helperStatus: "ok" | "needs_human" = "ok";
  if (!docs.length) {
    reasons = ["No documents have been uploaded for this party."];
  } else {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const context = spaKycContext({
      config: cfg.config,
      partyName: member.name,
      documents: docs.map((d) => ({ docId: d.id, kind: d.kind })),
      today,
      answers,
    });
    const run = await spaKycHelper(deps.llm, (id) => deps.readFile(byId.get(id)!.storageKey)).run({
      runId: newId(),
      entity: { kind: "party", id: partyId },
      step: "kyc",
      context,
      rulesVersion: deal.rulesVersion,
      now: ctx.clock.now().toISOString(),
    });
    if (run.status === "ok" && run.data) {
      data = run.data;
      reasons = data.flags.map((f) => f.message);
    } else {
      helperStatus = "needs_human";
      reasons = run.reasons;
    }
  }
  const status: KycRunStatus =
    helperStatus === "needs_human"
      ? "needs_human"
      : !data || data.flags.some((f) => f.blocking)
        ? "blocked"
        : data.flags.length
          ? "review"
          : "passed";
  const aml = await currentAmlPolicy(db);

  return withSpaTx(ctx.database, async (tx) => {
    await lockOpenDeal(tx, dealId);
    // Another worker may have recorded the same read while the model was working.
    const now = await latest(tx.db);
    if (now && same(now)) return { runId: now.id, status: now.status, created: false };
    const helperRunId = newId();
    await tx.db.insert(helperRuns).values({
      id: helperRunId,
      helper: "spa_kyc",
      dealId,
      entityKind: "party",
      entityId: partyId,
      status: helperStatus,
      // Verdict, flags and checks only: the identity (ID numbers) lives in kyc_runs.
      result: maskPii({ status, verdict: data?.verdict ?? null, flags: data?.flags ?? [], checks: data?.checks ?? [] }),
      reasons: maskPii(reasons),
      modelTag: deps.llm.visionModelName ?? null,
      promptVersion: KYC_PROMPT_VERSION,
      rulesVersion: deal.rulesVersion,
      kycConfigVersion: cfg.version,
      amlPolicyVersion: aml.version,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    const runId = newId();
    await tx.db.insert(kycRuns).values({
      id: runId,
      dealId,
      partyId,
      role: member.role as KycRunRole,
      configScope: cfg.scope,
      configVersion: cfg.version,
      status,
      flags: data?.flags ?? [],
      identity: data?.identity ?? {},
      answers,
      validUntil: data
        ? earliest(data.identity.idExpiresOn, data.identity.passportExpiresOn, data.identity.visaExpiresOn)
        : null,
      docsHash,
      runId: helperRunId,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "KYC_RUN",
      actor,
      rulesVersion: deal.rulesVersion,
      payload: {
        partyId,
        runId,
        role: member.role,
        status,
        configScope: cfg.scope,
        configVersion: cfg.version,
        flags: data?.flags.length ?? 0,
      },
    });
    // Review mode (S59): a pass waits for a person's "looks right" before it counts. Anything else has its usual gate.
    if (status === "passed")
      await afterHelperResult(ctx, tx, { helper: "spa_kyc", scope: "*", dealId, runId: helperRunId, status: "ok" });
    if (status === "review")
      await proposeApproval(
        ctx,
        {
          gate: "kyc_review",
          entity: { kind: "deal", id: dealId },
          dedupeKey: `${runId}:kyc_review`,
          title: `KYC review: ${member.name}`,
          proposal: {
            partyId,
            kycRunId: runId,
            flags: (data?.flags ?? []).map((f) => ({ kind: f.kind, message: f.message })),
          },
          reasons: maskPii(reasons),
          proposedBy: actor,
        },
        tx,
      );
    return { runId, status, created: true };
  });
}

/** Each buyer, seller and beneficial owner's latest KYC run for a deal, without ID numbers (staff view). */
export async function listKycRuns(ctx: SpaContext, dealId: string, user: Person) {
  need(user, "see KYC results");
  const db = ctx.database.db;
  const [d] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const list = await dealKycParties(db, dealId);
  const requests = await db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId));
  const out = [];
  for (const p of list) {
    const [run] = await db
      .select()
      .from(kycRuns)
      .where(and(eq(kycRuns.dealId, dealId), eq(kycRuns.partyId, p.partyId)))
      .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id))
      .limit(1);
    out.push({
      partyId: p.partyId,
      name: p.name,
      role: p.role,
      requested: requests.some((r) => r.partyId === p.partyId),
      runId: run?.id ?? null,
      status: run?.status ?? null,
      configScope: run?.configScope ?? null,
      configVersion: run?.configVersion ?? null,
      validUntil: run?.validUntil ?? null,
      flags: ((run?.flags ?? []) as { kind: string; message: string; blocking: boolean; check?: string }[]).map(
        (f) => ({
          kind: f.kind,
          message: maskPiiText(f.message),
          blocking: f.blocking,
          ...(f.check ? { check: f.check } : {}),
        }),
      ),
    });
  }
  return { parties: out };
}
