import { newId } from "@platform/kernel/ids";
import { validateMapping, type RawBlank } from "@platform/readers/structure/blanks";
import { contextParty, fitsBlank, partyIn, templateLines } from "@platform/readers/structure/mapping";
import { ContractStructureData, type TemplateBlank } from "@platform/readers/structure/schema";
import type { SpaActor, SpaRole } from "@spa/core";
import {
  SPA_TEMPLATE_KINDS,
  type SpaDb,
  spaApprovals,
  spaTemplates,
  spaTemplateVersions,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import {
  hasBlocker,
  partyBlocks,
  signatureRoles,
  type SpaDocumentKind,
  spaTemplateProfile,
  type TemplateCheck,
  templateChecks,
} from "@spa/helpers";
import { getSalesRulebook, type SalesRulebook, salesRulebookOn } from "@spa/rulebook";
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { hasRole } from "@spa/core";

const adminOnly = (user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }) => {
  if (!hasRole(user, "admin")) throw forbidden("only an admin manages templates");
};

const NewTemplate = z.object({
  name: z.string().trim().min(1).max(120),
  documentKind: z.enum(SPA_TEMPLATE_KINDS),
  projectCodes: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
});

/** A named template (S45): a document kind and the projects it is for (none = every project). */
export async function createTemplate(
  ctx: SpaContext,
  input: unknown,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ id: string }> {
  adminOnly(user);
  const p = NewTemplate.safeParse(input);
  if (!p.success) throw unprocessable("invalid_template", "the template details aren't valid");
  return withSpaTx(ctx.database, async (tx) => {
    const [dup] = await tx.db
      .select({ id: spaTemplates.id })
      .from(spaTemplates)
      .where(and(eq(spaTemplates.name, p.data.name), eq(spaTemplates.documentKind, p.data.documentKind)));
    if (dup) throw conflict("template_exists", "a template with this name and kind exists");
    const id = newId();
    await tx.db.insert(spaTemplates).values({
      id,
      ...p.data,
      projectCodes: [...new Set(p.data.projectCodes)],
      createdBy: `user:${user.id}`,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "template", id },
      type: "TEMPLATE_CREATED",
      actor: `user:${user.id}`,
      payload: { documentKind: p.data.documentKind },
    });
    return { id };
  });
}

function runChecks(
  kind: SpaDocumentKind,
  data: { sections: ContractStructureData["sections"]; style: { flags: { authorityMarks: boolean } } },
  blanks: readonly TemplateBlank[],
  rulebook: SalesRulebook,
): TemplateCheck[] {
  return templateChecks({
    documentKind: kind,
    paragraphs: templateLines(data.sections),
    blanks,
    authorityMarks: data.style.flags.authorityMarks,
    rulebook,
  });
}

const blockersOf = (checks: readonly TemplateCheck[]) =>
  checks.filter((c) => c.severity === "blocker").map((c) => c.message);

/**
 * Stores what the `spa-template` helper read (validated again here) as the next version, runs the template checks by
 * code against today's sales rulebook and opens `template_approval` for legal. The upload and the helper run are C34.
 */
