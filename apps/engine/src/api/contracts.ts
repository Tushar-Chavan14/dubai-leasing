import { Addendum, maskPii, registrationSystemName, type StaffRole } from "@leasing/core";
import {
  contracts,
  contractSigners,
  ejariSubmissions,
  helperRuns,
  leaseEvents,
  leases,
  tasks,
  units,
  withTx,
} from "@leasing/db";
import { flatRenewalCapPercent, getRulebook } from "@leasing/rulebook";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { approvedClauses } from "../manager/clause-refs.ts";
import {
  CONTRACT_PREPARE_JOB,
  contractConfigHash,
  defaultAddendumFor,
  prepareContract,
  reprepareContract,
  resendSignLink,
} from "../manager/contracts.ts";
import { reproposeEjariSubmission } from "../manager/registration.ts";
import {
  approveChangeMarks,
  declineContractChange,
  leaseChangeRequests,
  officerMarkWording,
  previewChangeMarks,
  reissueFromChange,
} from "../manager/contract-changes.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const LEASING: StaffRole[] = ["leasing_officer", "leasing_manager"];
const actorOf = (c: { get(k: "user"): { id: string } }) => `user:${c.get("user").id}` as const;
const uuid = (v: string | undefined) => z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(v);

/**
 * Whether staff need to prepare the contract by hand (only then the panel shows the button): `failed` while the lease
 * waits in CONTRACT with no open contract or with a preparation task open; `rules_changed` when the pending
 * contract was prepared under a contract config that has since changed.
 */
/**
 * Why staff may need to prepare the contract by hand: `failed` (a preparation task is open), `rejected` (the last
 * version was not approved), `not_prepared` (nothing prepared yet: the job may still be queued), `rules_changed`
 * (the pending contract predates a contract config change). Null: nothing to do.
 */
export type PrepareNeeded = "failed" | "rejected" | "not_prepared" | "rules_changed" | null;
async function prepareNeeded(
  db: EngineContext["database"]["db"],
  leaseId: string,
  cs: (typeof contracts.$inferSelect)[],
): Promise<PrepareNeeded> {
  const [row] = await db
    .select({ lease: leases, unit: units })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  if (row?.lease.state !== "CONTRACT") return null;
  const open = cs.find((c) => c.status === "pending_approval" || c.status === "sent" || c.status === "signed");
  const [task] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.entityId, leaseId),
        eq(tasks.status, "open"),
        inArray(tasks.kind, ["contract_needs_person", "prepare_contract"]),
      ),
    )
    .limit(1);
  if (task && (!open || open.status === "pending_approval")) return "failed";
  if (!open) return cs[0]?.status === "rejected" ? "rejected" : "not_prepared";
  // Waiting for approval, or out for signing with nobody signed yet (D47): a config change offers "prepare again".
  if (open.status !== "pending_approval" && open.status !== "sent") return null;
  if (!open.configHash || open.configHash === (await contractConfigHash({ db }, row.unit))) return null;
  if (open.status === "sent") {
    const [signed] = await db
      .select({ id: contractSigners.id })
      .from(contractSigners)
      .where(and(eq(contractSigners.contractId, open.id), isNotNull(contractSigners.signedAt)))
      .limit(1);
    if (signed) return null;
  }
  return "rules_changed";
}

export type PreparingStatus = {
  state: "queued" | "running" | "retrying" | "failed";
  since: string;
  attempt: number;
  reason?: string;
  /** What a running preparation is doing, in plain words. */
  step?: string;
};

/** A preparation whose start marker is older than this is taken as abandoned (the engine restarted mid-run). */
const PREPARE_MARKER_MAX_MS = 15 * 60_000;

/**
 * The newest preparation run (in a request, a job or the copilot), from its CONTRACT_PREPARE_STARTED event: running
 * until something ends it (a contract, its helper run), or failed with the reason when a CONTRACT_PREPARE_FAILED
 * event (a failure, or a result a person must look at) or a new open needs-person task follows it.
 */
