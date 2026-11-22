import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { untrusted } from "@platform/llm/agent";
import type { ContractStructureData, TemplateBlank } from "@platform/readers/structure/schema";
import { type SpaRole, spaDataSheet } from "@spa/core";
import { assistantProposals, spaTemplates, spaTemplateVersions, withSpaTx } from "@spa/db";
import { type TemplateBackend, type TemplateCheck, type TemplateProposal, templateAssistantTurn } from "@spa/helpers";
import { and, eq } from "drizzle-orm";
import { type AssistantRuntime, storeTurn, storeUserMessage, threadFor, threadHistory } from "./assistants.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound } from "./errors.ts";
import { BlankLabel, checkRemap, relabelBlank, remapBlank } from "./templates.ts";

type Person = { id: string; role: SpaRole };
/** Who may talk to the template assistant: the people who manage and approve templates. */
const ASSISTANT_ROLES: readonly SpaRole[] = ["admin", "legal"];

/** What each template check means and how to fix it, in fixed words (S45). */
const CHECK_HELP: Readonly<Record<string, string>> = Object.freeze({
  sample_value:
    "A value from the sample the template was read from is printed in the fixed wording. Replace it with a blank mapped to a data-sheet key so the value comes from the deal.",
  authority_marks:
    "The sample has a header, footer or logo area that looks like an authority's mark. The company's own agreement must not carry one; remove it from the template.",
  fee_rate:
    "A registration fee in the wording does not match the rate in the sales rulebook in force, or the rate is still pending. Remove the figure and map a blank to the fee key so code fills it.",
  missing_core_key:
    "The template does not print one of the values every agreement of its kind needs (seller name, purchaser name, unit number, price). Map a blank to the missing key.",
  no_payment_plan: "A primary or off-plan template has no blank mapped to the payment plan. Map one to the plan key.",
  unmapped_blank:
    "A blank is not mapped to a data-sheet key, so it prints as an empty line to fill by hand. Map it to a key, or leave it empty on purpose.",
});

const asVersion = async (ctx: SpaContext, versionId: string) => {
  const [row] = await ctx.database.db
    .select({ v: spaTemplateVersions, t: spaTemplates })
    .from(spaTemplateVersions)
    .innerJoin(spaTemplates, eq(spaTemplates.id, spaTemplateVersions.templateId))
    .where(eq(spaTemplateVersions.id, versionId));
  if (!row) throw notFound("template version");
  return row;
};

const sectionsOf = (v: { sections: unknown }) => v.sections as unknown as ContractStructureData["sections"];
const blanksOf = (v: { blanks: unknown }) => v.blanks as unknown as TemplateBlank[];
const checksOf = (v: { checks: unknown }) => v.checks as unknown as TemplateCheck[];

/**
 * The template assistant's tools for one version (S61). Reads are plain; text that came from the uploaded document
 * (headings, blank labels) is fenced as data. `propose_change` validates in code and stores a `proposed` row: it changes
 * no template, and only `applyTemplateProposal` (an admin's click) ever does.
 */
