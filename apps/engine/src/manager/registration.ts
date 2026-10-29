import { EjariUnavailableError } from "@leasing/adapters";
import {
  type Actor,
  compareNames,
  EJARI_AUTOFIXABLE,
  EJARI_FIELDS,
  type EjariAutofix,
  isCalendarDate,
  type EjariPayload,
  maskPiiText,
  newId,
} from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  applications,
  approvals,
  documents,
  ejariSubmissions,
  leaseEvents,
  leaseParties,
  leases,
  parties,
  tasks,
  type Tx,
  withTx,
} from "@leasing/db";
import { buildEjariPayload, RegistrationSchemas, registrationHelper } from "@leasing/helpers";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { advance } from "./advance.ts";
import { requestApproval } from "./approvals.ts";
import { signedContract } from "./contracts.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { effectiveProposal, type EjariRejectedProposal, EjariSubmissionProposal } from "./gate-rules.ts";
import { runAndRecord } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import { createTask } from "./milestones.ts";

/**
 * Step 6 (architecture §3 Lease: REGISTRATION). The payload is built from the signed contract
 * only; an officer approves the submission (`ejari_submission`); a job sends it. Issued →
 * EJARI_ISSUED (consumes the approval) → MOVE_IN. Rejected → the Registration helper may make
 * one typo-class name fix from a verified source and resubmit once under the same approval;
 * anything else, or a second rejection, goes to a person (`ejari_rejected_twice`).
 */
export const EJARI_SUBMIT_JOB = "ejari.submit";
export const EJARI_REVIEW_JOB = "ejari.review";

type LeaseRow = typeof leases.$inferSelect;
type SubmissionRow = typeof ejariSubmissions.$inferSelect;

const payloadHash = (p: EjariPayload) => sha256Hex(JSON.stringify(p));