export async function addTemplateVersion(
  ctx: SpaContext,
  input: { templateId: string; docId: string; docHash: string; data: unknown },
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ id: string; version: number; checks: TemplateCheck[]; approvalId: string }> {
  adminOnly(user);
  const parsed = ContractStructureData.safeParse(input.data);
  if (!parsed.success) throw unprocessable("invalid_template_read", "the read template isn't valid");
  if (!/^[0-9a-f]{64}$/.test(input.docHash)) throw unprocessable("invalid_doc_hash", "docHash must be a sha256");
  const data = parsed.data;
  const rulebook = salesRulebookOn("dubai", ctx.clock.today());
  if (!rulebook) throw conflict("no_rulebook", "no sales rulebook is in force today");
  const actor: SpaActor = `user:${user.id}`;
  return withSpaTx(ctx.database, async (tx) => {
    const [tpl] = await tx.db.select().from(spaTemplates).where(eq(spaTemplates.id, input.templateId)).for("update");
    if (!tpl) throw notFound("template");
    const checks = runChecks(tpl.documentKind, data, data.blanks, rulebook);
    const [{ last } = { last: null }] = await tx.db
      .select({ last: max(spaTemplateVersions.version) })
      .from(spaTemplateVersions)
      .where(eq(spaTemplateVersions.templateId, tpl.id));
    const version = (last ?? 0) + 1;
    const id = newId();
    const { blanks, sections, ...look } = data;
    await tx.db.insert(spaTemplateVersions).values({
      id,
      templateId: tpl.id,
      version,
      docId: input.docId,
      docHash: input.docHash,
      sections,
      blanks,
      look,
      partyBlocks: partyBlocks(templateLines(sections)),
      signatureRoles: signatureRoles(blanks),
      checks: checks as unknown as Record<string, unknown>[],
      rulesVersion: rulebook.version,
      createdBy: actor,
      createdAt: ctx.clock.now(),
    });
    const approval = await proposeApproval(
      ctx,
      {
        gate: "template_approval",
        entity: { kind: "template", id },
        dedupeKey: `${id}:template_approval`,
        title: `${tpl.name} v${version}`,
        proposal: { templateId: tpl.id, versionId: id, version, documentKind: tpl.documentKind },
        reasons: blockersOf(checks),
        proposedBy: actor,
      },
      tx,
    );
    await tx.db.update(spaTemplateVersions).set({ approvalId: approval.id }).where(eq(spaTemplateVersions.id, id));
    return { id, version, checks, approvalId: approval.id };
  });
}

/**
 * An admin chooses a blank's key while the version is in review. Code checks the key (type and party, as for the
 * model); the checks run again and the open approval shows the new blockers.
 */
export async function remapBlank(
  ctx: SpaContext,
  input: { versionId: string; blankId: string; key: string },
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
  /** Joins the caller's transaction (the assistant's apply marks its proposal in the same one). */
  joined?: SpaTx,
): Promise<{ checks: TemplateCheck[] }> {
  adminOnly(user);
  const body = async (tx: SpaTx) => {
    const v = await versionForUpdate(tx, input.versionId);
    if (v.status !== "in_review") throw conflict("not_in_review", `this version is ${v.status}`);
    const blanks = v.blanks as unknown as TemplateBlank[];
    const b = blanks.find((x) => x.id === input.blankId);
    if (!b || b.role !== "field") throw notFound("blank");
    const sections = v.sections as unknown as ContractStructureData["sections"];
    const field = checkedKey(input.key, b, templateLines(sections));
    const next = blanks.map((x) =>
      x.id === b.id ? { ...x, field: field.field, fieldType: field.fieldType, source: "admin" as const } : x,
    );
    const [tpl] = await tx.db.select().from(spaTemplates).where(eq(spaTemplates.id, v.templateId));
    const rulebook = getSalesRulebook(v.rulesVersion);
    if (!tpl || !rulebook) throw notFound("template");
    const look = v.look as unknown as { style: { flags: { authorityMarks: boolean } } };
    const checks = runChecks(tpl.documentKind, { sections, style: look.style }, next, rulebook);
    await tx.db
      .update(spaTemplateVersions)
      .set({
        blanks: next as unknown as Record<string, unknown>[],
        checks: checks as unknown as Record<string, unknown>[],
      })
      .where(eq(spaTemplateVersions.id, v.id));
    if (v.approvalId)
      await tx.db
        .update(spaApprovals)
        .set({ reasons: blockersOf(checks) })
        .where(and(eq(spaApprovals.id, v.approvalId), eq(spaApprovals.status, "pending")));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "template", id: v.id },
      type: "TEMPLATE_BLANK_REMAPPED",
      actor: `user:${user.id}`,
      payload: { blankId: b.id, field: field.field },
    });
    return { checks };
  };
  return joined ? body(joined) : withSpaTx(ctx.database, body);
}