async function startedMarker(
  db: EngineContext["database"]["db"],
  leaseId: string,
  cs: (typeof contracts.$inferSelect)[],
): Promise<PreparingStatus | null> {
  const [started] = await db
    .select({ recordedAt: leaseEvents.recordedAt, at: leaseEvents.at, payload: leaseEvents.payload })
    .from(leaseEvents)
    .where(
      and(
        eq(leaseEvents.entityKind, "lease"),
        eq(leaseEvents.entityId, leaseId),
        eq(leaseEvents.type, "CONTRACT_PREPARE_STARTED"),
      ),
    )
    .orderBy(desc(leaseEvents.recordedAt))
    .limit(1);
  if (!started) return null;
  const t = started.recordedAt.getTime();
  if (cs.some((c) => c.createdAt.getTime() >= t)) return null; // it produced a version
  const [failed] = await db
    .select({ recordedAt: leaseEvents.recordedAt, payload: leaseEvents.payload })
    .from(leaseEvents)
    .where(
      and(
        eq(leaseEvents.entityKind, "lease"),
        eq(leaseEvents.entityId, leaseId),
        eq(leaseEvents.type, "CONTRACT_PREPARE_FAILED"),
        sql`${leaseEvents.recordedAt} >= ${started.recordedAt}`,
      ),
    )
    .orderBy(desc(leaseEvents.recordedAt))
    .limit(1);
  const failure = (since: Date, reason: unknown): PreparingStatus => ({
    state: "failed",
    since: since.toISOString(),
    attempt: 1,
    ...(typeof reason === "string" && reason ? { reason: reason.slice(0, 200) } : {}),
  });
  if (failed) return failure(failed.recordedAt, (failed.payload as { reason?: unknown }).reason);
  const [task] = await db
    .select({ details: tasks.details, createdAt: tasks.createdAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.entityId, leaseId),
        eq(tasks.status, "open"),
        eq(tasks.kind, "contract_needs_person"),
        sql`${tasks.createdAt} >= ${started.at}`,
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (task) {
    const d = task.details as { reason?: unknown; reasons?: unknown } | null;
    const reason = typeof d?.reason === "string" ? d.reason : Array.isArray(d?.reasons) ? d.reasons[0] : undefined;
    return failure(started.recordedAt, reason);
  }
  if (Date.now() - t > PREPARE_MARKER_MAX_MS) return null; // abandoned
  const runId = (started.payload as { helperRunId?: unknown }).helperRunId;
  if (typeof runId === "string") {
    const [run] = await db.select({ id: helperRuns.id }).from(helperRuns).where(eq(helperRuns.id, runId)).limit(1);
    if (run) return null;
  }
  return {
    state: "running",
    since: started.recordedAt.toISOString(),
    attempt: 1,
    step: "Reading the records and the template",
  };
}

/**
 * Where the automatic `contract.prepare` job for this lease stands, read from pg-boss (latest job). Only while the
 * lease has no contract. A job that ended without a contract (failed, or reported as a task) shows `failed` with
 * the officer task's reason. Null: no job, or nothing to show.
 */
export async function preparingStatus(
  db: EngineContext["database"]["db"],
  leaseId: string,
  cs: (typeof contracts.$inferSelect)[],
): Promise<PreparingStatus | null> {
  const [job, marker] = await Promise.all([jobStatus(db, leaseId, cs), startedMarker(db, leaseId, cs)]);
  // The newest signal wins.
  if (job && marker) return Date.parse(marker.since) >= Date.parse(job.since) ? marker : job;
  return marker ?? job;
}

async function jobStatus(
  db: EngineContext["database"]["db"],
  leaseId: string,
  cs: (typeof contracts.$inferSelect)[],
): Promise<PreparingStatus | null> {
  if (cs.length > 0) return null;
  let job:
    | {
        state: string;
        created_on: Date;
        started_on: Date | null;
        completed_on: Date | null;
        retry_count: number;
        output: unknown;
      }
    | undefined;
  try {
    const r = await db.execute<NonNullable<typeof job>>(
      sql`select state, created_on, started_on, completed_on, retry_count, output from pgboss.job
          where name = ${CONTRACT_PREPARE_JOB} and data->>'leaseId' = ${leaseId}
          order by created_on desc limit 1`,
    );
    job = r.rows[0];
  } catch {
    return null; // no pg-boss schema (tests without the queue)
  }
  if (!job) return null;
  const attempt = Number(job.retry_count) + 1;
  const iso = (d: Date | null, fallback: Date) => new Date(d ?? fallback).toISOString();
  if (job.state === "created") return { state: "queued", since: iso(null, job.created_on), attempt };
  if (job.state === "retry") return { state: "retrying", since: iso(null, job.created_on), attempt };
  if (job.state === "active") return { state: "running", since: iso(job.started_on, job.created_on), attempt };
  /** A raw job error as one plain sentence: a Zod issue list reads "the contract data didn't pass validation (…)". */
  const readableJobError = (msg: string): string => {
    try {
      const issues = JSON.parse(msg) as { path?: unknown[]; message?: string }[];
      if (Array.isArray(issues) && issues[0]?.message) {
        const where = issues[0].path?.length ? `${issues[0].path.join(".")}: ` : "";
        return `the contract data didn't pass validation (${where}${issues[0].message})`;
      }
    } catch {
      /* not JSON: use it as it is */
    }
    return msg.replace(/\s+/g, " ").trim();
  };
  const [task] = await db
    .select({ details: tasks.details })
    .from(tasks)
    .where(and(eq(tasks.entityId, leaseId), eq(tasks.status, "open"), eq(tasks.kind, "contract_needs_person")))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  const details = task?.details as { reason?: unknown; reasons?: unknown } | null | undefined;
  // The newest open task wins over an older failed job: its reason (or first reason) is what a person must fix.
  const taskReason =
    typeof details?.reason === "string"
      ? details.reason
      : Array.isArray(details?.reasons) && typeof details.reasons[0] === "string"
        ? details.reasons[0]
        : undefined;
  const outMsg = (job.output as { message?: unknown } | null)?.message;
  const reason =
    typeof taskReason === "string"
      ? taskReason
      : job.state === "failed" && typeof outMsg === "string"
        ? readableJobError(outMsg)
        : undefined;
  if (!task && job.state !== "failed") return null;
  return {
    state: "failed",
    since: iso(job.completed_on, job.created_on),
    attempt,
    ...(reason ? { reason: reason.slice(0, 200) } : {}),
  };
}

/** Contract versions with their signers, and Ejari attempts, for the lease page. ID numbers masked. */
export async function leaseContractView(db: EngineContext["database"]["db"], leaseId: string) {
  const [cs, subs] = await Promise.all([
    db.select().from(contracts).where(eq(contracts.leaseId, leaseId)).orderBy(desc(contracts.version)),
    db
      .select()
      .from(ejariSubmissions)
      .where(eq(ejariSubmissions.leaseId, leaseId))
      .orderBy(asc(ejariSubmissions.createdAt)),
  ]);
  const signers = cs.length
    ? await db
        .select()
        .from(contractSigners)
        .where(eq(contractSigners.contractId, cs[0]!.id))
        .orderBy(asc(contractSigners.role))
    : [];
  // What the prepare form offers: the unit's company clauses that are approved, and what the
  // matching contract rule preselects.
  const [lu] = await db
    .select({ companyId: units.companyId, emirate: units.emirate, rulesVersion: leases.rulesVersion })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  const approved = lu ? await approvedClauses({ db }, lu.companyId) : [];
  const suggested = lu ? (await defaultAddendumFor({ db }, leaseId)).clauses : [];
  const emirate = lu?.emirate ?? "dubai";
  // D75: a flat renewal cap needs no rent index value.
  const flatPct = lu ? flatRenewalCapPercent(getRulebook(lu.rulesVersion)) : null;
  return {
    renewalCap: { indexNeeded: flatPct === null, flatPercent: flatPct, rulesVersion: lu?.rulesVersion ?? null },
    // The registration system of the unit's emirate (Ejari in Dubai) for headings and labels.
    registration: { emirate, systemName: registrationSystemName(emirate) },
    prepareNeeded: await prepareNeeded(db, leaseId, cs),
    preparing: await preparingStatus(db, leaseId, cs),
    clauseOptions: {
      suggested,
      companyClauses: approved.map((c) => ({
        ref: `cc:${c.id}`,
        title: c.title,
        text: c.textEn,
        hasValues: c.hasValues,
      })),
    },
    contracts: cs.map((c, i) =>
      maskPii({
        id: c.id,
        version: c.version,
        status: c.status,
        fields: c.fields,
        sources: c.sources,
        addendum: c.addendum,
        flags: c.flags,
        templateRewrites: c.templateRewrites,
        sha256: c.sha256,
        signedSha256: c.signedSha256,
        approvalId: c.approvalId,
        helperRunId: c.helperRunId,
        documentId: c.documentId,
        signedDocumentId: c.signedDocumentId,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        sentAt: c.sentAt,
        signedAt: c.signedAt,
        signers:
          i === 0
            ? signers.map((s) => ({
                id: s.id,
                role: s.role,
                nameEn: s.nameEn,
                email: s.email,
                linkSent: !!s.outboundMessageId,
                signedAt: s.signedAt,
                typedName: s.typedName,
              }))
            : [],
      }),
    ),
    ejari: subs.map((s) =>
      maskPii({
        id: s.id,
        approvalId: s.approvalId,
        attempt: s.attempt,
        status: s.status,
        payload: s.payload,
        reasons: s.reasons,
        autofix: s.autofix,
        ejariNo: s.ejariNo,
        tries: s.tries,
        error: s.error,
        certificateDocumentId: s.certificateDocumentId,
        createdAt: s.createdAt,
        completedAt: s.completedAt,
      }),
    ),
    // D67: change requests from the signing pages (the text is the signer's own words: untrusted, shown as data).
    changeRequests: await leaseChangeRequests(db, leaseId),
  };
}

/**
 * Staff routes for steps 5–6. Any staff role can read; leasing officers and managers act.
 * Approving the contract and the Ejari submission happens only in the approval inbox.
 */
export function registerContractRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  const enqueuePrepare = async (leaseId: string, actor: string, job: { addendum?: Addendum; reprepare?: boolean }) => {
    const [lease] = await db.select({ state: leases.state }).from(leases).where(eq(leases.id, leaseId));
    if (!lease) return { status: 404 as const, body: { error: "not_found" } };
    if (lease.state !== "CONTRACT") {
      return {
        status: 409 as const,
        body: {
          error: "wrong_state",
          message: `The lease is in ${lease.state}; contracts are prepared while it is in CONTRACT.`,
        },
      };
    }
    // The clicking user rides in the job data so the audit trail names them (the worker re-checks its format).
    await withTx(ctx.database, (tx) =>
      ctx.scheduler.send(tx, {
        name: CONTRACT_PREPARE_JOB,
        data: { leaseId, actor, ...job },
        singletonKey: `${leaseId}:prepare`,
      }),
    );
    return { status: 202 as const, body: { status: "queued" } };
  };
  const queued = (
    c: { json(b: unknown, s: 202 | 404 | 409): Response },
    r: Awaited<ReturnType<typeof enqueuePrepare>>,
  ) => c.json(r.body, r.status);

  api.get("/leases/:id/contract", async (c) => c.json(await leaseContractView(db, uuid(c.req.param("id")))));

  /** Prepare a new contract version (re-issue): chosen clauses and optional free text. */
  api.post("/leases/:id/contract/prepare", async (c) => {
    requireRole(c.get("user"), LEASING);
    const addendum = Addendum.parse(await c.req.json());
    const r = await prepareContract(ctx, uuid(c.req.param("id")), { addendum, actor: actorOf(c) });
    return c.json(r, r.status === "prepared" ? 201 : 422);
  });

  /**
   * The panel's Prepare button: queues the preparation (the chosen addendum rides in the job data) and returns at
   * once; the contract view shows it as preparing until the worker is done.
   */
  api.post("/leases/:id/contract/prepare-async", async (c) => {
    requireRole(c.get("user"), LEASING);
    const addendum = Addendum.parse(await c.req.json());
    return queued(c, await enqueuePrepare(uuid(c.req.param("id")), actorOf(c), { addendum }));
  });

  /** "Prepare again": same clauses, current rule and template; queued like prepare-async. */
  api.post("/leases/:id/contract/reprepare-async", async (c) => {
    requireRole(c.get("user"), LEASING);
    return queued(c, await enqueuePrepare(uuid(c.req.param("id")), actorOf(c), { reprepare: true }));
  });

  api.post("/leases/:id/contract/reprepare", async (c) => {
    requireRole(c.get("user"), LEASING);
    const r = await reprepareContract(ctx, uuid(c.req.param("id")), actorOf(c));
    return c.json(r, r.status === "prepared" ? 201 : 422);
  });

  /** D67: a new version from a change request (AI draft or the officer's edit); it waits at `final_contract`. */
  api.post("/leases/:id/contract/change-requests/:requestId/reissue", async (c) => {
    requireRole(c.get("user"), LEASING);
    const r = await reissueFromChange(
      ctx,
      uuid(c.req.param("id")),
      uuid(c.req.param("requestId")),
      await c.req.json().catch(() => ({})),
      actorOf(c),
    );
    return c.json(r, r.status === "prepared" ? 201 : 422);
  });

  /** D67: keep the contract as it is; the note is emailed to the requester and signing reopens. */
  api.post("/leases/:id/contract/change-requests/:requestId/decline", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(
      await declineContractChange(
        ctx,
        uuid(c.req.param("id")),
        uuid(c.req.param("requestId")),
        await c.req.json(),
        actorOf(c),
      ),
    );
  });

  const markNo = (v: string | undefined) => z.coerce.number().int().min(1).max(20).catch(0).parse(v);

  /** Change marks: the officer's own wording for one mark; checked like the AI's. -> {n, rewrite, problems} */
  api.post("/leases/:id/contract/change-requests/:requestId/marks/:n/wording", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(
      await officerMarkWording(
        ctx,
        uuid(c.req.param("id")),
        uuid(c.req.param("requestId")),
        markNo(c.req.param("n")),
        await c.req.json().catch(() => ({})),
        actorOf(c),
      ),
    );
  });

  /** Change marks: the contract with the applied marks as a watermarked PDF; nothing is stored. */
  api.post("/leases/:id/contract/change-requests/:requestId/preview", async (c) => {
    requireRole(c.get("user"), LEASING);
    const pdf = await previewChangeMarks(
      ctx,
      uuid(c.req.param("id")),
      uuid(c.req.param("requestId")),
      await c.req.json().catch(() => ({})),
    );
    return c.body(new Uint8Array(pdf), 200, {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="contract-preview.pdf"',
      "cache-control": "private, no-store",
    });
  });

  /**
   * Change marks: approve. Nothing applied -> declined (200 {status:"declined", paused, version:null}); else the new
   * version is prepared and its final_contract approved as this officer (201 {status:"approved", version,
   * contractId, approvalId, paused:false}). 422 when a mark can't be applied or a contract check fails.
   */
  api.post("/leases/:id/contract/change-requests/:requestId/approve", async (c) => {
    requireRole(c.get("user"), LEASING);
    const r = await approveChangeMarks(
      ctx,
      uuid(c.req.param("id")),
      uuid(c.req.param("requestId")),
      await c.req.json().catch(() => ({})),
      c.get("user"),
    );
    return c.json(r, r.status === "approved" ? 201 : 200);
  });

  api.post("/leases/:id/contract/signers/:signerId/resend", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await resendSignLink(ctx, uuid(c.req.param("id")), uuid(c.req.param("signerId")), actorOf(c)));
  });

  api.post("/leases/:id/ejari/propose", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await reproposeEjariSubmission(ctx, uuid(c.req.param("id")), actorOf(c)), 201);
  });
}
