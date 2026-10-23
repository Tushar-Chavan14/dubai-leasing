import { formatAed, type StaffRole } from "@leasing/core";
import { documents, leases, payments, withTx } from "@leasing/db";
import { and, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound, unprocessable } from "../errors.ts";
import {
  FORMAL_PROPOSER_ROLES,
  leasePayments,
  PAYMENT_ROLES,
  recordPayment,
  requestFormalReminder,
} from "../manager/collections.ts";
import { leaseComplaints, resolveComplaint, ticketBoard, updateTicket } from "../manager/complaints.ts";
import { appendEvent, leaseRulesVersion } from "../manager/events.ts";
import { addApprovalNote, approvalNotesFor, getOwnDraft, sendStaffEmail } from "../manager/staff-messages.ts";
import { completeTask, createStaffTask, proposeVacateNotice, recordLandlordAnswer } from "../manager/task-actions.ts";
import {
  addConditionPhoto,
  completeMoveIn,
  moveInStatus,
  removeConditionPhoto,
  tickMoveInItem,
} from "../manager/move-in.ts";
import { advance } from "../manager/advance.ts";
import { receiveInbound } from "../manager/inbound.ts";
import { buildCasePack, viewCaseIndex } from "../manager/case-pack.ts";
import { completeMoveOut, recordRefundPaid, refundAccount, reissueStatement } from "../manager/deposit.ts";
import {
  addFinding,
  addMoveOutPhoto,
  bookInspection,
  moveOutStatus,
  removeFinding,
  removeMoveOutPhoto,
  requestComparison,
  tickMoveOutItem,
} from "../manager/move-out.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const LEASING: StaffRole[] = ["leasing_officer", "leasing_manager"];
const uuid = (v: string | undefined) => z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(v);
const PHOTO_KINDS = ["condition_photo", "tenant_condition_photo", "payment_proof", "issue_photo", "move_out_photo"];

/**
 * Staff routes for the tenancy (phase 3): the move-in checklist (step 7) and rent payments
 * (step 8). Any staff role reads; leasing staff run the move-in; finance (or a leasing manager)
 * confirms payments; the formal reminder is only proposed here and approved in the inbox.
 */
