import { type Actor, type Emirate, newId } from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import { companyClauses, companyContractTemplates, contractRules, documents, type Tx, withTx } from "@leasing/db";
import {
  ContractTemplateSchemas,
  contractTemplateHelper,
  hasValues,
  isPdf,
  templateParagraphs,
  unknownPlaceholders,
} from "@leasing/helpers";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import {
  CONTRACT_STRUCTURE_JOB,
  extractCompanyTemplate,
  linkSampleClauses,
  parseTemplate,
} from "./company-templates.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { replaceContractRule } from "./portfolio.ts";
import { failStructure } from "./company-templates.ts";
export { approvedClauses, resolveCompanyClauses } from "./clause-refs.ts";

/**
 * Contract AI (slice 3). An admin uploads a sample contract on a contract rule; the
 * `contract-template` helper proposes addendum clauses; each one is stored as `proposed` and an
 * admin approves (optionally with edited wording) or rejects it. Only approved clauses can be added
 * to a contract rule or to a contract addendum. No number in a contract ever comes from here: the
 * dates, rent, cheques and deposit are contract fields; a clause that mentions amounts or dates
 * is flagged by code and needs the admin to confirm they checked them.
 */
export const CONTRACT_TEMPLATE_JOB = "contract.template";
export { CONTRACT_STRUCTURE_JOB };
export const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
export const MAX_CLAUSE_TEXT = 1200;

type ClauseRow = typeof companyClauses.$inferSelect;

export const AUTO_APPROVE_ACTOR = "system:auto-approve" as const;
/** Categories an automatic approval never covers: they carry the tenant's money, exit or sub-letting rights. */
const NEVER_AUTO = new Set(["termination", "payment", "subletting"]);
/** A second guard on the wording itself: a clause that talks about these is never approved by a switch. */
const SENSITIVE_WORDS =
  /terminat|evict|vacate|notice period|rent|payment|pay\b|cheque|deposit|refund|fee|penalt|sub-?let|assign/i;

/** Valueless (by code), in a safe category, and not about money, exit or sub-letting in its words. */
export const autoApprovable = (c: { category: string; text: string; hasValues: boolean }): boolean =>
  !c.hasValues && !NEVER_AUTO.has(c.category) && !SENSITIVE_WORDS.test(c.text);

export type SampleStatus = "queued" | "done" | "failed" | "needs_human";
interface SampleMeta {
  ruleId: string;
  companyId: string;
  status: SampleStatus;
  reasons: string[];
  clauseCount: number;
  /** 1 for the first reading; a retry of a failed or stuck reading adds one. Part of the job's singletonKey. */
  attempt: number;
  /** When the reading was queued (Clock), so a stuck "queued" can be told apart from a running one. */
  queuedAt: string;
  /** When the job actually began reading (Clock); absent while it still waits for the model. */
  startedAt?: string;
  /** The emirate the template read from this sample is for; absent or null = any emirate (D56). */
  emirate?: Emirate | null;
}

/** A reading still "queued" after this long is treated as stopped (the job ran out of retries or was lost). */
export const STUCK_AFTER_MS = 15 * 60 * 1000;
export const STUCK_REASON = "The reading job stopped; try again.";
/** A reading that started but has not finished after this long is stopped too (the job's own limit is shorter). */
export const RUNNING_STUCK_AFTER_MS = 30 * 60 * 1000;

/** The longest one clause-reading job may run: both helper attempts, each call limited by the model timeout. */
export const contractJobBudgetSeconds = (modelTimeoutSeconds: number) => modelTimeoutSeconds * 3 + 120;
/** pg-boss expiry for the clauses job: always after the code's own deadline, so the clear reason is stored first. */
export const contractJobExpireSeconds = (modelTimeoutSeconds: number) =>
  Math.max(900, contractJobBudgetSeconds(modelTimeoutSeconds) + 180);

const minutesBetween = (fromIso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60_000));

/** Waiting for the model (not started) or running (started), and for how many whole minutes. */
export function sampleProgress(
  m: Pick<SampleMeta, "status" | "queuedAt" | "startedAt">,
  now: Date,
): { phase: "waiting" | "running"; minutes: number } | null {
  if (m.status !== "queued") return null;
  return m.startedAt
    ? { phase: "running", minutes: minutesBetween(m.startedAt, now) }
    : { phase: "waiting", minutes: minutesBetween(m.queuedAt, now) };
}

