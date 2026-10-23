import { InboundType, newId, type StaffRole } from "@leasing/core";
import { approvals, documents, leases, sriAverages, sriOverrides, tasks, withTx } from "@leasing/db";
import { and, asc, eq, inArray, like } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, notFound } from "../errors.ts";
import { advance } from "../manager/advance.ts";
import { appendEvent } from "../manager/events.ts";
import { effectiveProposal, RenewalNoticeProposal } from "../manager/gate-rules.ts";
import { isTenancyType } from "../manager/tenancy-inbound.ts";
import { receiveInbound } from "../manager/inbound.ts";
import { draftRenewalNotice, renewalCycleKey } from "../manager/milestones.ts";
import { noticeSentForTerm, renewableApproval } from "../manager/outbound.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const LEASING: StaffRole[] = ["leasing_officer", "leasing_manager"];
const actorOf = (c: { get(k: "user"): { id: string } }) => `user:${c.get("user").id}` as const;

export function registerRenewalRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  /** Staff record a tenant's answer given by phone or in person; same pipeline, channel "staff". */
  api.post("/leases/:id/inbound", async (c) => {
    requireRole(c.get("user"), LEASING);
    const body = z.object({ type: InboundType, payload: z.unknown() }).parse(await c.req.json());
    const r = await withTx(ctx.database, async (tx) => {
      const [lease] = await tx.db
        .select()
        .from(leases)
        .where(eq(leases.id, c.req.param("id")));
      if (!lease) throw notFound("lease");
      // Tenancy forms (report an issue, payment reply, move-in report, move-out) and a notice to
      // vacate given another way don't need a renewal notice.
      if (isTenancyType(body.type) || body.type === "VACATE_NOTICE") {
        return receiveInbound(ctx, tx, {
          type: body.type,
          payload: body.payload,
          channel: "staff",
          actor: actorOf(c),
          entity: { kind: "lease", id: lease.id },
        });
      }
      const sent = await noticeSentForTerm(tx, lease);
      if (!sent) throw conflict("no renewal notice has been sent for this term yet");
      return receiveInbound(ctx, tx, {
        type: body.type,
        payload: body.payload,
        channel: "staff",
        actor: actorOf(c),
        entity: { kind: "lease", id: lease.id },
        ...(body.type === "NOTICE_ACKNOWLEDGED" ? { outboundMessageId: sent.id } : {}),
      });
    });
    if (r.duplicate) throw conflict(`already recorded (reference ${r.ref})`);
    return c.json(r, 202);
  });

  /**
   * Applies the renewal on the terms of the approved notice (RENEWED is gated on it and, for an
   * increase, on the notice having been sent by T−90).
   */
  api.post("/leases/:id/renew", async (c) => {
    requireRole(c.get("user"), LEASING);
    const id = c.req.param("id");
    const plan = await withTx(ctx.database, async (tx) => {
      const [lease] = await tx.db.select().from(leases).where(eq(leases.id, id));
      if (!lease) throw notFound("lease");
      const a = await renewableApproval(tx, lease);
      if (!a)
        throw conflict("there is no valid renewal notice for this term (an increase must have been sent in time)");
      const p = RenewalNoticeProposal.parse(effectiveProposal(a));
      return { approvalId: a.id, p, leaseId: lease.id };
    });
    const r = await advance(ctx, { kind: "lease", id }, "RENEWED", {
      actor: actorOf(c),
      approvalId: plan.approvalId,
      payload: { startOn: plan.p.newTermStartOn, endOn: plan.p.newTermEndOn, annualRentFils: plan.p.proposedRentFils },
    });
    await db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.entityId, id), inArray(tasks.kind, ["renewal_accepted"]), eq(tasks.status, "open")));
    return c.json(r);
  });

  api.get("/sri", async (c) =>
    c.json(await db.select().from(sriAverages).orderBy(asc(sriAverages.community), asc(sriAverages.bedrooms))),
  );

  api.put("/sri", async (c) => {
    requireRole(c.get("user"), ["admin", "leasing_manager"]);
    const b = z
      .object({
        community: z.string().trim().min(1).max(120),
        bedrooms: z.number().int().min(0).max(10),
        avgAnnualRentFils: z.number().int().positive().max(100_000_000_00),
      })
      .parse(await c.req.json());
    const today = ctx.clock.today();
    const [row] = await db
      .insert(sriAverages)
      .values({ id: newId(), ...b, source: "manual", effectiveFrom: today, createdBy: actorOf(c) })
      .onConflictDoUpdate({
        target: [sriAverages.community, sriAverages.bedrooms, sriAverages.effectiveFrom],
        set: { avgAnnualRentFils: b.avgAnnualRentFils, source: "manual", createdBy: actorOf(c) },
      })
      .returning();
    return c.json(row);
  });

  /** A lease-specific SRI value (e.g. read from the DLD calculator). Re-drafts a pending notice. */
  api.post("/leases/:id/sri-override", async (c) => {
    requireRole(c.get("user"), LEASING);
    const b = z
      .object({
        avgAnnualRentFils: z.number().int().positive().max(100_000_000_00),
        reason: z.string().trim().min(3).max(300),
      })
      .parse(await c.req.json());
    const result = await withTx(ctx.database, async (tx) => {
      const [lease] = await tx.db
        .select()
        .from(leases)
        .where(eq(leases.id, c.req.param("id")))
        .for("update");
      if (!lease) throw notFound("lease");
      await tx.db.insert(sriOverrides).values({
        id: newId(),
        leaseId: lease.id,
        leaseEndOn: lease.endOn,
        ...b,
        enteredBy: actorOf(c),
        at: ctx.clock.now(),
      });
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: lease.id },
        type: "SRI_RECORDED",
        actor: actorOf(c),
        payload: { avgAnnualRentFils: b.avgAnnualRentFils, reason: b.reason, leaseEndOn: lease.endOn },
        rulesVersion: lease.rulesVersion,
      });
      if (lease.state !== "RENEWAL") return { redrafted: false, reason: "lease is not in its renewal window yet" };
      const revisions = await tx.db
        .select()
        .from(approvals)
        .where(like(approvals.dedupeKey, `${renewalCycleKey(lease.id, lease.endOn)}%`));
      if (revisions.some((a) => a.status === "approved" || a.status === "edited")) {
        return { redrafted: false, reason: "a notice is already approved for this term" };
      }
      for (const a of revisions.filter((x) => x.status === "pending")) {
        await tx.db
          .update(approvals)
          .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: "new SRI value recorded" })
          .where(eq(approvals.id, a.id));
        await appendEvent(tx, ctx, {
          entity: { kind: "lease", id: lease.id },
          type: "APPROVAL_CANCELLED",
          actor: actorOf(c),
          payload: { approvalId: a.id, gate: "renewal_notice", reason: "new SRI value recorded" },
          rulesVersion: lease.rulesVersion,
        });
      }
      await draftRenewalNotice(ctx, tx, lease, null);
      return { redrafted: true };
    });
    return c.json(result, 201);
  });

  /**
   * Generated lease documents. Notices and Ejari certificates: any staff role. Contracts carry the
   * tenant's ID numbers: leasing staff only, and every view is recorded on the lease.
   */
  api.get("/leases/:id/documents/:docId", async (c) => {
    const leaseId = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("id"));
    const docId = z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(c.req.param("docId"));
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, docId), eq(documents.leaseId, leaseId)));
    if (
      !doc ||
      !["renewal_notice", "contract", "contract_signed", "ejari_certificate", "deposit_statement"].includes(doc.kind)
    ) {
      throw notFound("document");
    }
    if (doc.kind === "contract" || doc.kind === "contract_signed") {
      requireRole(c.get("user"), LEASING);
      await withTx(ctx.database, (tx) =>
        appendEvent(tx, ctx, {
          entity: { kind: "lease", id: leaseId },
          type: "DOCUMENT_VIEWED",
          actor: `user:${c.get("user").id}`,
          payload: { documentId: doc.id, kind: doc.kind },
        }),
      );
    }
    const bytes = await ctx.documents.read(doc.path);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${doc.kind}-${doc.sha256.slice(0, 8)}.pdf"`,
      "cache-control": "private, no-store",
    });
  });
}