/**
 * A dry run of `remapBlank` for the template assistant's proposals (S61): the same refusals (not in review, no such
 * field blank, a key that doesn't fit the blank's type or party), and no write.
 */
export async function checkRemap(
  ctx: SpaContext,
  input: { versionId: string; blankId: string; key: string },
): Promise<void> {
  const [v] = await ctx.database.db
    .select()
    .from(spaTemplateVersions)
    .where(eq(spaTemplateVersions.id, input.versionId));
  if (!v) throw notFound("template version");
  if (v.status !== "in_review") throw conflict("not_in_review", `this version is ${v.status}`);
  const b = (v.blanks as unknown as TemplateBlank[]).find((x) => x.id === input.blankId);
  if (!b || b.role !== "field") throw notFound("blank");
  checkedKey(input.key, b, templateLines(v.sections as unknown as ContractStructureData["sections"]));
}

/** A blank's label is what a person reads on the review screen: short, plain, never a placeholder or a control character. */
export const BlankLabel = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (l) => ![...l].some((ch) => ch === "{" || ch === "}" || ch.charCodeAt(0) < 32),
    "a label has no braces or control characters",
  );

/**
 * An admin gives a blank a clearer label while the version is in review (a template assistant proposal, S61). Only the
 * label changes; the mapping and the wording stay, the checks run again and the open approval shows the blockers.
 */
export async function relabelBlank(
  ctx: SpaContext,
  input: { versionId: string; blankId: string; label: string },
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
  /** Joins the caller's transaction (the assistant's apply marks its proposal in the same one). */
  joined?: SpaTx,
): Promise<{ checks: TemplateCheck[] }> {
  adminOnly(user);
  const label = BlankLabel.safeParse(input.label);
  if (!label.success) throw unprocessable("invalid_label", label.error.issues[0]?.message ?? "invalid label");
  const body = async (tx: SpaTx) => {
    const v = await versionForUpdate(tx, input.versionId);
    if (v.status !== "in_review") throw conflict("not_in_review", `this version is ${v.status}`);
    const blanks = v.blanks as unknown as TemplateBlank[];
    const b = blanks.find((x) => x.id === input.blankId);
    if (!b || b.role !== "field") throw notFound("blank");
    const next = blanks.map((x) => (x.id === b.id ? { ...x, label: label.data } : x));
    const sections = v.sections as unknown as ContractStructureData["sections"];
    const [tpl] = await tx.db.select().from(spaTemplates).where(eq(spaTemplates.id, v.templateId));
    const rulebook = getSalesRulebook(v.rulesVersion);
    if (!tpl || !rulebook) throw notFound("template");
    const look = v.look as unknown as { style: { flags: { authorityMarks: boolean } } };
    const checks = runChecks(tpl.documentKind, { sections, style: look.style }, next, rulebook);
    await tx.db
      .update(spaTemplateVersions)
      .set({
        blanks: next as unknown as Record<string, unknown>[],
        checks: checks as unknown as Record<string, unknown>[],
      })
      .where(eq(spaTemplateVersions.id, v.id));
    if (v.approvalId)
      await tx.db
        .update(spaApprovals)
        .set({ reasons: blockersOf(checks) })
        .where(and(eq(spaApprovals.id, v.approvalId), eq(spaApprovals.status, "pending")));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "template", id: v.id },
      type: "TEMPLATE_BLANK_RELABELED",
      actor: `user:${user.id}`,
      payload: { blankId: b.id },
    });
    return { checks };
  };
  return joined ? body(joined) : withSpaTx(ctx.database, body);
}