const timeoutReason = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  return `Timed out after ${minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${seconds} s`} waiting for the model; try again.`;
};

/** Stores the real reason a reading failed (job error, timeout or expiry) so the sample stops showing "queued". */
export async function failSample(ctx: EngineContext, documentId: string, reason: string): Promise<boolean> {
  return withTx(ctx.database, async (tx) => {
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, documentId)).for("update");
    const m = doc?.extracted as SampleMeta | undefined;
    if (!doc || doc.kind !== "contract_sample" || !m || m.status !== "queued") return false;
    await tx.db
      .update(documents)
      .set({ extracted: { ...m, status: "failed", reasons: [reason] } satisfies SampleMeta })
      .where(eq(documents.id, documentId));
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: m.companyId },
      type: "COMPANY_CLAUSES_PROPOSED",
      actor: "helper:contract_template",
      payload: { documentId, status: "failed", proposed: 0, autoApproved: 0, dropped: 0, reason },
      rulesVersion: ctx.rulesVersion,
    });
    return true;
  });
}

/**
 * Job wrapper: the clauses reading with a hard deadline and an error catch, so a timeout or crash is stored
 * on the sample as `failed` with its reason. Set `budgetSeconds` below the pg-boss expiry.
 */
export async function runContractTemplateJob(ctx: EngineContext, documentId: string, modelTimeoutSeconds: number) {
  const budget = contractJobBudgetSeconds(modelTimeoutSeconds);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runContractTemplate(ctx, documentId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobDeadline(budget)), budget * 1000);
      }),
    ]);
  } catch (e) {
    const reason =
      e instanceof JobDeadline
        ? timeoutReason(budget)
        : `The reading failed: ${e instanceof Error ? e.message : String(e)}`;
    await failSample(ctx, documentId, reason);
    return { skipped: false as const, status: "failed" as const, proposed: 0 };
  } finally {
    clearTimeout(timer);
  }
}

class JobDeadline extends Error {
  constructor(readonly seconds: number) {
    super("job deadline");
  }
}

const MODEL_TIMEOUT_RE = /did not answer within (\d+) s/;

/** Stores the sample (content-addressed), pins it on a new row of the rule, and queues the helper. */
export async function uploadSample(
  ctx: EngineContext,
  ruleId: string,
  bytes: Uint8Array,
  actor: Actor,
  emirate: Emirate | null = null,
) {
  if (bytes.byteLength > MAX_SAMPLE_BYTES) throw unprocessable("The file is larger than 10 MB.", [], "too_big");
  if (!isPdf(bytes)) throw unprocessable("Upload a PDF file.", [], "not_pdf");
  const sha256 = sha256Hex(bytes);
  const [rule] = await ctx.database.db.select().from(contractRules).where(eq(contractRules.id, ruleId));
  if (!rule) throw notFound("contract rule");
  if (!rule.active) throw conflict("contract rule is no longer active", "rule_inactive");
  if (rule.sampleDocumentId) {
    const [prev] = await ctx.database.db.select().from(documents).where(eq(documents.id, rule.sampleDocumentId));
    // The same file for another emirate is a new upload (it makes a template for that emirate).
    if (prev?.sha256 === sha256 && ((prev.extracted as SampleMeta).emirate ?? null) === emirate) {
      // Same file: nothing to do unless the last reading failed, then it is read again.
      const m = prev.extracted as SampleMeta;
      if (m.status !== "failed" && m.status !== "needs_human") {
        return { duplicate: true as const, ruleId: rule.id, documentId: prev.id };
      }
      return requeueSample(ctx, prev.id, rule.id, actor);
    }
  }
  const stored = await ctx.documents.put(bytes, "pdf");
  return withTx(ctx.database, async (tx) => {
    const documentId = newId();
    const meta: SampleMeta = {
      ruleId: "",
      companyId: rule.companyId,
      status: "queued",
      reasons: [],
      clauseCount: 0,
      attempt: 1,
      queuedAt: ctx.clock.now().toISOString(),
      emirate,
    };
    await tx.db.insert(documents).values({
      id: documentId,
      kind: "contract_sample",
      sha256: stored.sha256,
      path: stored.path,
      mime: "application/pdf",
      bytes: stored.bytes,
      uploadedBy: actor,
      extracted: meta,
    });
    // The rule keeps its company template while that is still approved (a retired one can't be carried).
    const [tpl] = rule.templateId
      ? await tx.db
          .select({ status: companyContractTemplates.status })
          .from(companyContractTemplates)
          .where(eq(companyContractTemplates.id, rule.templateId))
      : [];
    const carriedTemplateId = tpl?.status === "approved" ? rule.templateId : null;
    const next = await replaceContractRule(
      ctx,
      tx,
      rule.id,
      {
        category: rule.category,
        subtype: rule.subtype,
        tenures: rule.tenures,
        minCheques: rule.minCheques,
        maxCheques: rule.maxCheques,
        clauseIds: rule.clauseIds,
        sampleDocumentId: documentId,
        templateId: carriedTemplateId,
      },
      actor,
    );
    await tx.db
      .update(documents)
      .set({ extracted: { ...meta, ruleId: next.id } satisfies SampleMeta })
      .where(eq(documents.id, documentId));
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: rule.companyId },
      type: "CONTRACT_SAMPLE_UPLOADED",
      actor,
      payload: { ruleId: next.id, documentId, sha256: stored.sha256, bytes: stored.bytes, emirate },
      rulesVersion: ctx.rulesVersion,
    });
    await ctx.scheduler.send(tx, {
      name: CONTRACT_TEMPLATE_JOB,
      data: { documentId },
      singletonKey: `${documentId}:1`,
    });
    // The same sample is also read for its structure, blanks and look (slice 4). Always queued, for every
    // company: it only stores a `proposed` template version, which is never used until an admin approves it,
    // so no 'has an approved template' check is needed (simpler, and a re-upload then makes the next version).
    await ctx.scheduler.send(tx, {
      name: CONTRACT_STRUCTURE_JOB,
      data: { documentId },
      singletonKey: `${documentId}:1`,
    });
    return { duplicate: false as const, ruleId: next.id, documentId };
  });
}

/** "Try again" on a failed or needs_human reading: queues the stored file again, no re-upload. */
export async function retrySample(ctx: EngineContext, ruleId: string, actor: Actor) {
  const [rule] = await ctx.database.db.select().from(contractRules).where(eq(contractRules.id, ruleId));
  if (!rule) throw notFound("contract rule");
  if (!rule.sampleDocumentId) throw conflict("This rule has no sample contract.", "no_sample");
  const [doc] = await ctx.database.db.select().from(documents).where(eq(documents.id, rule.sampleDocumentId));
  const status = (doc?.extracted as SampleMeta | undefined)?.status;
  if (status !== "failed" && status !== "needs_human") {
    throw conflict("Only a reading that failed can be tried again.", "not_failed");
  }
  return requeueSample(ctx, rule.sampleDocumentId, rule.id, actor);
}

/** Reads the same stored file again after a failed or stuck reading: fresh attempt number, fresh job key. */
async function requeueSample(ctx: EngineContext, documentId: string, ruleId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, documentId)).for("update");
    const m = doc?.extracted as SampleMeta | undefined;
    if (!doc || !m) throw notFound("sample document");
    if (m.status === "queued") return { duplicate: true as const, ruleId, documentId };
    const attempt = (m.attempt ?? 1) + 1;
    const next: SampleMeta = {
      ...m,
      ruleId,
      status: "queued",
      reasons: [],
      clauseCount: 0,
      attempt,
      queuedAt: ctx.clock.now().toISOString(),
    };
    delete next.startedAt;
    await tx.db.update(documents).set({ extracted: next }).where(eq(documents.id, documentId));
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: m.companyId },
      type: "CONTRACT_SAMPLE_RETRIED",
      actor,
      payload: { ruleId, documentId, attempt },
      rulesVersion: ctx.rulesVersion,
    });
    await ctx.scheduler.send(tx, {
      name: CONTRACT_TEMPLATE_JOB,
      data: { documentId },
      singletonKey: `${documentId}:${attempt}`,
    });
    // Skipped by the job when a template was already made from this sample.
    await ctx.scheduler.send(tx, {
      name: CONTRACT_STRUCTURE_JOB,
      data: { documentId },
      singletonKey: `${documentId}:${attempt}`,
    });
    return { duplicate: false as const, retry: true as const, ruleId, documentId };
  });
}

/** Job: reads the sample with the helper and stores its proposals. Safe to run twice. */
export async function runContractTemplate(ctx: EngineContext, documentId: string) {
  const [doc] = await ctx.database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.kind !== "contract_sample") throw notFound("sample document");
  const meta = doc.extracted as SampleMeta;
  if (meta.status !== "queued") return { skipped: true as const };
  if (!meta.startedAt) {
    // Only a queued sample is stamped; the guard keeps a late job from touching a decided one.
    const startedAt = ctx.clock.now().toISOString();
    await ctx.database.db
      .update(documents)
      .set({ extracted: { ...meta, startedAt } satisfies SampleMeta })
      .where(and(eq(documents.id, documentId), sql`${documents.extracted}->>'status' = 'queued'`));
    meta.startedAt = startedAt;
  }
  const helperRunId = newId();
  const entity = { kind: "company" as const, id: meta.companyId };
  const helper = contractTemplateHelper(ctx.contractAiLlm ?? ctx.llm, {
    readFile: async (id) => {
      if (id !== doc.id) throw new Error("unexpected document");
      return new Uint8Array(await ctx.documents.read(doc.path));
    },
  });
  const run = await runOnly(
    ctx,
    helper,
    ContractTemplateSchemas,
    entity,
    "extract_clauses",
    { source: { kind: "pdf", docId: doc.id } },
    ctx.rulesVersion,
    helperRunId,
  );
  return withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(documents).where(eq(documents.id, documentId)).for("update");
    if ((locked?.extracted as SampleMeta | undefined)?.status !== "queued") return { skipped: true as const };
    await recordRun(ctx, tx, helper.name, entity, ctx.rulesVersion, run, helperRunId);
    const data = run.result.status === "ok" ? run.result.data : undefined;
    let status: SampleStatus = run.result.status === "ok" ? "done" : run.result.status;
    let reasons = run.result.status === "ok" ? [] : run.result.reasons;
    const timedOut = run.result.status === "ok" ? null : MODEL_TIMEOUT_RE.exec(run.error ?? "");
    if (timedOut) {
      // The runner turns a model timeout into a generic needs_human; say what really happened.
      status = "failed";
      reasons = [timeoutReason(Number(timedOut[1]))];
    }
    if (status === "done" && !data) status = "failed";
    let count = 0;
    let autoApproved = 0;
    const autoOn = (await getCompanyPolicy(tx, ctx.clock.today())).autopilot.contract_ai_auto_approve_valueless;
    if (data) {
      for (const c of data.clauses) {
        const values = hasValues(c.text);
        // `contract_ai_auto_approve_valueless` (D37): only a clause with no amount, date or period (judged by
        // code), outside termination, payment and subletting. Everything else waits for an admin.
        const auto = autoOn && autoApprovable({ category: c.category, text: c.text, hasValues: values });
        const clauseId = newId();
        await tx.db.insert(companyClauses).values({
          id: clauseId,
          companyId: meta.companyId,
          contractRuleId: meta.ruleId,
          title: c.title,
          textEn: c.text,
          quote: c.quote,
          category: c.category,
          hasValues: values,
          status: auto ? "approved" : "proposed",
          sourceDocumentId: doc.id,
          helperRunId,
          createdBy: "helper:contract_template",
          createdAt: ctx.clock.now(),
          ...(auto ? { approvedBy: AUTO_APPROVE_ACTOR, approvedAt: ctx.clock.now() } : {}),
        });
        if (auto) {
          autoApproved++;
          await appendEvent(tx, ctx, {
            entity,
            type: "COMPANY_CLAUSE_APPROVED",
            actor: AUTO_APPROVE_ACTOR,
            payload: {
              clauseId,
              edited: false,
              hasValues: false,
              valuesConfirmed: false,
              autoApproved: true,
              category: c.category,
              helperRunId,
              approvedSha256: sha256Hex(c.text),
            },
            rulesVersion: ctx.rulesVersion,
          });
        }
        count++;
      }
    }
    await tx.db
      .update(documents)
      .set({ extracted: { ...meta, status, reasons, clauseCount: count } satisfies SampleMeta })
      .where(eq(documents.id, documentId));
    await appendEvent(tx, ctx, {
      entity,
      type: "COMPANY_CLAUSES_PROPOSED",
      actor: "helper:contract_template",
      payload: { documentId, helperRunId, status, proposed: count, autoApproved, dropped: data?.droppedCount ?? 0 },
      rulesVersion: ctx.rulesVersion,
    });
    // D47: if the template from this sample is already read, link the clauses to its paragraphs now.
    if (count) {
      await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`template:${meta.companyId}`}))`);
      await linkSampleClauses(ctx, tx, meta.companyId, doc.id);
    }
    return { skipped: false as const, status, proposed: count };
  });
}

