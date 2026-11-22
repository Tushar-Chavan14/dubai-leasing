import { createHash } from "node:crypto";
import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import type { Helper } from "@platform/kernel/helper";
import type { Llm } from "@platform/llm";
import { templateLines } from "@platform/readers/structure/mapping";
import type { ContractStructureContext, ContractStructureData } from "@platform/readers/structure/schema";
import type { SpaRole } from "@spa/core";
import { spaTemplates, spaTemplateVersions, spaUsers, templateUploads, withSpaTx } from "@spa/db";
import { spaTemplateHelper } from "@spa/helpers";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { TEMPLATE_READ_JOB, templateReadKey } from "../jobs.ts";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, SpaDomainError, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { type DocumentStore, MAX_DOCUMENT_BYTES, sniffFile } from "./noc.ts";
import { addTemplateVersion } from "./templates.ts";

/** The words a person reads when a sample holds what looks like a real customer's data (S66). Never repeats the value. */
export const REAL_DATA_REASON = "Upload a blank or fictional copy";

/** Only an admin writes templates (S45, S66). Checked before a body, a file or an id is looked at. */
export const needTemplateAdmin = (user: { role: SpaRole }) => {
  if (user.role !== "admin") throw forbidden("only an admin manages templates");
};

const PATTERNS: readonly RegExp[] = [
  // Emirates ID: 784-YYYY-NNNNNNN-C, with or without separators.
  /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/,
  // A passport number: one or two letters, then six to eight digits.
  /\b[A-Z]{1,2}\d{6,8}\b/,
  // An email address.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/,
  // A phone number with a country code or a local 0-prefixed number.
  /(?:\+|\b00)\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]?\d{2,4}){2,4}\b/,
  /\b0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b/,
  // An IBAN, written together or in groups of four.
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/,
];

/** Whether the read text holds an Emirates ID, passport, email, phone or IBAN pattern. Pure code, no model (S66). */
export const realDataIn = (text: string): boolean => PATTERNS.some((p) => p.test(text));

const idParam = z.uuid();

export interface UploadResult {
  id: string;
  status: (typeof templateUploads.$inferSelect)["status"];
  /** True when this file had already been uploaded for the template: the same row comes back. */
  existing: boolean;
}

/**
 * An admin uploads a sample agreement (S66): a PDF of at most 10 MB by its first bytes, with the box ticked that it holds
 * no real customer data. The file is stored by its hash; one row per template and hash, so a repeat upload answers with
 * the same row. A job reads it; a queue that is down never loses the upload.
 */
