import type { StaffRole } from "@leasing/core";
import { documents, withTx } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import { appendEvent } from "../manager/events.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const LEASING: StaffRole[] = ["leasing_officer", "leasing_manager"];

/** Generated lease documents (contracts, Ejari certificates, ...). Always on: not tenancy-only. */
export function registerLeaseDocumentRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

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