/** Job `contract.structure`: reads the sample's structure, blanks and look into a proposed template version. */
export async function runContractStructure(ctx: EngineContext, documentId: string, force = false) {
  const [doc] = await ctx.database.db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.kind !== "contract_sample") throw notFound("sample document");
  const meta = doc.extracted as SampleMeta;
  return extractCompanyTemplate(ctx, { companyId: meta.companyId, sampleDocumentId: documentId, force });
}

/**
 * The structure job with a deadline: reading the template makes up to three model calls (sections, then two rounds of
 * blank mapping), and the runner may run it twice. Past the budget, or on an error, the reason is stored as a failed
 * run so the panel shows it at once (and "Try again" works), instead of a silent "stopped" much later.
 */
export async function runContractStructureJob(
  ctx: EngineContext,
  documentId: string,
  force: boolean,
  modelTimeoutSeconds: number,
  /** Tests only: a shorter deadline. */
  budget = contractJobBudgetSeconds(modelTimeoutSeconds),
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runContractStructure(ctx, documentId, force),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobDeadline(budget)), budget * 1000);
      }),
    ]);
  } catch (e) {
    const reason =
      e instanceof JobDeadline
        ? timeoutReason(budget)
        : `The reading failed: ${e instanceof Error ? e.message : String(e)}`;
    await failStructure(ctx, documentId, reason);
    return { skipped: false as const, status: "failed" as const, reasons: [reason], templateId: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface ClauseDecision {
  decision: "approve" | "reject";
  confirmValues?: true | undefined;
  editedText?: string | undefined;
}

/** An admin approves (with the wording as proposed or edited) or rejects one proposed clause. */
export async function decideClause(ctx: EngineContext, clauseId: string, d: ClauseDecision, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [c] = await tx.db.select().from(companyClauses).where(eq(companyClauses.id, clauseId)).for("update");
    if (!c) throw notFound("clause");
    if (c.status !== "proposed") throw conflict(`This clause is already ${c.status}.`, "already_decided");
    const entity = { kind: "company" as const, id: c.companyId };
    if (d.decision === "reject") {
      const [row] = await tx.db
        .update(companyClauses)
        .set({ status: "rejected", approvedBy: null, approvedAt: null })
        .where(eq(companyClauses.id, c.id))
        .returning();
      await appendEvent(tx, ctx, {
        entity,
        type: "COMPANY_CLAUSE_REJECTED",
        actor,
        payload: { clauseId: c.id, helperRunId: c.helperRunId, textSha256: sha256Hex(c.textEn) },
        rulesVersion: ctx.rulesVersion,
      });
      return row!;
    }
    const edited = d.editedText !== undefined && d.editedText.trim() !== c.textEn;
    const text = (d.editedText ?? c.textEn).trim();
    if (text.length < 1 || text.length > MAX_CLAUSE_TEXT) {
      throw unprocessable(`The clause text must be 1 to ${MAX_CLAUSE_TEXT} characters.`, [], "bad_text");
    }
    // Code decides whether the (possibly edited) text carries values; the client's word is never taken.
    const values = hasValues(text);
    if (values && d.confirmValues !== true) {
      throw unprocessable(
        "This clause includes amounts or dates. Check them and confirm before approving.",
        [],
        "confirm_values",
      );
    }
    const [row] = await tx.db
      .update(companyClauses)
      .set({
        status: "approved",
        textEn: text,
        hasValues: values,
        approvedBy: actor,
        approvedAt: ctx.clock.now(),
      })
      .where(eq(companyClauses.id, c.id))
      .returning();
    await appendEvent(tx, ctx, {
      entity,
      type: "COMPANY_CLAUSE_APPROVED",
      actor,
      payload: {
        clauseId: c.id,
        edited,
        hasValues: values,
        valuesConfirmed: values,
        helperRunId: c.helperRunId,
        originalSha256: sha256Hex(c.textEn),
        approvedSha256: sha256Hex(text),
      },
      rulesVersion: ctx.rulesVersion,
    });
    return row!;
  });
}