/** Proposes an Ejari submission from the signed contract (on entering REGISTRATION, or after a person retries). */
export async function proposeEjariSubmission(ctx: EngineContext, tx: Tx, lease: LeaseRow, actor: Actor) {
  const contract = await signedContract(tx, lease.id);
  if (!contract?.signedSha256) throw conflict("The lease has no signed contract to register.", "no_contract");
  const built = buildEjariPayload(contract.fields);
  if (!built.ok) {
    await createTask(ctx, tx, lease.id, {
      kind: "ejari_payload_incomplete",
      title: `Ejari submission for ${lease.ref} can't be built: ${built.problems.join("; ")}`,
      details: { contractId: contract.id, problems: built.problems },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:ejari_payload_incomplete:${contract.id}`,
    });
    return null;
  }
  const open = await tx.db
    .select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.entityId, lease.id), eq(approvals.gate, "ejari_submission")));
  if (open.some((a) => a.status === "pending")) throw conflict("An Ejari submission is already waiting for approval.");
  const proposal: EjariSubmissionProposal = {
    leaseId: lease.id,
    leaseRef: lease.ref,
    contractId: contract.id,
    signedSha256: contract.signedSha256,
    payload: built.payload,
    payloadSha256: payloadHash(built.payload),
  };
  // The officer task raised when `ejari_draft_auto` is off is done once the draft exists.
  await tx.db
    .update(tasks)
    .set({ status: "done" })
    .where(and(eq(tasks.dedupeKey, `${lease.id}:draft_ejari_submission`), eq(tasks.status, "open")));
  return requestApproval(ctx, tx, {
    gate: "ejari_submission",
    entity: { kind: "lease", id: lease.id },
    dedupeKey: `${lease.id}:ejari_submission#${open.length + 1}`,
    title: `Submit ${lease.ref} to Ejari${ctx.demoMode ? " (simulated)" : ""}`,
    proposal,
    reasons: ["Every value is copied from the signed contract. Check it against the signed PDF before submitting."],
    sources: contract.signedDocumentId
      ? [
          {
            kind: "document",
            documentId: contract.signedDocumentId,
            label: `Signed contract, version ${contract.version}`,
          },
        ]
      : [],
    rulesVersion: lease.rulesVersion,
    proposedBy: actor,
  });
}

/** The officer decided an `ejari_submission` approval: approved → the first attempt is queued. */
export async function onEjariSubmissionDecided(
  ctx: EngineContext,
  tx: Tx,
  a: typeof approvals.$inferSelect,
  status: "approved" | "edited" | "rejected",
) {
  const p = EjariSubmissionProposal.parse(effectiveProposal(a));
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, p.leaseId)).for("update");
  if (!lease) throw notFound("lease");
  if (status === "rejected") {
    await createTask(ctx, tx, lease.id, {
      kind: "ejari_submission_rejected",
      title: `Ejari submission for ${lease.ref} was not approved${a.decisionNote ? `: ${a.decisionNote}` : ""}. Fix the cause and propose it again.`,
      details: { approvalId: a.id },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:ejari_submission_rejected:${a.id}`,
    });
    return;
  }
  if (lease.state !== "REGISTRATION") throw conflict(`The lease is in ${lease.state}, not REGISTRATION.`, "stale");
  const contract = await signedContract(tx, lease.id);
  const built = contract ? buildEjariPayload(contract.fields) : null;
  if (!contract || contract.id !== p.contractId || !built?.ok || payloadHash(built.payload) !== p.payloadSha256) {
    throw unprocessable("The signed contract no longer matches this submission. Propose it again.", [], "stale");
  }
  const submissionId = newId();
  await tx.db.insert(ejariSubmissions).values({
    id: submissionId,
    leaseId: lease.id,
    approvalId: a.id,
    attempt: 1,
    payload: built.payload,
    payloadSha256: p.payloadSha256,
    status: "queued",
    createdAt: ctx.clock.now(),
  });
  await queueSubmit(ctx, tx, lease.id, submissionId);
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "EJARI_SUBMISSION_QUEUED",
    actor: a.decidedBy ? `user:${a.decidedBy}` : "system",
    payload: { submissionId, approvalId: a.id, attempt: 1 },
    rulesVersion: lease.rulesVersion,
  });
}

async function queueSubmit(ctx: EngineContext, tx: Tx, leaseId: string, submissionId: string) {
  await ctx.scheduler.send(tx, {
    name: EJARI_SUBMIT_JOB,
    data: { submissionId },
    singletonKey: `${leaseId}:ejari-submit:${submissionId}`,
  });
}

/**
 * Sends one attempt to Ejari (job). The submission id is the request id, so a retry after a
 * crash gets the registry's first answer instead of registering twice. An unreachable registry
 * is retried (the job throws) up to the policy limit, then a person is told.
 */
export async function submitToEjari(ctx: EngineContext, submissionId: string) {
  const sub = await withTx(ctx.database, async (tx) => {
    const [s] = await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, submissionId)).for("update");
    if (!s || (s.status !== "queued" && s.status !== "sending")) return null;
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, s.leaseId));
    if (lease?.state !== "REGISTRATION") {
      await tx.db
        .update(ejariSubmissions)
        .set({ status: "error", error: `lease is in ${lease?.state ?? "?"}`, completedAt: ctx.clock.now() })
        .where(eq(ejariSubmissions.id, s.id));
      return null;
    }
    await tx.db.update(ejariSubmissions).set({ status: "sending" }).where(eq(ejariSubmissions.id, s.id));
    return s;
  });
  if (!sub) return { done: false as const };

  let result: Awaited<ReturnType<EngineContext["ejari"]["register"]>>;
  try {
    result = await ctx.ejari.register(sub.payload, { requestId: sub.id });
  } catch (e) {
    const unavailable = e instanceof EjariUnavailableError;
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    const giveUp = await withTx(ctx.database, async (tx) => {
      const max = (await getCompanyPolicy(tx, ctx.clock.today())).ejariMaxAttempts;
      const tries = sub.tries + 1;
      const final = !unavailable || tries >= max;
      await tx.db
        .update(ejariSubmissions)
        .set({ status: final ? "error" : "queued", tries, error, ...(final ? { completedAt: ctx.clock.now() } : {}) })
        .where(eq(ejariSubmissions.id, sub.id));
      if (final) {
        const [lease] = await tx.db.select().from(leases).where(eq(leases.id, sub.leaseId));
        await appendEvent(tx, ctx, {
          entity: { kind: "lease", id: sub.leaseId },
          type: "EJARI_SUBMISSION_FAILED",
          actor: "system",
          payload: { submissionId: sub.id, attempt: sub.attempt, tries, error },
        });
        await createTask(ctx, tx, sub.leaseId, {
          kind: "ejari_unreachable",
          title: `Ejari submission for ${lease?.ref ?? sub.leaseId} failed: ${error}. Check in the registry whether it was registered before proposing it again.`,
          details: { submissionId: sub.id, error },
          assigneeRole: "leasing_officer",
          dueOn: ctx.clock.today(),
          dedupeKey: `${sub.leaseId}:ejari_unreachable:${sub.id}`,
        });
      }
      return final;
    });
    if (giveUp) return { done: false as const, error };
    // pg-boss retries the job with backoff.
    throw new Error(`Ejari unavailable, will retry: ${error}`, { cause: e });
  }

  if (result.ok) {
    // The certificate is a convenience: if it can't be fetched now, staff can fetch it later.
    let certificate: Uint8Array | null = null;
    try {
      certificate = await ctx.ejari.certificate(result.ejariNo);
    } catch {
      certificate = null;
    }
    return withTx(ctx.database, async (tx) => recordIssued(ctx, tx, sub, result.ejariNo, result.issuedOn, certificate));
  }
  return withTx(ctx.database, async (tx) => {
    const [s] = await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, sub.id)).for("update");
    if (s?.status !== "sending") return { done: false as const };
    await tx.db
      .update(ejariSubmissions)
      .set({ status: "rejected", reasons: result.reasons, completedAt: ctx.clock.now() })
      .where(eq(ejariSubmissions.id, sub.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: sub.leaseId },
      type: "EJARI_REJECTED",
      actor: "system",
      payload: { submissionId: sub.id, attempt: sub.attempt, codes: result.reasons.map((r) => r.code) },
    });
    await ctx.scheduler.send(tx, {
      name: EJARI_REVIEW_JOB,
      data: { submissionId: sub.id },
      singletonKey: `${sub.leaseId}:ejari-review:${sub.id}`,
    });
    return { done: true as const, issued: false as const, reasons: result.reasons };
  });
}

async function recordIssued(
  ctx: EngineContext,
  tx: Tx,
  sub: SubmissionRow,
  ejariNo: string,
  registryIssuedOn: string,
  certificate: Uint8Array | null,
) {
  const [s] = await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, sub.id)).for("update");
  if (s?.status !== "sending") return { done: false as const };
  let certificateDocumentId: string | null = null;
  if (certificate) {
    const stored = await ctx.documents.put(certificate, "pdf");
    certificateDocumentId = newId();
    await tx.db.insert(documents).values({
      id: certificateDocumentId,
      leaseId: sub.leaseId,
      kind: "ejari_certificate",
      sha256: stored.sha256,
      path: stored.path,
      mime: "application/pdf",
      extracted: { ejariNo, simulated: ctx.demoMode },
    });
  }
  await tx.db
    .update(ejariSubmissions)
    .set({ status: "issued", ejariNo, certificateDocumentId, completedAt: ctx.clock.now() })
    .where(eq(ejariSubmissions.id, sub.id));
  // The lease records the engine's calendar date (the demo clock may run ahead of the registry's).
  await advance(ctx, { kind: "lease", id: sub.leaseId }, "EJARI_ISSUED", {
    actor: "system",
    approvalId: sub.approvalId,
    payload: {
      ejariNo,
      // Demo: the engine's calendar date (the demo clock may run ahead of the simulated registry).
      // Otherwise the registry's date. CONFIRM WITH LEGAL which date the lease should carry.
      issuedOn: ctx.demoMode || !isCalendarDate(registryIssuedOn) ? ctx.clock.today() : registryIssuedOn,
      registryIssuedOn,
      submissionId: sub.id,
      attempt: sub.attempt,
      simulated: ctx.demoMode,
    },
    tx,
  });
  if (!certificate) {
    await createTask(ctx, tx, sub.leaseId, {
      kind: "ejari_certificate_missing",
      title: `Ejari ${ejariNo} was issued but its certificate could not be downloaded: fetch it from the registry`,
      details: { submissionId: sub.id, ejariNo },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${sub.leaseId}:ejari_certificate_missing:${sub.id}`,
    });
  }
  await queueLeaseMail(ctx, tx, { leaseId: sub.leaseId, kind: "ejari_issued", key: sub.id, seq: 1 });
  return { done: true as const, issued: true as const, ejariNo };
}