export function registerTenancyRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  // --- move-in ---
  api.get("/leases/:id/move-in", async (c) =>
    c.json(await withTx(ctx.database, (tx) => moveInStatus(ctx, tx, uuid(c.req.param("id"))))),
  );
  api.post("/leases/:id/move-in/items/:item", async (c) => {
    requireRole(c.get("user"), LEASING);
    const { done } = z.object({ done: z.boolean() }).parse(await c.req.json());
    return c.json(await tickMoveInItem(ctx, uuid(c.req.param("id")), c.req.param("item"), done, c.get("user")));
  });
  api.post(
    "/leases/:id/move-in/photos",
    bodyLimit({
      maxSize: 11 * 1024 * 1024,
      onError: (cc) => cc.json({ error: "the photo is larger than 10 MB" }, 413),
    }),
    async (c) => {
      requireRole(c.get("user"), LEASING);
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw unprocessable("attach a photo as `file`", [], "invalid_request");
      const room = z.string().trim().min(1).max(60).parse(form.get("room"));
      const r = await addConditionPhoto(
        ctx,
        uuid(c.req.param("id")),
        room,
        new Uint8Array(await file.arrayBuffer()),
        c.get("user"),
      );
      return c.json(r, 201);
    },
  );
  api.delete("/leases/:id/move-in/photos/:docId", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await removeConditionPhoto(ctx, uuid(c.req.param("id")), uuid(c.req.param("docId")), c.get("user")));
  });
  api.post("/leases/:id/move-in/complete", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await completeMoveIn(ctx, uuid(c.req.param("id")), `user:${c.get("user").id}`));
  });

  // --- move-out (step 10) ---
  api.get("/leases/:id/move-out", async (c) =>
    c.json(await withTx(ctx.database, (tx) => moveOutStatus(ctx, tx, uuid(c.req.param("id"))))),
  );
  api.post("/leases/:id/move-out/items/:item", async (c) => {
    requireRole(c.get("user"), LEASING);
    const { done } = z.object({ done: z.boolean() }).parse(await c.req.json());
    return c.json(await tickMoveOutItem(ctx, uuid(c.req.param("id")), c.req.param("item"), done, c.get("user")));
  });
  api.post(
    "/leases/:id/move-out/photos",
    bodyLimit({
      maxSize: 11 * 1024 * 1024,
      onError: (cc) => cc.json({ error: "the photo is larger than 10 MB" }, 413),
    }),
    async (c) => {
      requireRole(c.get("user"), LEASING);
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw unprocessable("attach a photo as `file`", [], "invalid_request");
      const room = z.string().trim().min(1).max(60).parse(form.get("room"));
      const r = await addMoveOutPhoto(
        ctx,
        uuid(c.req.param("id")),
        room,
        new Uint8Array(await file.arrayBuffer()),
        c.get("user"),
      );
      return c.json(r, 201);
    },
  );
  api.delete("/leases/:id/move-out/photos/:docId", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await removeMoveOutPhoto(ctx, uuid(c.req.param("id")), uuid(c.req.param("docId")), c.get("user")));
  });
  /** Staff book the inspection for the tenant (agreed by phone); same slots as the portal. */
  api.post("/leases/:id/move-out/booking", async (c) => {
    requireRole(c.get("user"), LEASING);
    const { slotAt } = z.object({ slotAt: z.iso.datetime({ offset: true }) }).parse(await c.req.json());
    const leaseId = uuid(c.req.param("id"));
    return c.json(
      await withTx(ctx.database, async (tx) => {
        const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
        if (!lease) throw notFound("lease");
        return bookInspection(ctx, tx, lease, new Date(slotAt), `user:${c.get("user").id}`);
      }),
    );
  });
  api.post("/leases/:id/move-out/compare", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await requestComparison(ctx, uuid(c.req.param("id")), c.get("user")), 202);
  });
  api.post("/leases/:id/move-out/findings", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await addFinding(ctx, uuid(c.req.param("id")), await c.req.json(), c.get("user")), 201);
  });
  api.delete("/leases/:id/move-out/findings/:findingId", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await removeFinding(ctx, uuid(c.req.param("id")), uuid(c.req.param("findingId")), c.get("user")));
  });
  api.post("/leases/:id/move-out/complete", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await completeMoveOut(ctx, uuid(c.req.param("id")), c.get("user")));
  });
  api.post("/leases/:id/deposit/reissue", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await reissueStatement(ctx, uuid(c.req.param("id")), c.get("user")), 201);
  });
  /** The tenant's refund account (finance only; each view recorded). */
  api.get("/leases/:id/deposit/refund-account", async (c) =>
    c.json(await refundAccount(ctx, c.get("user"), uuid(c.req.param("id")))),
  );
  /** Finance records the refund paid (finance acts on every refund); settles the deposit. */
  api.post("/leases/:id/deposit/refund-paid", async (c) =>
    c.json(await recordRefundPaid(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );

  // --- dispute (step 11, person-led): the case pack and the manager's open / resolve ---
  api.get("/leases/:id/case-pack", async (c) =>
    c.json(await viewCaseIndex(ctx, uuid(c.req.param("id")), c.get("user"))),
  );
  api.get("/leases/:id/case-pack.zip", async (c) => {
    const pack = await buildCasePack(ctx, uuid(c.req.param("id")), c.get("user"));
    return c.body(new Uint8Array(pack.zip), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${pack.filename}"`,
      "x-content-sha256": pack.sha256,
      "cache-control": "private, no-store",
    });
  });
  api.post("/leases/:id/dispute", async (c) => {
    requireRole(c.get("user"), ["leasing_manager"]);
    const { reason } = z.object({ reason: z.string().trim().min(5).max(2000) }).parse(await c.req.json());
    return c.json(
      await advance(ctx, { kind: "lease", id: uuid(c.req.param("id")) }, "DISPUTE_OPENED", {
        actor: `user:${c.get("user").id}`,
        payload: { reason },
      }),
    );
  });
  api.post("/leases/:id/dispute/resolve", async (c) => {
    requireRole(c.get("user"), ["leasing_manager"]);
    const { outcome, note } = z
      .object({ outcome: z.enum(["active", "move_out", "closed"]), note: z.string().trim().min(5).max(2000) })
      .parse(await c.req.json());
    const event =
      outcome === "active"
        ? "DISPUTE_RESOLVED_ACTIVE"
        : outcome === "move_out"
          ? "DISPUTE_RESOLVED_MOVE_OUT"
          : "DISPUTE_RESOLVED_CLOSED";
    return c.json(
      await advance(ctx, { kind: "lease", id: uuid(c.req.param("id")) }, event, {
        actor: `user:${c.get("user").id}`,
        payload: { note },
      }),
    );
  });

  /** A tenancy photo (condition, payment proof, issue): staff only; every view is recorded. */
  api.get("/leases/:id/photos/:docId", async (c) => {
    const leaseId = uuid(c.req.param("id"));
    const [doc] = await ctx.database.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, uuid(c.req.param("docId"))),
          eq(documents.leaseId, leaseId),
          inArray(documents.kind, PHOTO_KINDS),
        ),
      );
    if (!doc) throw notFound("photo");
    await withTx(ctx.database, async (tx) =>
      appendEvent(tx, ctx, {
        entity: { kind: "lease", id: leaseId },
        type: "DOCUMENT_VIEWED",
        actor: `user:${c.get("user").id}`,
        payload: { documentId: doc.id, kind: doc.kind },
        rulesVersion: await leaseRulesVersion(tx, leaseId),
      }),
    );
    const bytes = await ctx.uploads.read(doc.path);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": doc.mime ?? "image/jpeg",
      "cache-control": "private, no-store",
    });
  });

  // --- complaints and maintenance tickets ---
  api.get("/leases/:id/complaints", async (c) =>
    c.json(await withTx(ctx.database, (tx) => leaseComplaints(tx, uuid(c.req.param("id"))))),
  );
  api.post("/complaints/:id/resolve", async (c) =>
    c.json(await resolveComplaint(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );
  api.get("/tickets", async (c) => {
    const now = ctx.clock.now().getTime();
    const rows = await withTx(ctx.database, (tx) => ticketBoard(tx));
    return c.json(rows.map((r) => ({ ...r, late: r.ticket.dueBy.getTime() < now })));
  });
  api.patch("/tickets/:id", async (c) =>
    c.json(await updateTicket(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );

  // --- tasks, the landlord's answer, the 12-month notice ---
  api.post("/tasks", async (c) => {
    const user = c.get("user");
    return c.json(await createStaffTask(ctx, `user:${user.id}`, user.role, await c.req.json()), 201);
  });
  api.post("/tasks/:id/done", async (c) => {
    const { note } = z
      .object({ note: z.string().trim().max(2000).optional() })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await completeTask(ctx, c.get("user"), uuid(c.req.param("id")), note));
  });
  api.post("/tasks/:id/landlord-answer", async (c) =>
    c.json(await recordLandlordAnswer(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );
  api.post("/leases/:id/vacate-notice", async (c) => {
    const user = c.get("user");
    return c.json(
      await proposeVacateNotice(ctx, `user:${user.id}`, user.role, uuid(c.req.param("id")), await c.req.json()),
      201,
    );
  });

  // --- people's own text: email the tenant, notes on an approval, copilot drafts to prefill ---
  api.post("/leases/:id/email", async (c) =>
    c.json(await sendStaffEmail(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );
  api.get("/approvals/:id/notes", async (c) => c.json(await approvalNotesFor(ctx, uuid(c.req.param("id")))));
  api.post("/approvals/:id/notes", async (c) =>
    c.json(await addApprovalNote(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json()), 201),
  );
  api.get("/copilot/drafts/:id", async (c) => {
    const d = await getOwnDraft(ctx, c.get("user"), uuid(c.req.param("id")));
    if (!d) throw notFound("draft");
    return c.json(d);
  });

  // --- payments ---
  api.get("/leases/:id/payments", async (c) => {
    const rows = await withTx(ctx.database, (tx) => leasePayments(tx, uuid(c.req.param("id"))));
    return c.json(rows.map((p) => ({ ...p, amount: formatAed(p.amountFils) })));
  });
  api.post("/payments/:id/record", async (c) =>
    c.json(await recordPayment(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );
  api.post("/payments/:id/formal-reminder", async (c) => {
    requireRole(c.get("user"), FORMAL_PROPOSER_ROLES);
    return c.json(
      await requestFormalReminder(ctx, uuid(c.req.param("id")), `user:${c.get("user").id}`, c.get("user").role),
      201,
    );
  });
}

/** Demo console helpers (demo mode only): the next open cheque of a lease, bounced or paid. */
export function registerTenancyDemoRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const next = async (leaseRef: string) => {
    const [lease] = await ctx.database.db.select().from(leases).where(eq(leases.ref, leaseRef));
    if (!lease) throw notFound("lease");
    const rows = await withTx(ctx.database, (tx) => leasePayments(tx, lease.id));
    const today = ctx.clock.today();
    const p = rows.find((r) => (r.status === "scheduled" || r.status === "overdue") && r.dueOn <= today);
    if (!p) throw unprocessable("no cheque is due yet on this lease: fast-forward to a due date first", [], "none_due");
    return p;
  };
  // Step 10 demo: the tenant gives notice to move out at the lease end (recorded on their behalf).
  api.post("/demo/move-out/notice", async (c) => {
    requireRole(c.get("user"), LEASING);
    const { leaseRef } = z.object({ leaseRef: z.string().min(2) }).parse(await c.req.json());
    const [lease] = await ctx.database.db.select().from(leases).where(eq(leases.ref, leaseRef));
    if (!lease) throw notFound("lease");
    const r = await withTx(ctx.database, (tx) =>
      receiveInbound(ctx, tx, {
        type: "VACATE_NOTICE",
        payload: { moveOutOn: lease.endOn, confirmVacate: true },
        channel: "staff",
        actor: `user:${c.get("user").id}`,
        entity: { kind: "lease", id: lease.id },
      }),
    );
    return c.json({ ref: r.ref, leaseId: lease.id, moveOutOn: lease.endOn }, 202);
  });
  // Same roles as the Payments panel: finance confirms every payment (D27), admin doesn't.
  api.post("/demo/payments/bounce", async (c) => {
    requireRole(c.get("user"), PAYMENT_ROLES);
    const { leaseRef } = z.object({ leaseRef: z.string().min(2) }).parse(await c.req.json());
    const p = await next(leaseRef);
    return c.json({
      paymentId: p.id,
      seq: p.seq,
      ...(await recordPayment(ctx, c.get("user"), p.id, { outcome: "bounced", note: "demo console" })),
    });
  });
  api.post("/demo/payments/pay", async (c) => {
    requireRole(c.get("user"), PAYMENT_ROLES);
    const { leaseRef } = z.object({ leaseRef: z.string().min(2) }).parse(await c.req.json());
    const [lease] = await ctx.database.db.select().from(leases).where(eq(leases.ref, leaseRef));
    if (!lease) throw notFound("lease");
    const [p] = await ctx.database.db
      .select()
      .from(payments)
      .where(and(eq(payments.leaseId, lease.id), inArray(payments.status, ["scheduled", "overdue", "bounced"])))
      .orderBy(payments.seq)
      .limit(1);
    if (!p) throw unprocessable("nothing left to pay on this lease", [], "none_due");
    return c.json({
      paymentId: p.id,
      seq: p.seq,
      ...(await recordPayment(ctx, c.get("user"), p.id, {
        outcome: "paid",
        paidOn: ctx.clock.today(),
        ref: "demo console",
      })),
    });
  });
}