export interface AddClauseInput {
  title: string;
  text: string;
  category?: string | undefined;
  /** Active contract rules of the same company that get the clause (each as a new rule version). */
  ruleIds?: string[] | undefined;
  confirmValues?: true | undefined;
}

/**
 * A clause written by an admin (settings or an explicit copilot request): approved as it is saved, since the person
 * writing it is the one approving it. Amounts or dates in the text (found by code) need `confirmValues`.
 */
export async function addCompanyClause(
  ctx: EngineContext,
  tx: Tx,
  companyId: string,
  input: AddClauseInput,
  actor: Actor,
) {
  const title = input.title.trim();
  const text = input.text.trim();
  if (title.length < 1 || title.length > 120)
    throw unprocessable("The clause title must be 1 to 120 characters.", [], "bad_title");
  if (text.length < 1 || text.length > MAX_CLAUSE_TEXT) {
    throw unprocessable(`The clause text must be 1 to ${MAX_CLAUSE_TEXT} characters.`, [], "bad_text");
  }
  const values = hasValues(text);
  if (values && input.confirmValues !== true) {
    throw unprocessable(
      "This clause includes amounts or dates. Check them and confirm before saving.",
      [],
      "confirm_values",
    );
  }
  const ruleIds = [...new Set(input.ruleIds ?? [])];
  const rules = ruleIds.length
    ? await tx.db.select().from(contractRules).where(inArray(contractRules.id, ruleIds)).for("update")
    : [];
  const bad = ruleIds.filter((id) => !rules.some((r) => r.id === id && r.companyId === companyId && r.active));
  if (bad.length) throw unprocessable("Each rule must be an active contract rule of this company.", bad, "bad_rule");
  const id = newId();
  const [row] = await tx.db
    .insert(companyClauses)
    .values({
      id,
      companyId,
      title,
      textEn: text,
      category: input.category ?? "other",
      hasValues: values,
      status: "approved",
      approvedBy: actor,
      approvedAt: ctx.clock.now(),
      createdBy: actor,
    })
    .returning();
  for (const r of rules) {
    await replaceContractRule(
      ctx,
      tx,
      r.id,
      {
        category: r.category,
        subtype: r.subtype,
        tenures: r.tenures,
        minCheques: r.minCheques,
        maxCheques: r.maxCheques,
        clauseIds: [...r.clauseIds, `cc:${id}`],
        sampleDocumentId: r.sampleDocumentId,
      },
      actor,
    );
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "company", id: companyId },
    type: "COMPANY_CLAUSE_ADDED",
    actor,
    payload: { clauseId: id, textSha256: sha256Hex(text), hasValues: values, ruleIds },
    rulesVersion: ctx.rulesVersion,
  });
  return row!;
}