/**
 * Re-sends the issued Ejari certificate email to the tenant's address on file (web chat status
 * check), at most once per Dubai day: an audit event under the lease's lock, and a day-specific
 * outbound milestone (the sequence number grows with each re-send).
 */
export async function resendEjariCertificate(
  ctx: EngineContext,
  leaseId: string,
  actor: Actor,
  inTx?: Tx,
): Promise<"queued" | "already_today" | "not_now"> {
  const run = async (tx: Tx): Promise<"queued" | "already_today" | "not_now"> => {
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (!lease) return "not_now";
    const [sub] = await tx.db
      .select()
      .from(ejariSubmissions)
      .where(and(eq(ejariSubmissions.leaseId, leaseId), eq(ejariSubmissions.status, "issued")))
      .orderBy(desc(ejariSubmissions.attempt))
      .limit(1);
    if (!sub?.ejariNo) return "not_now";
    const today = ctx.clock.today();
    const prior = await tx.db
      .select({ payload: leaseEvents.payload })
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, leaseId), eq(leaseEvents.type, "EJARI_CERTIFICATE_RESENT")));
    if (prior.some((e) => (e.payload as { on?: string }).on === today)) return "already_today";
    const seq = 2 + prior.length;
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "EJARI_CERTIFICATE_RESENT",
      actor,
      payload: { submissionId: sub.id, seq, on: today, via: "web_chat" },
    });
    await queueLeaseMail(ctx, tx, { leaseId, kind: "ejari_issued", key: sub.id, seq });
    return "queued";
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