function templateBackend(
  ctx: SpaContext,
  versionId: string,
  threadId: string,
  made: { id: string; kind: string; payload: Record<string, unknown> }[],
): TemplateBackend {
  return {
    async template_version() {
      const { v, t } = await asVersion(ctx, versionId);
      return {
        template: untrusted(t.name),
        kind: t.documentKind,
        version: v.version,
        status: v.status,
        rulesVersion: v.rulesVersion,
        sections: sectionsOf(v).items.map((s) => ({
          number: s.number,
          heading: s.heading ? untrusted(s.heading) : null,
        })),
        blanks: blanksOf(v).map((b) => ({
          id: b.id,
          label: untrusted(b.label),
          role: b.role,
          field: b.field,
          source: b.source ?? null,
          fieldType: b.fieldType,
        })),
        checks: checksOf(v).map((c) => ({
          code: c.code,
          severity: c.severity,
          message: c.message,
          blankId: c.blankId ?? null,
        })),
      };
    },
    async data_keys() {
      return {
        keys: Object.entries(spaDataSheet).map(([key, i]) => `${key}: ${i.label} (${i.type}${i.core ? ", core" : ""})`),
        also: ["leave_empty: print an empty line to fill by hand"],
      };
    },
    async compare_versions({ otherVersion }) {
      const { v } = await asVersion(ctx, versionId);
      const [o] = await ctx.database.db
        .select()
        .from(spaTemplateVersions)
        .where(and(eq(spaTemplateVersions.templateId, v.templateId), eq(spaTemplateVersions.version, otherVersion)));
      if (!o) throw new Error(`this template has no version ${otherVersion}`);
      const headings = (x: typeof v) => new Set(sectionsOf(x).items.map((s) => s.heading ?? ""));
      const mine = headings(v);
      const theirs = headings(o);
      const bm = new Map(blanksOf(v).map((b) => [b.id, b]));
      const bo = new Map(blanksOf(o).map((b) => [b.id, b]));
      const codes = (x: typeof v) => checksOf(x).map((c) => `${c.code}${c.blankId ? `:${c.blankId}` : ""}`);
      const cm = new Set(codes(v));
      const co = new Set(codes(o));
      return {
        thisVersion: v.version,
        otherVersion: o.version,
        sectionsAdded: [...mine].filter((h) => !theirs.has(h)).map(untrusted),
        sectionsRemoved: [...theirs].filter((h) => !mine.has(h)).map(untrusted),
        blanksAdded: [...bm.keys()].filter((id) => !bo.has(id)),
        blanksRemoved: [...bo.keys()].filter((id) => !bm.has(id)),
        mappingChanges: [...bm.values()]
          .filter((b) => bo.has(b.id) && bo.get(b.id)!.field !== b.field)
          .map((b) => ({ blankId: b.id, from: bo.get(b.id)!.field, to: b.field })),
        checksNew: [...cm].filter((c) => !co.has(c)),
        checksGone: [...co].filter((c) => !cm.has(c)),
      };
    },
    async explain_check({ code }) {
      const text = CHECK_HELP[code];
      if (!text) throw new Error(`unknown check code; known codes: ${Object.keys(CHECK_HELP).join(", ")}`);
      return { code, text };
    },
    async propose_change(p: TemplateProposal) {
      const { v } = await asVersion(ctx, versionId);
      if (v.status !== "in_review")
        throw new Error(`this version is ${v.status}: an approved or closed version cannot be changed`);
      const blank = blanksOf(v).find((b) => b.id === p.blankId);
      if (!blank || blank.role !== "field") throw new Error(`no field blank ${p.blankId} in this version`);
      let payload: Record<string, unknown>;
      let summary: string;
      if (p.kind === "remap_blank") {
        if (!p.key) throw new Error("a remap names the key");
        try {
          await checkRemap(ctx, { versionId, blankId: p.blankId, key: p.key });
        } catch (e) {
          throw new Error(e instanceof Error ? e.message : "that key doesn't fit this blank", { cause: e });
        }
        payload = { blankId: p.blankId, key: p.key, fromKey: blank.field, note: maskPiiText(p.note).slice(0, 200) };
        summary = `remap blank ${p.blankId} to key ${p.key}`;
      } else {
        const label = BlankLabel.safeParse(p.label ?? "");
        if (!label.success) throw new Error("a label is 1 to 80 characters with no braces");
        payload = {
          blankId: p.blankId,
          label: label.data,
          fromLabel: blank.label,
          note: maskPiiText(p.note).slice(0, 200),
        };
        summary = `rename blank ${p.blankId}`;
      }
      const id = newId();
      await ctx.database.db.insert(assistantProposals).values({
        id,
        threadId,
        kind: p.kind,
        templateVersionId: versionId,
        payload,
        createdAt: ctx.clock.now(),
      });
      made.push({ id, kind: p.kind, payload });
      return { proposalId: id, status: "proposed" as const, summary } as { proposalId: string; status: "proposed" };
    },
  };
}