/**
 * A proposed or approved clause, locked for an edit or removal by an admin. A clause linked to a template paragraph
 * (D47) is editable: the paragraph prints its wording. Only an older clause approved into a template's fixed wording
 * without a link can't change here.
 */
async function editableClause(tx: Tx, clauseId: string) {
  const [c] = await tx.db.select().from(companyClauses).where(eq(companyClauses.id, clauseId)).for("update");
  if (!c) throw notFound("clause");
  if (c.status !== "approved" && c.status !== "proposed") throw conflict(`This clause is ${c.status}.`, "not_editable");
  if (c.inTemplateId && !c.templateParagraphKey && c.status === "approved")
    throw conflict(
      "This clause is part of an older template's fixed wording. Upload the sample again to edit it.",
      "in_template",
    );
  return c;
}

export interface EditClauseInput {
  title?: string | undefined;
  text?: string | undefined;
  confirmValues?: true | undefined;
}

/**
 * Changes an approved clause's title or wording (admin, any time). Contracts prepared from now on use the new
 * wording; prepared ones show "rules changed" (the config hash covers clause text). Signed contracts keep their PDF.
 */
export async function editCompanyClause(ctx: EngineContext, clauseId: string, input: EditClauseInput, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const c = await editableClause(tx, clauseId);
    const title = (input.title ?? c.title).trim();
    const text = (input.text ?? c.textEn).trim();
    if (title.length < 1 || title.length > 120)
      throw unprocessable("The clause title must be 1 to 120 characters.", [], "bad_title");
    if (text.length < 1 || text.length > MAX_CLAUSE_TEXT) {
      throw unprocessable(`The clause text must be 1 to ${MAX_CLAUSE_TEXT} characters.`, [], "bad_text");
    }
    if (c.templateParagraphKey && c.inTemplateId) {
      // A linked clause prints in its template paragraph: a [field] must be one of that paragraph's blanks.
      const [row] = await tx.db
        .select()
        .from(companyContractTemplates)
        .where(eq(companyContractTemplates.id, c.inTemplateId));
      if (row) {
        const t = parseTemplate(row);
        const raw = templateParagraphs(t.sections).find((p) => p.key === c.templateParagraphKey)?.text ?? "";
        const unknown = unknownPlaceholders(text, raw, t.blanks);
        if (unknown.length) {
          throw unprocessable(
            "Words in [brackets] are filled from the records and must name a field from the template's Fields list. These don't; correct the name or remove the brackets.",
            unknown,
            "unknown_field",
          );
        }
      }
    }
    const values = hasValues(text);
    if (values && text !== c.textEn && input.confirmValues !== true) {
      throw unprocessable(
        "This clause includes amounts or dates. Check them and confirm before saving.",
        [],
        "confirm_values",
      );
    }
    const [row] = await tx.db
      .update(companyClauses)
      .set({
        title,
        textEn: text,
        hasValues: values,
        ...(c.status === "approved" ? { approvedBy: actor, approvedAt: ctx.clock.now() } : {}),
      })
      .where(eq(companyClauses.id, c.id))
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: c.companyId },
      type: "COMPANY_CLAUSE_EDITED",
      actor,
      // The earlier wording is the company's own text: kept so the change can be read back.
      payload: {
        clauseId: c.id,
        before: { title: c.title, text: c.textEn },
        after: { title, text },
        hasValues: values,
      },
      rulesVersion: ctx.rulesVersion,
    });
    return row!;
  });
}

