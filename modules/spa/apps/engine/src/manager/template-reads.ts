import type { TemplateBlank, TemplateSections, TemplateStyle } from "@platform/readers/structure/schema";
import { type DealType, type SheetKeyInfo, type SpaRole, spaDataSheet, hasAnyRole } from "@spa/core";
import { spaTemplates, spaTemplateVersions, templateUploads } from "@spa/db";
import { type PlanRow, type SettlementRow, renderSpaAgreement, type SpaValues } from "@spa/helpers";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, SpaDomainError } from "./errors.ts";
import { agreementRenderInput } from "./prepare.ts";

/** Who reads the template pages: admin writes, legal decides in the inbox, a sales manager looks (S66). */
export const TEMPLATE_READERS: readonly SpaRole[] = ["admin", "legal", "sales_manager"];
export const needTemplateReader = (user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }) => {
  if (!hasAnyRole(user, TEMPLATE_READERS)) throw forbidden("you can't view templates");
};
const idOf = (id: string, what: string) => {
  const p = z.uuid().safeParse(id);
  if (!p.success) throw notFound(what);
  return p.data;
};

const counts = (checks: unknown) => {
  const list = checks as { severity: string }[];
  return {
    blockers: list.filter((c) => c.severity === "blocker").length,
    warnings: list.filter((c) => c.severity === "warning").length,
  };
};

/** The templates, newest first, with the version in use and the latest one. */
export async function listTemplates(ctx: SpaContext, user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }) {
  needTemplateReader(user);
  const templates = await ctx.database.db.select().from(spaTemplates).orderBy(desc(spaTemplates.createdAt));
  const versions = await ctx.database.db
    .select({
      templateId: spaTemplateVersions.templateId,
      id: spaTemplateVersions.id,
      version: spaTemplateVersions.version,
      status: spaTemplateVersions.status,
    })
    .from(spaTemplateVersions)
    .orderBy(desc(spaTemplateVersions.version));
  return {
    items: templates.map((t) => {
      const own = versions.filter((v) => v.templateId === t.id);
      const inUse = own.find((v) => v.status === "approved");
      const latest = own[0];
      return {
        id: t.id,
        name: t.name,
        documentKind: t.documentKind,
        projectCodes: t.projectCodes,
        createdAt: t.createdAt.toISOString(),
        inUse: inUse ? { versionId: inUse.id, version: inUse.version } : null,
        latest: latest ? { versionId: latest.id, version: latest.version, status: latest.status } : null,
      };
    }),
  };
}

/** One template: its versions (with the number of blockers and warnings) and its uploads. */
export async function getTemplate(ctx: SpaContext, user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }, id: string) {
  needTemplateReader(user);
  const tid = idOf(id, "template");
  const db = ctx.database.db;
  const [t] = await db.select().from(spaTemplates).where(eq(spaTemplates.id, tid));
  if (!t) throw notFound("template");
  const versions = await db
    .select()
    .from(spaTemplateVersions)
    .where(eq(spaTemplateVersions.templateId, tid))
    .orderBy(desc(spaTemplateVersions.version));
  const uploads = await db
    .select()
    .from(templateUploads)
    .where(eq(templateUploads.templateId, tid))
    .orderBy(desc(templateUploads.uploadedAt));
  return {
    id: t.id,
    name: t.name,
    documentKind: t.documentKind,
    projectCodes: t.projectCodes,
    createdAt: t.createdAt.toISOString(),
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      status: v.status,
      createdAt: v.createdAt.toISOString(),
      decidedAt: v.decidedAt?.toISOString() ?? null,
      approvalId: v.approvalId,
      rulesVersion: v.rulesVersion,
      ...counts(v.checks),
    })),
    uploads: uploads.map((u) => ({
      id: u.id,
      fileName: u.fileName,
      status: u.status,
      reason: u.reason,
      versionId: u.versionId,
      uploadedAt: u.uploadedAt.toISOString(),
      finishedAt: u.finishedAt?.toISOString() ?? null,
    })),
  };
}

/** The data-sheet keys a person can map a blank to (the slot keys are code's; a person picks the plain key). */
const SHEET_CHOICES = Object.entries(spaDataSheet)
  .filter(([k, i]) => !/_n_/.test(k) && (i as SheetKeyInfo).type !== "table")
  .map(([key, i]) => ({ key, label: (i as SheetKeyInfo).label, type: (i as SheetKeyInfo).type }));

/**
 * One version as the review screen shows it: the fixed wording (text, never run as markup), the blanks with their
 * mapping, the checks, and the keys a blank can be mapped to. Whatever a model proposed (headings, labels) is returned
 * as plain text for the page to escape.
 */
