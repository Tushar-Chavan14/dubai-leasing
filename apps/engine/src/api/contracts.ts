import { Addendum, maskPii, registrationSystemName, type StaffRole } from "@leasing/core";
import { contracts, contractSigners, ejariSubmissions, leases, tasks, units } from "@leasing/db";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { approvedClauses } from "../manager/clause-refs.ts";
import {
  contractConfigHash,
  defaultAddendumFor,
  prepareContract,
  reprepareContract,
  resendSignLink,
} from "../manager/contracts.ts";
import { reproposeEjariSubmission } from "../manager/registration.ts";
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
    .select({ companyId: units.companyId, emirate: units.emirate })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  const approved = lu ? await approvedClauses({ db }, lu.companyId) : [];
  const suggested = lu ? (await defaultAddendumFor({ db }, leaseId)).clauses : [];
  const emirate = lu?.emirate ?? "dubai";
  return {
    // The registration system of the unit's emirate (Ejari in Dubai) for headings and labels.
    registration: { emirate, systemName: registrationSystemName(emirate) },
    prepareNeeded: await prepareNeeded(db, leaseId, cs),
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
  };
}

/**
 * Staff routes for steps 5–6. Any staff role can read; leasing officers and managers act.
 * Approving the contract and the Ejari submission happens only in the approval inbox.
 */
export function registerContractRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  api.get("/leases/:id/contract", async (c) => c.json(await leaseContractView(db, uuid(c.req.param("id")))));

  /** Prepare a new contract version (re-issue): chosen clauses and optional free text. */
  api.post("/leases/:id/contract/prepare", async (c) => {
    requireRole(c.get("user"), LEASING);
    const addendum = Addendum.parse(await c.req.json());
    const r = await prepareContract(ctx, uuid(c.req.param("id")), { addendum, actor: actorOf(c) });
    return c.json(r, r.status === "prepared" ? 201 : 422);
  });

  api.post("/leases/:id/contract/reprepare", async (c) => {
    requireRole(c.get("user"), LEASING);
    const r = await reprepareContract(ctx, uuid(c.req.param("id")), actorOf(c));
    return c.json(r, r.status === "prepared" ? 201 : 422);
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