export interface TemplateAssistantReply {
  threadId: string;
  reply: string;
  kind: string;
  verified: boolean;
  unverified: string[];
  /** Proposals this message stored (status `proposed`: nothing has changed). */
  proposals: { id: string; kind: string; payload: Record<string, unknown> }[];
}

/** One message to the template assistant, for an admin or legal. Nothing here changes a template. */
export async function runTemplateAssistant(
  ctx: SpaContext,
  rt: AssistantRuntime,
  input: { versionId: string; text: string; user: Person },
): Promise<TemplateAssistantReply> {
  if (!ASSISTANT_ROLES.includes(input.user.role)) throw forbidden("only admin and legal use the template assistant");
  await asVersion(ctx, input.versionId);
  const threadId = await threadFor(ctx, { kind: "template", subjectId: input.versionId, principal: input.user.id });
  const history = await threadHistory(ctx, threadId);
  await storeUserMessage(ctx, threadId, input.text);
  const made: TemplateAssistantReply["proposals"] = [];
  const result = await templateAssistantTurn(
    { model: rt.model, llm: rt.llm, ...(rt.timeoutMs ? { timeoutMs: rt.timeoutMs } : {}) },
    templateBackend(ctx, input.versionId, threadId, made),
    { text: input.text, history },
  );
  await storeTurn(ctx, threadId, result, rt.tag);
  return {
    threadId,
    reply: maskPiiText(result.reply),
    kind: result.kind,
    verified: result.verified,
    unverified: result.unverified,
    proposals: made,
  };
}

async function loadProposal(ctx: SpaContext, id: string) {
  const [p] = await ctx.database.db.select().from(assistantProposals).where(eq(assistantProposals.id, id));
  if (!p) throw notFound("proposal");
  if (p.status !== "proposed") throw conflict("proposal_decided", `this proposal is already ${p.status}`);
  return p;
}

/**
 * An admin's click applies a proposal, through the existing remap (or relabel) function and its own checks (S61). The
 * assistant never calls this. A version that is no longer in review, or a key that no longer fits, refuses it and the
 * proposal stays `proposed`. Applying twice is refused.
 */
export async function applyTemplateProposal(
  ctx: SpaContext,
  id: string,
  user: Person,
): Promise<{ checks: TemplateCheck[] }> {
  if (user.role !== "admin") throw forbidden("only an admin applies a proposal");
  // One transaction: the proposal row is locked, the blank is changed and the proposal is marked applied, or none of it
  // happens. Two clicks at once: the second waits for the lock, then finds the proposal applied and is refused.
  return withSpaTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(assistantProposals).where(eq(assistantProposals.id, id)).for("update");
    if (!p) throw notFound("proposal");
    if (p.status !== "proposed") throw conflict("proposal_decided", `this proposal is already ${p.status}`);
    const pl = p.payload as { blankId: string; key?: string; label?: string };
    const out =
      p.kind === "remap_blank"
        ? await remapBlank(ctx, { versionId: p.templateVersionId, blankId: pl.blankId, key: pl.key ?? "" }, user, tx)
        : await relabelBlank(
            ctx,
            { versionId: p.templateVersionId, blankId: pl.blankId, label: pl.label ?? "" },
            user,
            tx,
          );
    await tx.db
      .update(assistantProposals)
      .set({ status: "applied", appliedBy: `user:${user.id}`, appliedAt: ctx.clock.now() })
      .where(eq(assistantProposals.id, id));
    return out;
  });
}

/** An admin sets a proposal aside. */
export async function dismissTemplateProposal(ctx: SpaContext, id: string, user: Person): Promise<void> {
  if (user.role !== "admin") throw forbidden("only an admin dismisses a proposal");
  await loadProposal(ctx, id);
  const done = await ctx.database.db
    .update(assistantProposals)
    .set({ status: "dismissed" })
    .where(and(eq(assistantProposals.id, id), eq(assistantProposals.status, "proposed")))
    .returning({ id: assistantProposals.id });
  if (!done.length) throw conflict("proposal_decided", "this proposal was just decided");
}