export async function getTemplateVersion(ctx: SpaContext, user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }, id: string) {
  needTemplateReader(user);
  const vid = idOf(id, "template version");
  const [row] = await ctx.database.db
    .select({ v: spaTemplateVersions, name: spaTemplates.name, kind: spaTemplates.documentKind })
    .from(spaTemplateVersions)
    .innerJoin(spaTemplates, eq(spaTemplates.id, spaTemplateVersions.templateId))
    .where(eq(spaTemplateVersions.id, vid));
  if (!row) throw notFound("template version");
  const { v } = row;
  const sections = v.sections as unknown as TemplateSections;
  const blanks = v.blanks as unknown as TemplateBlank[];
  return {
    id: v.id,
    templateId: v.templateId,
    templateName: row.name,
    documentKind: row.kind,
    version: v.version,
    status: v.status,
    approvalId: v.approvalId,
    rulesVersion: v.rulesVersion,
    createdAt: v.createdAt.toISOString(),
    decidedAt: v.decidedAt?.toISOString() ?? null,
    checks: v.checks,
    blanks: blanks.map((b) => ({
      id: b.id,
      label: b.label,
      kind: b.kind,
      role: b.role,
      field: b.field,
      fieldType: b.fieldType,
      source: b.source,
      before: b.before,
      after: b.after,
    })),
    sections: sections.items.map((s) => ({ number: s.number, heading: s.heading, paragraphs: s.paragraphs })),
    title: sections.title,
    canRemap: v.status === "in_review",
    choices: SHEET_CHOICES,
  };
}

const SAMPLE_MARK = "SAMPLE: fictional values, not an agreement";

/** One fictional value per data-sheet key, by type. Nothing here is a person, an account or a real amount. */
function sampleSheet() {
  const purchaser: SpaValues = {};
  const seller: SpaValues = {};
  const values: SpaValues = {};
  for (const [key, raw] of Object.entries(spaDataSheet)) {
    const info = raw as SheetKeyInfo;
    if (/_n_/.test(key) || info.type === "table" || key === "price_words") continue;
    const v =
      info.type === "money_fils"
        ? 150_000_000
        : info.type === "date"
          ? "2026-01-15"
          : info.type === "int"
            ? 1000
            : info.type === "bps"
              ? 10_000
              : `SAMPLE ${info.label}`;
    (info.repeat === "buyer" ? purchaser : info.repeat === "seller" ? seller : values)[key] = v;
  }
  const plan: PlanRow[] = [
    { number: 1, label: "Booking", dueOn: "2026-01-15", milestone: null, amountFils: 30_000_000 },
    { number: 2, label: "On completion of structure", dueOn: null, milestone: "Structure", amountFils: 60_000_000 },
    { number: 3, label: "On handover", dueOn: null, milestone: "Handover", amountFils: 60_000_000 },
  ];
  const settlement: SettlementRow[] = [
    { label: "Sale price", payer: "Buyer", payee: "Seller", amountFils: 150_000_000 },
    { label: "Registration fee", payer: "Buyer", payee: "DLD", amountFils: 6_000_000 },
  ];
  return { purchasers: [purchaser], sellers: [seller], values, plan, settlement };
}

/**
 * A look at the template with a fixed fictional sheet and a "SAMPLE" header and footer on every page (S66). Pure code over
 * the stored version: nothing is stored, no event is written, no deal's value is used. A template that can't print says
 * what is missing instead of giving a PDF.
 */
export async function previewTemplateVersion(
  ctx: SpaContext,
  user: { role: SpaRole; roles?: readonly SpaRole[] | undefined },
  id: string,
): Promise<Uint8Array> {
  needTemplateReader(user);
  const vid = idOf(id, "template version");
  const [row] = await ctx.database.db
    .select({ v: spaTemplateVersions, kind: spaTemplates.documentKind })
    .from(spaTemplateVersions)
    .innerJoin(spaTemplates, eq(spaTemplates.id, spaTemplateVersions.templateId))
    .where(eq(spaTemplateVersions.id, vid));
  if (!row) throw notFound("template version");
  const look = row.v.look as unknown as { style: TemplateStyle };
  const marked = {
    ...row.v,
    look: { ...row.v.look, style: { ...look.style, header: SAMPLE_MARK, footer: SAMPLE_MARK } },
  };
  const dealType: DealType = row.kind === "spa" ? "primary_offplan" : "resale_offplan";
  const sheet = sampleSheet();
  const input = {
    ...agreementRenderInput(marked, { dealType, ref: "SAMPLE" }, sheet, ctx.clock.now()),
    settlement: sheet.settlement,
  };
  const out = await renderSpaAgreement(input);
  if (!out.ok)
    throw new SpaDomainError(422, "preview_unavailable", "this template can't be previewed yet", out.problems);
  return out.bytes;
}