export async function uploadTemplateSample(
  ctx: SpaContext,
  deps: { store: DocumentStore; boss: Pick<PgBoss, "send"> },
  templateId: string,
  input: { fileName: string; bytes: Uint8Array; noRealData: unknown },
  user: { id: string; role: SpaRole },
): Promise<UploadResult> {
  needTemplateAdmin(user);
  const tid = idParam.safeParse(templateId);
  if (!tid.success) throw notFound("template");
  const [tpl] = await ctx.database.db
    .select({ id: spaTemplates.id })
    .from(spaTemplates)
    .where(eq(spaTemplates.id, tid.data));
  if (!tpl) throw notFound("template");
  if (input.noRealData !== true && input.noRealData !== "true")
    throw unprocessable("declaration_required", "tick that this sample has no real customer data");
  const type = input.bytes.byteLength > MAX_DOCUMENT_BYTES ? null : sniffFile(input.bytes);
  if (!type || type.mime !== "application/pdf") throw unprocessable("invalid_file", "a PDF up to 10 MB");
  // A file name is shown to legal and a sales manager: one that looks like an identifier is replaced, not kept.
  const named = input.fileName.trim().slice(0, 200);
  const fileName = !named || realDataIn(named) ? "sample.pdf" : named;
  const docHash = createHash("sha256").update(input.bytes).digest("hex");
  const find = async () =>
    (
      await ctx.database.db
        .select()
        .from(templateUploads)
        .where(and(eq(templateUploads.templateId, tid.data), eq(templateUploads.docHash, docHash)))
    )[0];
  let row = await find();
  let existing = !!row;
  if (!row) {
    const stored = await deps.store.put(input.bytes, "pdf");
    row = await withSpaTx(ctx.database, async (tx) => {
      const id = newId();
      const made = await tx.db
        .insert(templateUploads)
        .values({
          id,
          templateId: tid.data,
          docHash,
          storageKey: stored.path,
          fileName,
          declaredNoRealData: true,
          uploadedBy: `user:${user.id}`,
          uploadedAt: ctx.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      if (made[0]) {
        await appendDealEvent(tx, ctx, {
          entity: { kind: "template", id: tid.data },
          type: "TEMPLATE_UPLOADED",
          actor: `user:${user.id}`,
          payload: { docHash },
        });
        return made[0];
      }
      existing = true;
      return (
        await tx.db
          .select()
          .from(templateUploads)
          .where(and(eq(templateUploads.templateId, tid.data), eq(templateUploads.docHash, docHash)))
      )[0]!;
    });
  }
  // A new row, or one still waiting: queue the read (the key makes a second queueing a no-op).
  if (row.status === "queued")
    await deps.boss
      .send(TEMPLATE_READ_JOB, { uploadId: row.id }, { singletonKey: templateReadKey(tid.data, docHash) })
      .then((jobId) => {
        // null: a job with this key is already waiting or running, which is the answer a repeat upload wants.
        if (jobId === null) console.warn("template read already queued for this file");
      })
      .catch((e) => console.error("template read not queued:", e instanceof Error ? e.message : e));
  return { id: row.id, status: row.status, existing };
}

export interface TemplateReadDeps {
  llm: Llm;
  readFile: (storageKey: string) => Promise<Uint8Array>;
  /** Tests pass a stand-in for the reader; the engine uses the platform reader with the SPA profile. */
  helper?: Helper<ContractStructureContext, ContractStructureData>;
}

/** A reason a person reads. Model or file text is masked, cut short and never kept when it holds what the scan looks for. */
const reasonText = (reasons: string[]) => {
  const joined = reasons.join(" ");
  if (realDataIn(joined)) return REAL_DATA_REASON;
  return maskPiiText(joined).slice(0, 300) || "The sample could not be read.";
};

/**
 * The `spa.template.read` job (S66): reads one uploaded sample with the template reader, refuses it when its text holds
 * what looks like real customer data (no version is stored and nothing is scrubbed, so the approval checks still see the
 * real wording), otherwise stores the next version and opens `template_approval`. Safe to run twice: a finished upload is
 * left alone, and a version stored by a run that crashed is linked instead of added again.
 */
export async function readTemplateUpload(
  ctx: SpaContext,
  deps: TemplateReadDeps,
  data: { uploadId: string },
): Promise<{ status: string }> {
  const db = ctx.database.db;
  const [up] = await db.select().from(templateUploads).where(eq(templateUploads.id, data.uploadId));
  if (!up) return { status: "missing" };
  if (up.status !== "queued" && up.status !== "reading") return { status: up.status };
  const finish = async (status: "done" | "failed" | "needs_human", reason: string | null, versionId: string | null) => {
    // The row and its event are one transaction: a finished upload always has its audit event.
    await withSpaTx(ctx.database, async (tx) => {
      await tx.db
        .update(templateUploads)
        .set({ status, reason, versionId, finishedAt: ctx.clock.now() })
        .where(eq(templateUploads.id, up.id));
      await appendDealEvent(tx, ctx, {
        entity: { kind: "template", id: up.templateId },
        type: "TEMPLATE_UPLOAD_READ",
        actor: "system:template-reader",
        payload: { docHash: up.docHash, status },
      });
    });
    return { status };
  };
  if (up.status === "queued")
    await db.update(templateUploads).set({ status: "reading" }).where(eq(templateUploads.id, up.id));

  const [stored] = await db
    .select({ id: spaTemplateVersions.id })
    .from(spaTemplateVersions)
    .where(and(eq(spaTemplateVersions.templateId, up.templateId), eq(spaTemplateVersions.docHash, up.docHash)));
  if (stored) return finish("done", null, stored.id);

  const helper = deps.helper ?? spaTemplateHelper(deps.llm, { readFile: (docId) => deps.readFile(docId) });
  const run = await helper.run({
    runId: newId(),
    entity: { kind: "template", id: up.templateId },
    step: "read",
    context: { docId: up.storageKey },
    rulesVersion: "none",
    now: ctx.clock.now().toISOString(),
  });
  if (run.status !== "ok" || !run.data)
    return finish(run.status === "needs_human" ? "needs_human" : "failed", reasonText(run.reasons), null);

  const text = [
    ...templateLines(run.data.sections),
    run.data.style.header ?? "",
    run.data.style.footer ?? "",
    // What a model proposed as a label, and the words around a blank, are read by legal too.
    ...run.data.blanks.flatMap((b) => [b.label, b.before, b.after]),
  ].join("\n");
  if (realDataIn(text)) return finish("needs_human", REAL_DATA_REASON, null);

  const [user] = await db
    .select({ id: spaUsers.id, role: spaUsers.role })
    .from(spaUsers)
    .where(eq(spaUsers.id, up.uploadedBy.replace(/^user:/, "")));
  if (!user) return finish("failed", "The person who uploaded this sample isn't a user any more.", null);
  try {
    const v = await addTemplateVersion(
      ctx,
      { templateId: up.templateId, docId: up.storageKey, docHash: up.docHash, data: run.data },
      user,
    );
    return finish("done", null, v.id);
  } catch (e) {
    if (e instanceof SpaDomainError) return finish("failed", reasonText([e.message]), null);
    throw e;
  }
}