/**
 * Takes an approved clause out (admin, any time): it leaves every active contract rule of the company (each gets a
 * new version) and is no longer used in contracts prepared from now on. The row stays, marked `removed`, for audit.
 */
export async function removeCompanyClause(ctx: EngineContext, clauseId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const c = await editableClause(tx, clauseId);
    const ref = `cc:${c.id}`;
    const rules = await tx.db
      .select()
      .from(contractRules)
      .where(and(eq(contractRules.companyId, c.companyId), eq(contractRules.active, true)))
      .for("update");
    const using = rules.filter((r) => r.clauseIds.includes(ref));
    // Still waiting for approval: simply not approved. Approved: kept for the audit trail as removed.
    await tx.db
      .update(companyClauses)
      .set({ status: c.status === "proposed" ? "rejected" : "removed" })
      .where(eq(companyClauses.id, c.id));
    for (const r of using) {
      await replaceContractRule(
        ctx,
        tx,
        r.id,
        {
          category: r.category,
          subtype: r.subtype,
          tenures: r.tenures,
          minCheques: r.minCheques,
          maxCheques: r.maxCheques,
          clauseIds: r.clauseIds.filter((x) => x !== ref),
          sampleDocumentId: r.sampleDocumentId,
        },
        actor,
      );
    }
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: c.companyId },
      type: "COMPANY_CLAUSE_REMOVED",
      actor,
      payload: { clauseId: c.id, title: c.title, textSha256: sha256Hex(c.textEn), ruleIds: using.map((r) => r.id) },
      rulesVersion: ctx.rulesVersion,
    });
    return { removed: true as const, ruleIds: using.map((r) => r.id) };
  });
}