/** Verified spellings of the name fields: the KYC-verified tenant party and the landlord party. */
async function verifiedNames(tx: Tx, lease: LeaseRow) {
  const people = await tx.db
    .select({ role: leaseParties.role, party: parties })
    .from(leaseParties)
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(eq(leaseParties.leaseId, lease.id));
  const [app] = lease.applicationId
    ? await tx.db.select().from(applications).where(eq(applications.id, lease.applicationId))
    : [];
  const tenant = people.find((p) => p.role === "tenant")?.party;
  return {
    // Only a KYC-verified name may be the base of a fix.
    tenantNameEn:
      tenant && app?.kycVerifiedAt
        ? [{ value: tenant.fullNameEn, source: `party:${tenant.id}:fullNameEn (KYC-verified)` }]
        : [],
    // The landlord's name is not checked by KYC, so it is never a source for a fix: a person decides.
    landlordNameEn: [],
  };
}

/**
 * After a rejection (job): the Registration helper maps it to fields and looks for a typo-class
 * fix. At most one corrected resubmission per approval; anything else goes to a person.
 */
export async function reviewEjariRejection(ctx: EngineContext, submissionId: string) {
  return withTx(ctx.database, async (tx) => {
    const [s] = await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, submissionId));
    if (s?.status !== "rejected") return { action: "none" as const };
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, s.leaseId));
    if (!lease || lease.state !== "REGISTRATION") return { action: "none" as const };
    const siblings = await tx.db
      .select()
      .from(ejariSubmissions)
      .where(eq(ejariSubmissions.approvalId, s.approvalId))
      .orderBy(asc(ejariSubmissions.attempt));
    // Already handled (a later attempt exists, or a person was already asked).
    if (siblings.some((x) => x.attempt > s.attempt)) return { action: "none" as const };
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    const { run, helperRunId } = await runAndRecord(
      ctx,
      tx,
      registrationHelper(ctx.llm),
      RegistrationSchemas,
      { kind: "lease", id: lease.id },
      "ejari_rejection",
      {
        payload: s.payload,
        rejections: s.reasons,
        attempt: s.attempt,
        verified: await verifiedNames(tx, lease),
        minConfidence: policy.ejariFieldMinConfidence,
      },
      lease.rulesVersion,
    );
    const data = run.result.status === "ok" ? run.result.data : undefined;
    if (data?.decision === "resubmit" && s.attempt === 1) {
      const fixed = applyFixes(s.payload, data.fixes);
      const nextId = newId();
      await tx.db.insert(ejariSubmissions).values({
        id: nextId,
        leaseId: lease.id,
        approvalId: s.approvalId,
        attempt: 2,
        payload: fixed,
        payloadSha256: payloadHash(fixed),
        status: "queued",
        autofix: data.fixes,
        createdAt: ctx.clock.now(),
      });
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: lease.id },
        type: "EJARI_AUTOFIX",
        actor: "helper:registration",
        payload: {
          fromSubmissionId: s.id,
          submissionId: nextId,
          helperRunId,
          fixes: data.fixes,
          // The signed contract keeps its text; the registration differs from it only by this correction.
          contractUnchanged: true,
        },
        rulesVersion: lease.rulesVersion,
      });
      await queueSubmit(ctx, tx, lease.id, nextId);
      return { action: "resubmitted" as const, submissionId: nextId, fixes: data.fixes };
    }
    const proposal: EjariRejectedProposal = {
      leaseId: lease.id,
      leaseRef: lease.ref,
      submissionApprovalId: s.approvalId,
      attempts: siblings.map((x) => ({
        submissionId: x.id,
        attempt: x.attempt,
        reasons: x.reasons,
        autofix: x.autofix ?? null,
      })),
      helperRunId,
      helperReasons: run.result.reasons,
    };
    const approval = await requestApproval(ctx, tx, {
      gate: "ejari_rejected_twice",
      entity: { kind: "lease", id: lease.id },
      dedupeKey: `${lease.id}:ejari_rejected:${s.approvalId}`,
      title: `Ejari rejected ${lease.ref}${s.attempt > 1 ? " twice" : ""}: decide how to proceed`,
      proposal,
      reasons: [...s.reasons.map((r) => `${r.code}: ${r.message}`), ...run.result.reasons],
      sources: [{ kind: "helper_run", helperRunId, label: "Registration helper run" }],
      rulesVersion: lease.rulesVersion,
      proposedBy: "helper:registration",
    });
    return { action: "person" as const, approvalId: approval.id };
  });
}

