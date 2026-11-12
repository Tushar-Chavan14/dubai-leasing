import { calendarDate, parseAed, type StaffRole } from "@leasing/core";
import { ejariSubmissions, leases, withTx } from "@leasing/db";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound, unprocessable } from "../errors.ts";
import { appendEvent } from "../manager/events.ts";
import {
  MAX_CERTIFICATE_BYTES,
  openRegisterTask,
  recordManualIssued,
  recordManualRejected,
  registrationPack,
  registrationPackPdf,
} from "../manager/manual-registration.ts";
import { type AuthEnv, requireRole } from "./auth.ts";
import { readLimited } from "./upload.ts";

const LEASING: StaffRole[] = ["leasing_officer", "leasing_manager"];
const actorOf = (c: { get(k: "user"): { id: string } }) => `user:${c.get("user").id}` as const;
const uuid = (v: string | undefined) => z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(v);

const RecordFields = z.object({
  submissionId: z.uuid(),
  reference: z.string().trim().min(1).max(60),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  feePaidAed: z.string().trim().max(20).optional(),
});
const RejectedBody = z.strictObject({ submissionId: z.uuid(), reasons: z.string().trim().min(1).max(1000) });

/** Manual registration (D52): the pack, recording the portal's reference or rejection. LEASING roles only. */
export function registerRegistrationRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  api.get("/leases/:id/registration", async (c) => {
    requireRole(c.get("user"), LEASING);
    const leaseId = uuid(c.req.param("id"));
    return c.json(
      await withTx(ctx.database, async (tx) => {
        const pack = await registrationPack(tx, ctx, leaseId);
        const subs = await tx.db
          .select()
          .from(ejariSubmissions)
          .where(eq(ejariSubmissions.leaseId, leaseId))
          .orderBy(desc(ejariSubmissions.createdAt));
        return {
          mode: pack.registration.mode,
          registration: pack.registration,
          pack,
          openTaskId: await openRegisterTask(tx, leaseId),
          submissions: subs.map((s) => ({
            id: s.id,
            attempt: s.attempt,
            mode: s.mode,
            status: s.status,
            reference: s.ejariNo,
            reasons: s.reasons,
            feePaidFils: s.feePaidFils,
            recordedBy: s.recordedBy,
            certificateDocumentId: s.certificateDocumentId,
            createdAt: s.createdAt,
            completedAt: s.completedAt,
          })),
        };
      }),
    );
  });

  api.get("/leases/:id/registration/pack.pdf", async (c) => {
    requireRole(c.get("user"), LEASING);
    const leaseId = uuid(c.req.param("id"));
    const bytes = await withTx(ctx.database, async (tx) => {
      const [lease] = await tx.db
        .select({ rulesVersion: leases.rulesVersion })
        .from(leases)
        .where(eq(leases.id, leaseId));
      if (!lease) throw notFound("lease");
      const { pdf, attached, missing } = await registrationPackPdf(tx, ctx, leaseId);
      // The pack carries ID images: each download is recorded with the files it included (ids only).
      await appendEvent(tx, ctx, {
        entity: { kind: "lease", id: leaseId },
        type: "DOCUMENT_VIEWED",
        actor: actorOf(c),
        payload: { kind: "registration_pack", attachedDocumentIds: attached, notAttached: missing },
        rulesVersion: lease.rulesVersion,
      });
      return pdf;
    });
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="registration-pack.pdf"',
      "cache-control": "private, no-store",
    });
  });

  /** Multipart: submissionId, reference, issuedOn, feePaidAed?, certificate? (PDF, 10 MB). */
  api.post("/leases/:id/registration/record", async (c) => {
    requireRole(c.get("user"), LEASING);
    const leaseId = uuid(c.req.param("id"));
    const type = c.req.header("content-type") ?? "";
    if (!type.startsWith("multipart/form-data"))
      throw unprocessable("send the form as multipart", [], "invalid_request");
    const raw = await readLimited(c.req.raw, MAX_CERTIFICATE_BYTES + 64 * 1024);
    const form = await new Response(raw, { headers: { "content-type": type } }).formData().catch(() => null);
    if (!form) throw unprocessable("the form could not be read", [], "invalid_request");
    const text = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    const parsed = RecordFields.safeParse({
      submissionId: text("submissionId"),
      reference: text("reference"),
      issuedOn: text("issuedOn"),
      feePaidAed: text("feePaidAed") || undefined,
    });
    if (!parsed.success)
      throw unprocessable(
        "invalid request",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        "invalid_request",
      );
    let issuedOn;
    try {
      issuedOn = calendarDate(parsed.data.issuedOn);
    } catch {
      throw unprocessable("The registration date is not a valid date.");
    }
    let feePaidFils: number | null = null;
    if (parsed.data.feePaidAed) {
      try {
        feePaidFils = parseAed(parsed.data.feePaidAed);
      } catch {
        throw unprocessable("The fee paid is not a valid amount.");
      }
    }
    const file = form.get("certificate");
    const certificate = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
    const r = await recordManualIssued(
      ctx,
      leaseId,
      { submissionId: parsed.data.submissionId, reference: parsed.data.reference, issuedOn, feePaidFils, certificate },
      actorOf(c),
    );
    return c.json(r, r.idempotent ? 200 : 201);
  });

  api.post("/leases/:id/registration/rejected", async (c) => {
    requireRole(c.get("user"), LEASING);
    const body = RejectedBody.parse(await c.req.json());
    return c.json(await recordManualRejected(ctx, uuid(c.req.param("id")), body, actorOf(c)), 201);
  });
}