/**
 * Which of the company's active contract rules include an approved clause (D47 rule ticks). Each rule whose membership
 * changes gets a new version, audited; the clause itself doesn't change.
 */
export async function setClauseRules(ctx: EngineContext, clauseId: string, ruleIds: string[], actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [c] = await tx.db.select().from(companyClauses).where(eq(companyClauses.id, clauseId)).for("update");
    if (!c) throw notFound("clause");
    if (c.status !== "approved") throw conflict("Approve the clause first.", "not_approved");
    const ref = `cc:${c.id}` as const;
    const rules = await tx.db
      .select()
      .from(contractRules)
      .where(and(eq(contractRules.companyId, c.companyId), eq(contractRules.active, true)))
      .for("update");
    const want = new Set(ruleIds);
    const bad = ruleIds.filter((id) => !rules.some((r) => r.id === id));
    if (bad.length) throw unprocessable("Each rule must be an active contract rule of this company.", bad, "bad_rule");
    const changed: string[] = [];
    for (const r of rules) {
      const has = r.clauseIds.includes(ref);
      if (has === want.has(r.id)) continue;
      await replaceContractRule(
        ctx,
        tx,
        r.id,
        {
          category: r.category,
          subtype: r.subtype,
          tenures: r.tenures,
          minCheques: r.minCheques,
          maxCheques: r.maxCheques,
          clauseIds: has ? r.clauseIds.filter((x) => x !== ref) : [...r.clauseIds, ref],
          sampleDocumentId: r.sampleDocumentId,
        },
        actor,
      );
      changed.push(r.id);
    }
    if (changed.length) {
      await appendEvent(tx, ctx, {
        entity: { kind: "company", id: c.companyId },
        type: "COMPANY_CLAUSE_RULES_SET",
        actor,
        payload: { clauseId: c.id, ruleIds: [...want], changed },
        rulesVersion: ctx.rulesVersion,
      });
    }
    return { changed: changed.length };
  });
}

/** A company's approved clauses, split into those inside its template's wording and the additional ones. */
export async function companyClauseList(ctx: EngineContext, companyId: string) {
  const rows = await ctx.database.db
    .select()
    .from(companyClauses)
    .where(and(eq(companyClauses.companyId, companyId), eq(companyClauses.status, "approved")))
    .orderBy(asc(companyClauses.createdAt), asc(companyClauses.id));
  // D47: one list, each clause with the active rules that include it.
  const rules = await ctx.database.db
    .select({ id: contractRules.id, clauseIds: contractRules.clauseIds })
    .from(contractRules)
    .where(and(eq(contractRules.companyId, companyId), eq(contractRules.active, true)));
  const withRules = (r: ClauseRow) => ({
    ...clauseView(r),
    ruleIds: rules.filter((x) => x.clauseIds.includes(`cc:${r.id}`)).map((x) => x.id),
  });
  return {
    clauses: rows.map(withRules),
    inTemplate: rows.filter((r) => r.inTemplateId).map(withRules),
    additional: rows.filter((r) => !r.inTemplateId).map(withRules),
  };
}