/** EJARI_ISSUED applies only to an issued submission of exactly this approval (checked in `advance`). */
export async function assertIssuedSubmission(
  tx: Tx,
  leaseId: string,
  approvalId: string,
  payload: Record<string, unknown>,
) {
  const id = typeof payload.submissionId === "string" ? payload.submissionId : null;
  const [s] = id ? await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, id)) : [];
  const ok =
    s && s.leaseId === leaseId && s.approvalId === approvalId && s.status === "issued" && s.ejariNo === payload.ejariNo;
  if (!ok)
    throw conflict("EJARI_ISSUED refused: no issued submission of this approval with that number", "gate_required");
}

/**
 * Applies the helper's fixes, refusing anything but a typo-class change of an auto-fixable name
 * field (defence in depth: the helper already promises this).
 */
export function applyFixes(payload: EjariPayload, fixes: EjariAutofix[]): EjariPayload {
  const next = { ...payload };
  for (const f of fixes) {
    if (!EJARI_AUTOFIXABLE.includes(f.field)) throw new Error(`${f.field} is never corrected automatically`);
    if (payload[f.field] !== f.from) throw new Error(`${f.field} fix doesn't start from the submitted value`);
    if (compareNames(f.from, f.to) !== "typo_class") throw new Error(`${f.field} fix is not a typo-class change`);
    next[f.field] = f.to;
  }
  for (const k of EJARI_FIELDS) {
    if (!EJARI_AUTOFIXABLE.includes(k) && next[k] !== payload[k]) throw new Error(`${k} changed`);
  }
  return next;
}

/**
 * A person decided `ejari_rejected_twice`. Approve: the cause is dealt with (say, the registry's
 * record was corrected) → a fresh submission from the signed contract is proposed, which needs
 * its own approval. Reject: a task to amend the contract or cancel.
 */
export async function onEjariRejectedDecided(
  ctx: EngineContext,
  tx: Tx,
  a: typeof approvals.$inferSelect,
  status: "approved" | "edited" | "rejected",
) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, a.entityId)).for("update");
  if (!lease) throw notFound("lease");
  if (status === "rejected") {
    await createTask(ctx, tx, lease.id, {
      kind: "ejari_blocked",
      title: `Ejari registration for ${lease.ref} is blocked: amend the contract (new version, signed again) or cancel the lease`,
      details: { approvalId: a.id, note: a.decisionNote },
      assigneeRole: "leasing_manager",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:ejari_blocked:${a.id}`,
    });
    return;
  }
  if (lease.state !== "REGISTRATION") throw conflict(`The lease is in ${lease.state}, not REGISTRATION.`, "stale");
  await proposeEjariSubmission(ctx, tx, lease, a.decidedBy ? `user:${a.decidedBy}` : "system");
}

/** Staff: propose the submission again (after a rejected approval or a failed send). */
export async function reproposeEjariSubmission(ctx: EngineContext, leaseId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (!lease) throw notFound("lease");
    if (lease.state !== "REGISTRATION") throw conflict(`The lease is in ${lease.state}, not REGISTRATION.`);
    const inFlight = await tx.db
      .select({ id: ejariSubmissions.id })
      .from(ejariSubmissions)
      .where(and(eq(ejariSubmissions.leaseId, leaseId), inArray(ejariSubmissions.status, ["queued", "sending"])));
    if (inFlight.length) throw conflict("A submission is already on its way to Ejari.");
    const r = await proposeEjariSubmission(ctx, tx, lease, actor);
    if (!r) throw unprocessable("The submission can't be built; see the task list.");
    return r;
  });
}