function checkedKey(
  key: string,
  b: TemplateBlank,
  lines: string[],
): { field: string; fieldType: TemplateBlank["fieldType"] } {
  const k = key.trim();
  if (k === "leave_empty") return { field: "leave_empty", fieldType: null };
  const raw: RawBlank = { id: b.id, kind: b.kind, marker: b.marker, line: 0, before: b.before, after: b.after };
  const m = validateMapping(k, b.label, raw, spaTemplateProfile.sheet);
  const line = lines.findIndex((l) => l.includes(`{{${b.id}}}`));
  const party =
    partyIn(b.label, spaTemplateProfile) ?? (line >= 0 ? contextParty(lines, line, 6, spaTemplateProfile) : null);
  if (m.field !== k || !fitsBlank(k, b.label, { before: b.before, after: b.after, party }, spaTemplateProfile))
    throw unprocessable("invalid_key", m.note ?? "this key doesn't fit the blank (type or party)");
  return { field: m.field, fieldType: m.fieldType };
}

async function versionForUpdate(tx: SpaTx, id: string) {
  const [v] = await tx.db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, id)).for("update");
  if (!v) throw notFound("template version");
  return v;
}

/**
 * Called by `decideApproval` inside its transaction for `template_approval` (S45). Approving needs every check to
 * pass and retires the template's previous approved version; rejecting closes the version. Edits aren't a decision
 * here: the admin remaps blanks instead.
 */
export async function applyTemplateDecision(
  tx: SpaTx,
  ctx: SpaContext,
  versionId: string,
  decision: "approve" | "reject" | "edit",
): Promise<void> {
  const v = await versionForUpdate(tx, versionId);
  if (v.status !== "in_review") throw conflict("not_in_review", `this version is ${v.status}`);
  if (decision === "edit")
    throw unprocessable("invalid_decision", "a template version is approved or rejected; remap blanks to change it");
  const at = ctx.clock.now();
  if (decision === "reject") {
    await tx.db
      .update(spaTemplateVersions)
      .set({ status: "rejected", decidedAt: at })
      .where(eq(spaTemplateVersions.id, v.id));
    return;
  }
  // The checks run again against the rulebook in force today, not the ones stored at upload (rules may have moved).
  const [tpl] = await tx.db.select().from(spaTemplates).where(eq(spaTemplates.id, v.templateId));
  const rulebook = salesRulebookOn("dubai", ctx.clock.today());
  if (!tpl || !rulebook) throw notFound("template");
  const look = v.look as unknown as { style: { flags: { authorityMarks: boolean } } };
  const checks = runChecks(
    tpl.documentKind,
    { sections: v.sections as unknown as ContractStructureData["sections"], style: look.style },
    v.blanks as unknown as TemplateBlank[],
    rulebook,
  );
  if (hasBlocker(checks))
    throw unprocessable("template_checks_failed", "the template checks must pass first", blockersOf(checks));
  await tx.db
    .update(spaTemplateVersions)
    .set({ status: "retired" })
    .where(and(eq(spaTemplateVersions.templateId, v.templateId), eq(spaTemplateVersions.status, "approved")));
  await tx.db
    .update(spaTemplateVersions)
    .set({ status: "approved", decidedAt: at })
    .where(eq(spaTemplateVersions.id, v.id));
}

/** The approved version to use: one scoped to the project first, else one for every project; null if none. */
export async function currentTemplate(
  db: SpaDb,
  documentKind: SpaDocumentKind,
  projectCode: string | null,
): Promise<{ templateId: string; versionId: string; version: number } | null> {
  const rows = await db
    .select({
      templateId: spaTemplates.id,
      projectCodes: spaTemplates.projectCodes,
      versionId: spaTemplateVersions.id,
      version: spaTemplateVersions.version,
      at: spaTemplateVersions.decidedAt,
    })
    .from(spaTemplateVersions)
    .innerJoin(spaTemplates, eq(spaTemplates.id, spaTemplateVersions.templateId))
    .where(and(eq(spaTemplates.documentKind, documentKind), eq(spaTemplateVersions.status, "approved")))
    .orderBy(desc(spaTemplateVersions.decidedAt));
  const pick =
    (projectCode ? rows.find((r) => r.projectCodes.includes(projectCode)) : undefined) ??
    rows.find((r) => r.projectCodes.length === 0);
  return pick ? { templateId: pick.templateId, versionId: pick.versionId, version: pick.version } : null;
}