/** The rule's own id and every older row it replaced (clauses stay tied to the row they were uploaded on). */
async function ruleChain(db: EngineContext["database"]["db"], ruleId: string): Promise<string[]> {
  const ids: string[] = [];
  let next: string | null = ruleId;
  while (next && !ids.includes(next) && ids.length < 200) {
    ids.push(next);
    const [r]: { supersedesId: string | null }[] = await db
      .select({ supersedesId: contractRules.supersedesId })
      .from(contractRules)
      .where(eq(contractRules.id, next));
    next = r?.supersedesId ?? null;
  }
  return ids;
}

/** The sample's reading status and the proposals for a contract rule (any staff may read). */
export async function ruleClauseReview(ctx: EngineContext, ruleId: string) {
  const db = ctx.database.db;
  const [rule] = await db.select().from(contractRules).where(eq(contractRules.id, ruleId));
  if (!rule) throw notFound("contract rule");
  const chain = await ruleChain(db, ruleId);
  const rows = await db
    .select()
    .from(companyClauses)
    .where(and(eq(companyClauses.companyId, rule.companyId), inArray(companyClauses.contractRuleId, chain)))
    .orderBy(asc(companyClauses.createdAt), asc(companyClauses.id));
  let sample: {
    documentId: string;
    status: SampleStatus;
    reasons: string[];
    clauseCount: number;
    phase: "waiting" | "running" | null;
    minutes: number | null;
    /** The company template made from this same sample is already there (proposed or approved). */
    templateReady: boolean;
  } | null = null;
  if (rule.sampleDocumentId) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, rule.sampleDocumentId));
    let m = doc?.extracted as SampleMeta | undefined;
    const stuckSince = m?.startedAt ? Date.parse(m.startedAt) : m ? Date.parse(m.queuedAt) : 0;
    const stuckAfter = m?.startedAt ? RUNNING_STUCK_AFTER_MS : STUCK_AFTER_MS;
    if (doc && m?.status === "queued" && ctx.clock.now().getTime() - stuckSince > stuckAfter) {
      // Simplest guard against a reading stuck in "queued" (job lost or out of retries): the first read after
      // 15 minutes (Clock) marks it failed, so the page offers "Try again". The job skips a non-queued sample.
      const failed: SampleMeta = { ...m, status: "failed", reasons: [STUCK_REASON] };
      const done = await db
        .update(documents)
        .set({ extracted: failed })
        .where(and(eq(documents.id, doc.id), sql`${documents.extracted}->>'status' = 'queued'`))
        .returning({ id: documents.id });
      if (done.length) m = failed;
    }
    if (doc && m) {
      const progress = sampleProgress(m, ctx.clock.now());
      const [tpl] = await db
        .select({ id: companyContractTemplates.id })
        .from(companyContractTemplates)
        .where(
          and(
            eq(companyContractTemplates.sampleDocumentId, doc.id),
            inArray(companyContractTemplates.status, ["proposed", "approved"]),
          ),
        )
        .limit(1);
      sample = {
        documentId: doc.id,
        status: m.status,
        reasons: m.reasons,
        clauseCount: m.clauseCount,
        phase: progress?.phase ?? null,
        minutes: progress?.minutes ?? null,
        templateReady: !!tpl,
      };
    }
  }
  return { sample, clauses: rows.map(clauseView) };
}

export const clauseView = (c: ClauseRow) => ({
  id: c.id,
  ref: `cc:${c.id}`,
  title: c.title,
  text: c.textEn,
  quote: c.quote,
  category: c.category,
  hasValues: c.hasValues,
  status: c.status,
  /** D47: linked to a template paragraph (prints there); `[label]` in the text are fields filled from records. */
  fromTemplate: c.templateParagraphKey !== null,
  /** Older clause approved into a template's fixed wording without a link: not editable here. */
  locked: c.inTemplateId !== null && c.templateParagraphKey === null,
  sourceDocumentId: c.sourceDocumentId,
  approvedBy: c.approvedBy,
  approvedAt: c.approvedAt,
  createdAt: c.createdAt,
});
