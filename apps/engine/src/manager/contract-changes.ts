import {
  type Actor,
  Addendum,
  type ChangeMark,
  type CalendarDate,
  CONTRACT_CLAUSES,
  type ContractChangeAnalysis,
  ContractChangeRequestInput,
  type MarkRewrite,
  type TermValues,
  type ContractClauseId,
  MAX_ADDENDUM_CLAUSES,
  isCompanyClauseRef,
  newId,
  PAUSING_CHANGE_STATUSES,
  type StaffUser,
  userActor,
} from "@leasing/core";
import { sha256Hex, shortRef } from "@leasing/core/tokens";
import {
  approvals,
  companyClauses,
  companyContractTemplates,
  contractChangeRequests,
  contracts,
  contractSigners,
  inboundEvents,
  leases,
  tasks,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import {
  anchorFor,
  anchorQuote,
  checkMarkRewrite,
  type ClauseOption,
  CORE_FIELDS,
  type ContractChangeContext,
  ContractChangeSchemas,
  contractChangeHelper,
  ContractMarksSchemas,
  contractMarksHelper,
  findQuotePlace,
  type MarksContext,
  type MarksData,
  type TermPlan,
  termText,
  templateParagraphs,
  type TemplateRewrite,
} from "@leasing/helpers";
import { getRulebook, rulesVersionForTerm } from "@leasing/rulebook";
import { and, asc, desc, eq, inArray, isNotNull, isNull, like } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { approvedClauses } from "./clause-refs.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import type { LeaseTermsProposal } from "./gate-rules.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import type { LinkRow } from "./links.ts";
import { parseTemplate } from "./company-templates.ts";
import { createTask } from "./milestones.ts";
import { mergeChanges, planFor, type TermSnapshot, termInputs } from "./lease-terms.ts";

/**
 * D67: contract change requests. A tenant or landlord asks for a change from their signing page; signing of that
 * version pauses for both parties; the `contract_change` helper drafts a revised addendum with an analysis (code
 * checks it and builds the diff); a leasing officer re-issues (a new version through the `final_contract` gate) or
 * declines with a note. The request text is untrusted data throughout.
 */
export const CONTRACT_CHANGE_JOB = "contract.change.analyse";
/** Requests one signer may make on one contract version, closed ones included. */
export const MAX_REQUESTS_PER_VERSION = 5;

type ChangeRow = typeof contractChangeRequests.$inferSelect;
type ContractRow = typeof contracts.$inferSelect;
type SignerRow = typeof contractSigners.$inferSelect;

const pausing = inArray(contractChangeRequests.status, [...PAUSING_CHANGE_STATUSES]);
const who = (role: "tenant" | "landlord") => (role === "tenant" ? "The tenant" : "The landlord");

/** True while a change request on this contract version is open or analysed. */
export async function signingPaused(tx: Pick<Tx, "db">, contractId: string): Promise<boolean> {
  const [r] = await tx.db
    .select({ id: contractChangeRequests.id })
    .from(contractChangeRequests)
    .where(and(eq(contractChangeRequests.contractId, contractId), pausing))
    .limit(1);
  return !!r;
}

/** What the signing page shows about changes: the signer's own requests, whether signing is paused, the form's limits. */
export async function signerChangeView(
  tx: Tx,
  contract: ContractRow,
  signer: SignerRow,
  link: LinkRow,
  today: CalendarDate,
) {
  const rows = await tx.db
    .select()
    .from(contractChangeRequests)
    .where(eq(contractChangeRequests.contractId, contract.id))
    .orderBy(asc(contractChangeRequests.createdAt));
  const paused = rows.some((r) => PAUSING_CHANGE_STATUSES.includes(r.status));
  const mine = rows.filter((r) => r.signerId === signer.id);
  const policy = (await getCompanyPolicy(tx, today)).contractChanges;
  const openMine = mine.filter((r) => PAUSING_CHANGE_STATUSES.includes(r.status)).length;
  return {
    paused,
    /** Paused by the other party's request (the page says who asked, not what). */
    pausedByOther: paused && !rows.some((r) => r.signerId === signer.id && PAUSING_CHANGE_STATUSES.includes(r.status)),
    changeRequests: mine.map((r) => ({
      id: r.id,
      ref: r.ref,
      target: r.target,
      text: r.text,
      status: r.status,
      createdAt: r.createdAt,
      decisionNote: r.status === "declined" ? r.decisionNote : null,
    })),
    canRequestChange:
      policy.enabled &&
      policy.roles.includes(signer.role) &&
      !link.usedAt &&
      !signer.signedAt &&
      contract.status === "sent" &&
      openMine < policy.maxOpenPerSigner,
    changeMaxChars: policy.maxChars,
  };
}

/** Most marks on one request. */
export const MAX_MARKS = 20;
/** The marked-text form: passages the signer selected on the page, each with a note. */
export const MarksRequestInput = z.strictObject({
  marks: z
    .array(
      z.strictObject({
        page: z.number().int().min(1).max(1000),
        quote: z.string().trim().min(1, "Select some text to mark.").max(500),
        note: z.string().trim().min(1, "Write what you would like changed.").max(2000),
      }),
    )
    .min(1, "Mark at least one passage.")
    .max(MAX_MARKS),
});
export const AnchorCheckInput = z.strictObject({
  page: z.number().int().min(1).max(1000),
  quote: z.string().max(2000),
});

/** The signing link's contract (any state): its stored paragraph texts, for the anchor check. */
export async function anchorCheck(ctx: EngineContext, link: LinkRow | null, body: unknown) {
  const input = AnchorCheckInput.safeParse(body);
  if (!input.success) {
    throw unprocessable(
      "Select some text to mark.",
      input.error.issues.map((i) => i.message),
      "invalid_payload",
    );
  }
  return withTx(ctx.database, async (tx) => {
    if (!link || link.purpose !== "sign") throw conflict("Open the signing link from your email.");
    const [s] = await tx.db
      .select({ contract: contracts })
      .from(contractSigners)
      .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
      .where(eq(contractSigners.linkId, link.id));
    if (!s) throw conflict("This signing link is no longer valid. Use the newest email from us.");
    const r = anchorQuote(s.contract.paragraphTexts, input.data.quote);
    return { label: "label" in r.anchor ? r.anchor.label : null, refused: r.refused };
  });
}

/** The signer asks for a change (portal). Recorded at once as evidence; the AI draft runs in a job. */
export async function requestContractChange(ctx: EngineContext, link: LinkRow | null, body: unknown) {
  const marked =
    typeof body === "object" && body !== null && "marks" in body ? MarksRequestInput.safeParse(body) : null;
  const input = marked ?? ContractChangeRequestInput.safeParse(body);
  if (!input.success) {
    throw unprocessable(
      input.error.issues[0]?.message ?? "Tell us what you would like changed.",
      input.error.issues.map((i) => i.message),
      "invalid_payload",
    );
  }
  const markInput = marked?.success ? marked.data.marks : null;
  return withTx(ctx.database, async (tx) => {
    if (!link || link.purpose !== "sign") throw conflict("Open the signing link from your email.");
    // Locks the signer and the contract row, so a signature and a request can't cross.
    const [s] = await tx.db
      .select({ signer: contractSigners, contract: contracts })
      .from(contractSigners)
      .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
      .where(eq(contractSigners.linkId, link.id))
      .for("update");
    if (!s) throw conflict("This signing link is no longer valid. Use the newest email from us.");
    if (link.usedAt || s.signer.signedAt) throw conflict("You have already signed this contract.");
    if (s.contract.status !== "sent")
      throw conflict("This contract version has been replaced. Use the newest email from us.");
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, s.contract.leaseId)).for("update");
    if (lease?.state !== "CONTRACT") throw conflict("This contract can no longer be changed online.");
    const today = ctx.clock.today();
    const policy = (await getCompanyPolicy(tx, today)).contractChanges;
    if (!policy.enabled || !policy.roles.includes(s.signer.role)) {
      throw conflict(
        "Changes can't be requested online for this contract. Please contact the leasing team.",
        "change_requests_off",
      );
    }
    let target: string;
    let text: string;
    let marks: ChangeMark[] | null = null;
    if (markInput) {
      marks = [];
      const reasons: string[] = [];
      markInput.forEach((m, i) => {
        const r = anchorQuote(s.contract.paragraphTexts, m.quote);
        if (r.refused) reasons.push(`Mark ${i + 1}: ${r.refused}`);
        marks!.push({
          n: i + 1,
          page: m.page,
          quote: m.quote,
          note: m.note,
          anchor: r.anchor,
          rewrite: null,
          problems: [],
          decision: null,
          keepReason: null,
          officerNote: null,
        });
      });
      if (reasons.length) throw unprocessable(reasons[0]!, reasons, "mark_refused");
      target = "other";
      text = marks.map((m) => `${m.n}. "${m.quote}": ${m.note}`).join("\n");
      if (marks.reduce((n, m) => n + m.note.length, 0) > policy.maxChars) {
        throw unprocessable(
          `Please keep your notes under ${policy.maxChars} characters in all.`,
          [`notes: longer than ${policy.maxChars} characters`],
          "too_long",
        );
      }
    } else {
      ({ target, text } = (input as { data: { target: string; text: string } }).data);
    }
    if (!markInput && text.length > policy.maxChars) {
      throw unprocessable(
        `Please keep your request under ${policy.maxChars} characters.`,
        [`text: longer than ${policy.maxChars} characters`],
        "too_long",
      );
    }
    const onContract = (s.contract.addendum as Addendum).clauses as string[];
    if (!markInput && target !== "free_text" && target !== "other" && !onContract.includes(target)) {
      throw unprocessable("Choose a clause from this contract.", ["target: not on the contract"], "invalid_payload");
    }
    const existing = await tx.db
      .select({ signerId: contractChangeRequests.signerId })
      .from(contractChangeRequests)
      .where(and(eq(contractChangeRequests.contractId, s.contract.id), pausing));
    if (existing.filter((r) => r.signerId === s.signer.id).length >= policy.maxOpenPerSigner) {
      throw conflict(
        "You already have the most open requests allowed. Wait for our answer, or withdraw one.",
        "too_many_requests",
      );
    }
    // Asking, withdrawing and asking again can't hold signing paused for ever: a cap per signer per version, closed ones
    // included. Past it, the signer talks to the leasing team.
    const mine = await tx.db
      .select({ id: contractChangeRequests.id })
      .from(contractChangeRequests)
      .where(
        and(eq(contractChangeRequests.contractId, s.contract.id), eq(contractChangeRequests.signerId, s.signer.id)),
      );
    if (mine.length >= MAX_REQUESTS_PER_VERSION) {
      throw conflict(
        "You have sent the most change requests allowed for this contract. Please contact the leasing team.",
        "too_many_requests",
      );
    }
    const now = ctx.clock.now();
    const id = newId();
    const inboundId = newId();
    const ref = shortRef("Q");
    const actor = `${s.signer.role}:${s.signer.partyId}` as Actor;
    await tx.db.insert(inboundEvents).values({
      id: inboundId,
      ref,
      type: "CONTRACT_CHANGE_REQUESTED",
      entityKind: "lease",
      entityId: lease.id,
      channel: "portal",
      actor,
      linkId: link.id,
      dedupeKey: `change:${id}`,
      payload: {
        contractId: s.contract.id,
        version: s.contract.version,
        role: s.signer.role,
        target,
        text,
        ...(marks ? { marks } : {}),
      },
      status: "applied",
      receivedAt: now,
      processedAt: now,
    });
    await tx.db.insert(contractChangeRequests).values({
      id,
      ref,
      leaseId: lease.id,
      contractId: s.contract.id,
      signerId: s.signer.id,
      role: s.signer.role,
      partyId: s.signer.partyId,
      target,
      text,
      marks,
      status: "open",
      inboundEventId: inboundId,
      createdAt: now,
    });
    // The text stays in the request row; the event records what and where, not the words.
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: lease.id },
      type: "CONTRACT_CHANGE_REQUESTED",
      actor,
      payload: {
        requestId: id,
        ref,
        contractId: s.contract.id,
        version: s.contract.version,
        role: s.signer.role,
        target,
        ...(marks ? { marks: marks.length } : {}),
      },
      rulesVersion: lease.rulesVersion,
    });
    await createTask(ctx, tx, lease.id, {
      kind: "contract_change_request",
      title: `${who(s.signer.role)} asked for a change to the contract on ${lease.ref}: review it (signing is paused)`,
      details: { requestId: id, ref },
      assigneeRole: "leasing_officer",
      dueOn: today,
      dedupeKey: `${lease.id}:contract_change:${id}`,
    });
    await ctx.scheduler.send(tx, {
      name: CONTRACT_CHANGE_JOB,
      data: { requestId: id },
      singletonKey: `${lease.id}:contract-change:${id}`,
    });
    // The first open request pauses signing: tell the other parties who haven't signed (no link in that email).
    if (existing.length === 0) {
      const others = await tx.db
        .select({ id: contractSigners.id })
        .from(contractSigners)
        .where(and(eq(contractSigners.contractId, s.contract.id), isNull(contractSigners.signedAt)));
      const seq = await changeCount(tx, s.contract.id);
      for (const o of others.filter((x) => x.id !== s.signer.id)) {
        await queueLeaseMail(ctx, tx, { leaseId: lease.id, kind: "sign_paused", key: o.id, seq });
      }
    }
    return { ref, id };
  });
}

async function changeCount(tx: Pick<Tx, "db">, contractId: string): Promise<number> {
  const rows = await tx.db
    .select({ id: contractChangeRequests.id })
    .from(contractChangeRequests)
    .where(eq(contractChangeRequests.contractId, contractId));
  return rows.length;
}

/** The clauses the helper sees: those on the contract (with their printed wording) and those it may add. */
async function changeContext(tx: Tx, row: ChangeRow): Promise<ContractChangeContext | null> {
  const [c] = await tx.db.select().from(contracts).where(eq(contracts.id, row.contractId));
  if (!c) return null;
  const [lu] = await tx.db
    .select({ companyId: units.companyId })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, row.leaseId));
  const approved = lu ? await approvedClauses(tx, lu.companyId) : [];
  const standard: ClauseOption[] = Object.entries(CONTRACT_CLAUSES).map(([ref, v]) => ({ ref, ...v }));
  const company: ClauseOption[] = approved.map((a) => ({ ref: `cc:${a.id}`, title: a.title, text: a.textEn }));
  const add = c.addendum as Addendum;
  const printed = add.companyClauses ?? [];
  const current: ClauseOption[] = add.clauses.map((ref) => {
    if (isCompanyClauseRef(ref)) {
      const p = printed.find((x) => `cc:${x.id}` === ref);
      return { ref, title: p?.title ?? "Company clause", text: p?.text ?? "" };
    }
    return { ref, ...CONTRACT_CLAUSES[ref as ContractClauseId] };
  });
  return {
    request: { role: row.role, target: row.target, text: row.text },
    current: { clauses: current, freeText: add.freeText ?? null },
    allowed: [...standard, ...company],
  };
}

/**
 * D72: every paragraph of a version prepared before D71 (`paragraph_texts` is null): the template's own paragraphs
 * (raw wording with {{bN}} blanks, earlier rewrites applied), the addendum's clauses ("Title: text") and the free text.
 * Only used to find where a mark's words are; a paragraph linked to a rule clause is not known here.
 */
function unknownPlaceParagraphs(
  t: ReturnType<typeof parseTemplate> | null,
  raw: ReadonlyMap<string, string>,
  add: Addendum,
  linked: ReadonlyMap<string, { ref: string; title: string; text: string }>,
): { key: string; label: string; text: string; rewritable: boolean }[] {
  const out: { key: string; label: string; text: string; rewritable: boolean }[] = [];
  const dropped = new Set(t?.review.droppedParagraphs ?? []);
  for (const s of t?.sections.items ?? []) {
    const heading = s.heading ? (s.number ? `${s.number} ${s.heading}` : s.heading) : "Contract";
    for (const i of s.paragraphs.keys()) {
      const key = `${s.id}:${i}`;
      const text = raw.get(key);
      if (!text || dropped.has(key)) continue;
      const link = linked.get(key);
      if (link) out.push({ key, label: heading, text: link.text, rewritable: false });
      else out.push({ key, label: heading, text, rewritable: true });
    }
  }
  const printed = add.companyClauses ?? [];
  const linkedRefs = new Set([...linked.values()].map((l) => l.ref));
  for (const ref of add.clauses) {
    if (linkedRefs.has(ref)) continue;
    if (isCompanyClauseRef(ref)) {
      const p = printed.find((x) => `cc:${x.id}` === ref);
      if (p) out.push({ key: ref, label: p.title, text: `${p.title}: ${p.text}`, rewritable: false });
    } else {
      const k = CONTRACT_CLAUSES[ref as ContractClauseId];
      if (k) out.push({ key: ref, label: k.title, text: `${k.title}: ${k.text}`, rewritable: false });
    }
  }
  if (add.freeText) out.push({ key: "free_text", label: "Additional terms", text: add.freeText, rewritable: true });
  return out;
}

/** What the marks helper sees: each paragraph's wording with its {{bN}} blanks, the pinned rules and the unit's emirate. */
async function marksContext(
  tx: Tx,
  row: ChangeRow,
  author: "signer" | "officer" = "signer",
): Promise<MarksContext | null> {
  const marks = row.marks;
  if (!marks?.length) return null;
  const [c] = await tx.db.select().from(contracts).where(eq(contracts.id, row.contractId));
  const [lu] = await tx.db
    .select({ rulesVersion: leases.rulesVersion, emirate: units.emirate })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, row.leaseId));
  if (!c || !lu) return null;
  // The template wording (with blanks) of the template the contract was prepared from, as the approval recorded it.
  const raw = new Map<string, string>();
  const [a] = c.approvalId ? await tx.db.select().from(approvals).where(eq(approvals.id, c.approvalId)) : [];
  const templateId = (a?.proposal as { template?: { id?: string } } | undefined)?.template?.id;
  let parsed: ReturnType<typeof parseTemplate> | null = null;
  // D72: template paragraphs that print a company clause, by paragraph key. Marks there belong to the clause.
  const linked = new Map<string, { ref: string; title: string; text: string }>();
  if (templateId) {
    const rows = await tx.db.select().from(companyClauses).where(eq(companyClauses.inTemplateId, templateId));
    for (const k of rows)
      if (k.templateParagraphKey)
        linked.set(k.templateParagraphKey, { ref: `cc:${k.id}`, title: k.title, text: k.textEn });
  }
  if (templateId) {
    const [t] = await tx.db.select().from(companyContractTemplates).where(eq(companyContractTemplates.id, templateId));
    if (t) {
      parsed = parseTemplate(t);
      for (const p of templateParagraphs(parsed.sections)) raw.set(p.key, p.text);
    }
  }
  for (const r of c.templateRewrites) if (raw.get(r.key) === r.before) raw.set(r.key, r.after);
  const add = c.addendum as Addendum;
  const texts = c.paragraphTexts ?? unknownPlaceParagraphs(parsed, raw, add, linked);
  const marked = new Set(
    marks.map((m) =>
      m.anchor.kind === "paragraph" ? m.anchor.key : m.anchor.kind === "clause" ? m.anchor.ref : "free_text",
    ),
  );
  const blankField = new Map((parsed?.blanks ?? []).map((b) => [b.id, b.field]));
  const holdsCore = (text: string) =>
    [...text.matchAll(/\{\{(b\d+)\}\}/g)].some((m) => CORE_FIELDS.has(blankField.get(m[1]!) ?? ""));
  const paragraphs = [...texts.filter((p) => marked.has(p.key)), ...texts.filter((p) => !marked.has(p.key))]
    .slice(0, 200)
    .map((p) => {
      const link = linked.get(p.key);
      // A paragraph that prints a company clause is that clause: its key is the clause ref, never reworded in place.
      if (link) return { key: link.ref, raw: p.text.slice(0, 4000), label: p.label, rewritable: false };
      const text = (p.key === "free_text" ? (add.freeText ?? p.text) : (raw.get(p.key) ?? p.text)).slice(0, 4000);
      return {
        key: p.key,
        raw: text,
        label: p.label,
        rewritable: p.rewritable,
        ...(holdsCore(text) ? { core: true } : {}),
      };
    });
  const rb = getRulebook(lu.rulesVersion);
  return {
    marks: marks.map((m) => {
      // D72: a mark with no known place (prepared before D71) is placed by code, with no model, for a signer's mark.
      // An officer's is placed by the helper, which also reads the model's key (the quote must still be in it).
      let anchor: ChangeMark["anchor"] = m.anchor;
      const link = anchor.kind === "paragraph" ? linked.get(anchor.key) : undefined;
      if (link && anchor.kind === "paragraph") anchor = { kind: "clause", ref: link.ref, label: anchor.label };
      if (anchor.kind === "unknown" && author === "signer") {
        const p = findQuotePlace(paragraphs, m.quote);
        if (p) anchor = anchorFor(p);
      }
      return {
        n: m.n,
        quote: m.quote,
        note: m.note,
        author,
        ...(anchor.kind === "paragraph"
          ? { key: anchor.key }
          : anchor.kind === "free_text"
            ? { key: "free_text" }
            : {}),
        anchor: anchor.kind,
        ...(anchor.kind === "clause" ? { clauseRef: anchor.ref } : {}),
      };
    }),
    freeText: (add.freeText ?? "").slice(0, 4000),
    paragraphs,
    rules: {
      renewalNoticeDays: rb.renewalNoticeDays,
      repossessionNoticeMonths: rb.repossessionNoticeMonths,
      lateRentDaysAfterFormalReminder: rb.lateRentDaysAfterFormalReminder,
    },
    emirate: lu.emirate,
  };
}

/** The checked rewrites go onto their marks; a refused or failed mark keeps its problems for staff. */
function applyMarkResults(
  marks: ChangeMark[],
  context: MarksContext,
  data: MarksData | null,
  failure: string,
  author: "ai" | "officer" = "ai",
  /** D72: plans an officer's term change against the lease's records (code). Absent: term changes are not offered. */
  planTerms?: (change: TermValues) => TermPlan,
): ChangeMark[] {
  const paragraphs = context.paragraphs;
  return marks.map((m0) => {
    // D72: a place found by code (a signer's, from the context) or by the helper (an officer's) is stored on the mark.
    const placed = context.marks.find((x) => x.n === m0.n);
    const key =
      m0.anchor.kind === "paragraph" && placed?.anchor === "clause"
        ? (placed.clauseRef ?? null)
        : m0.anchor.kind !== "unknown"
          ? null
          : (data?.places.find((x) => x.n === m0.n)?.key ??
            (placed && placed.anchor !== "unknown" ? (placed.clauseRef ?? placed.key ?? null) : null));
    const at = key ? paragraphs.find((p) => p.key === key) : undefined;
    const m: ChangeMark = at ? { ...m0, anchor: anchorFor(at) } : m0;
    if (!data) return { ...m, rewrite: null, problems: [failure] };
    const w = data.rewrites.find((x) => x.n.includes(m.n));
    if (w) {
      const rewrite: MarkRewrite = {
        target: w.key === "free_text" ? "free_text" : "paragraph",
        key: w.key,
        before: paragraphs.find((p) => p.key === w.key)?.raw ?? "",
        after: w.after,
        summary: w.summary,
        author,
      };
      return { ...m, rewrite, problems: [] };
    }
    const rm = data.removals.find((x) => x.n.includes(m.n));
    if (rm) {
      const rewrite: MarkRewrite = {
        target: "clause_remove",
        key: rm.key,
        before: rm.before.slice(0, 4000),
        // D72: an officer's reworded clause: the clause goes and this sentence joins the additional terms.
        after: rm.after ?? "",
        summary: rm.summary,
        author,
      };
      return { ...m, rewrite, problems: [] };
    }
    const tm = planTerms ? data.terms.find((x) => x.n.includes(m.n)) : undefined;
    if (tm && planTerms) {
      const plan = planTerms(tm.changes);
      if (!Object.keys(plan.to).length)
        return { ...m, rewrite: null, problems: ["These values are already on the lease."] };
      const rewrite: MarkRewrite = {
        target: "terms",
        key: "terms",
        before: termText(plan.from),
        after: termText(plan.to),
        summary: tm.summary,
        author,
        terms: { change: tm.changes, from: plan.from, to: plan.to, problems: plan.problems },
      };
      return { ...m, rewrite, problems: [] };
    }
    const ad = data.additions.find((x) => x.n.includes(m.n));
    if (ad) {
      const rewrite: MarkRewrite = {
        target: "free_text",
        key: "free_text",
        before: ad.before,
        after: ad.after,
        summary: ad.summary,
        author,
      };
      return { ...m, rewrite, problems: [] };
    }
    const f = data.refused.find((x) => x.n === m.n);
    return { ...m, rewrite: null, problems: [f?.reason ?? "The AI gave no rewrite for this mark."] };
  });
}

/** Job for a marked request: the marks helper rewrites the paragraphs (no transaction open while the model runs). */
async function analyseMarks(ctx: EngineContext, requestId: string) {
  const staged = await withTx(ctx.database, async (tx) => {
    const [row] = await tx.db.select().from(contractChangeRequests).where(eq(contractChangeRequests.id, requestId));
    if (!row || row.status !== "open" || !row.marks?.length) return null;
    const [lease] = await tx.db
      .select({ rulesVersion: leases.rulesVersion })
      .from(leases)
      .where(eq(leases.id, row.leaseId));
    const context = await marksContext(tx, row);
    return context && lease ? { row, context, rulesVersion: lease.rulesVersion } : null;
  });
  if (!staged) return { analysed: false };
  const helper = contractMarksHelper(ctx.contractAiLlm ?? ctx.llm);
  const entity = { kind: "lease" as const, id: staged.row.leaseId };
  const helperRunId = newId();
  const run = await runOnly(
    ctx,
    helper,
    ContractMarksSchemas,
    entity,
    "contract_marks",
    staged.context,
    staged.rulesVersion,
    helperRunId,
  );
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(contractChangeRequests)
      .where(eq(contractChangeRequests.id, requestId))
      .for("update");
    if (!row || row.status !== "open" || !row.marks) return { analysed: false };
    await recordRun(ctx, tx, helper.name, entity, staged.rulesVersion, run, helperRunId);
    const ok = run.result.status === "ok" && run.result.data ? run.result.data : null;
    const marks = applyMarkResults(
      row.marks,
      staged.context,
      ok,
      (run.result.reasons[0] ?? "The AI gave no valid answer.").slice(0, 400),
    );
    await tx.db
      .update(contractChangeRequests)
      .set({ status: "analysed", marks, helperRunId })
      .where(eq(contractChangeRequests.id, requestId));
    await appendEvent(tx, ctx, {
      entity,
      type: "CONTRACT_CHANGE_ANALYSED",
      actor: `helper:${helper.name}`,
      payload: {
        requestId,
        ref: row.ref,
        helperRunId,
        marks: marks.length,
        rewritten: marks.filter((m) => m.rewrite).length,
      },
      rulesVersion: staged.rulesVersion,
    });
    return { analysed: true };
  });
}

const failedAnalysis = (reason: string): ContractChangeAnalysis => ({
  kind: "other",
  summary: "The AI could not read this request.",
  analysis: "Read the request and decide: re-issue with your own changes, or decline with a note.",
  risks: [],
  proposal: null,
  blocked: reason.slice(0, 400),
  diff: [],
});

/** Job: the helper drafts the change (no transaction open while the model runs). Safe to run twice. */
export async function analyseContractChange(ctx: EngineContext, requestId: string) {
  const [probe] = await withTx(ctx.database, (tx) =>
    tx.db
      .select({ marks: contractChangeRequests.marks })
      .from(contractChangeRequests)
      .where(eq(contractChangeRequests.id, requestId)),
  );
  if (probe?.marks?.length) return analyseMarks(ctx, requestId);
  const staged = await withTx(ctx.database, async (tx) => {
    const [row] = await tx.db.select().from(contractChangeRequests).where(eq(contractChangeRequests.id, requestId));
    if (!row || row.status !== "open") return null;
    const [lease] = await tx.db
      .select({ rulesVersion: leases.rulesVersion })
      .from(leases)
      .where(eq(leases.id, row.leaseId));
    const context = await changeContext(tx, row);
    return context && lease ? { row, context, rulesVersion: lease.rulesVersion } : null;
  });
  if (!staged) return { analysed: false };
  const helper = contractChangeHelper(ctx.contractAiLlm ?? ctx.llm);
  const entity = { kind: "lease" as const, id: staged.row.leaseId };
  const helperRunId = newId();
  const run = await runOnly(
    ctx,
    helper,
    ContractChangeSchemas,
    entity,
    "contract_change",
    staged.context,
    staged.rulesVersion,
    helperRunId,
  );
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(contractChangeRequests)
      .where(eq(contractChangeRequests.id, requestId))
      .for("update");
    if (!row || row.status !== "open") return { analysed: false };
    await recordRun(ctx, tx, helper.name, entity, staged.rulesVersion, run, helperRunId);
    const analysis =
      run.result.status === "ok" && run.result.data
        ? run.result.data
        : failedAnalysis(run.result.reasons[0] ?? "The AI gave no valid answer.");
    await tx.db
      .update(contractChangeRequests)
      .set({ status: "analysed", analysis, helperRunId })
      .where(eq(contractChangeRequests.id, requestId));
    await appendEvent(tx, ctx, {
      entity,
      type: "CONTRACT_CHANGE_ANALYSED",
      actor: `helper:${helper.name}`,
      payload: { requestId, ref: row.ref, helperRunId, kind: analysis.kind, drafted: !!analysis.proposal },
      rulesVersion: staged.rulesVersion,
    });
    return { analysed: true };
  });
}

/** Closes the request's officer task. */
async function closeTask(tx: Tx, leaseId: string, requestId: string) {
  await tx.db
    .update(tasks)
    .set({ status: "done" })
    .where(and(eq(tasks.dedupeKey, `${leaseId}:contract_change:${requestId}`), eq(tasks.status, "open")));
}

/**
 * The last open request on a version was declined or withdrawn: signing opens again. Every signer who hasn't signed
 * gets a fresh signing link (the requester's email carries the officer's note when it was declined).
 */
async function resumeIfClear(ctx: EngineContext, tx: Tx, contractId: string) {
  if (await signingPaused(tx, contractId)) return;
  const [c] = await tx.db.select().from(contracts).where(eq(contracts.id, contractId));
  if (c?.status !== "sent") return;
  const [lease] = await tx.db.select({ state: leases.state }).from(leases).where(eq(leases.id, c.leaseId));
  if (lease?.state !== "CONTRACT") return;
  const unsigned = await tx.db
    .select({ id: contractSigners.id })
    .from(contractSigners)
    .where(and(eq(contractSigners.contractId, contractId), isNull(contractSigners.signedAt)));
  const seq = await changeCount(tx, contractId);
  for (const s of unsigned) await queueLeaseMail(ctx, tx, { leaseId: c.leaseId, kind: "sign_resumed", key: s.id, seq });
}

async function lockRequest(tx: Tx, leaseId: string, requestId: string): Promise<ChangeRow> {
  const [row] = await tx.db
    .select()
    .from(contractChangeRequests)
    .where(and(eq(contractChangeRequests.id, requestId), eq(contractChangeRequests.leaseId, leaseId)))
    .for("update");
  if (!row) throw notFound("change request");
  if (!PAUSING_CHANGE_STATUSES.includes(row.status))
    throw conflict(`This request is already ${row.status}.`, "change_request_closed");
  return row;
}

export const DeclineChangeBody = z.strictObject({ note: z.string().trim().min(5).max(1000) });

/** Staff decline: the requester gets the note by email with a fresh signing link once nothing else is open. */
export async function declineContractChange(
  ctx: EngineContext,
  leaseId: string,
  requestId: string,
  body: unknown,
  actor: Actor,
  /** The marks with the officer's keep decisions and reasons, stored in the same transaction. */
  marks?: ChangeMark[],
) {
  const { note } = DeclineChangeBody.parse(body);
  return withTx(ctx.database, async (tx) => {
    const row = await lockRequest(tx, leaseId, requestId);
    await tx.db
      .update(contractChangeRequests)
      .set({
        status: "declined",
        decidedBy: actor,
        decidedAt: ctx.clock.now(),
        decisionNote: note,
        ...(marks ? { marks } : {}),
      })
      .where(eq(contractChangeRequests.id, row.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "CONTRACT_CHANGE_DECLINED",
      actor,
      payload: { requestId, ref: row.ref, contractId: row.contractId },
    });
    await closeTask(tx, leaseId, requestId);
    await resumeIfClear(ctx, tx, row.contractId);
    return { status: "declined" as const, paused: await signingPaused(tx, row.contractId) };
  });
}

/** The requester withdraws their request from the signing page. */
export async function withdrawContractChange(ctx: EngineContext, link: LinkRow | null, requestId: string) {
  return withTx(ctx.database, async (tx) => {
    if (!link || link.purpose !== "sign") throw conflict("Open the signing link from your email.");
    const [s] = await tx.db
      .select({ signer: contractSigners })
      .from(contractSigners)
      .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
      .where(eq(contractSigners.linkId, link.id))
      .for("update");
    if (!s) throw conflict("This signing link is no longer valid. Use the newest email from us.");
    const row = await lockRequest(tx, link.entityId, requestId);
    if (row.signerId !== s.signer.id) throw notFound("change request");
    await tx.db
      .update(contractChangeRequests)
      .set({ status: "withdrawn", decidedBy: `${row.role}:${row.partyId}`, decidedAt: ctx.clock.now() })
      .where(eq(contractChangeRequests.id, row.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: row.leaseId },
      type: "CONTRACT_CHANGE_WITHDRAWN",
      actor: `${row.role}:${row.partyId}` as Actor,
      payload: { requestId, ref: row.ref, contractId: row.contractId },
    });
    await closeTask(tx, row.leaseId, requestId);
    await resumeIfClear(ctx, tx, row.contractId);
    return { status: "withdrawn" as const };
  });
}

export const ReissueChangeBody = z.strictObject({
  /** The officer's edited addendum; absent means the AI's draft as it is. */
  addendum: z
    .strictObject({
      clauses: z.array(z.string()).max(MAX_ADDENDUM_CLAUSES),
      freeText: z.string().trim().max(4000).nullable(),
    })
    .optional(),
});

/**
 * Staff re-issue: a new contract version with the drafted (or edited) addendum, through the normal prepare path, so
 * it waits at the `final_contract` gate (rule 3). The old version and its other open requests are superseded.
 */
export async function reissueFromChange(
  ctx: EngineContext,
  leaseId: string,
  requestId: string,
  body: unknown,
  actor: Actor,
) {
  const b = ReissueChangeBody.parse(body ?? {});
  const row = await withTx(ctx.database, (tx) => lockRequest(tx, leaseId, requestId));
  const draft = b.addendum ?? row.analysis?.proposal ?? null;
  if (!draft) {
    throw unprocessable("There is no drafted change to use. Edit the clauses yourself, then re-issue.", [], "no_draft");
  }
  // Clauses already removed by earlier change marks stay removed in the re-issued contract.
  const [cur] = await ctx.database.db.select().from(contracts).where(eq(contracts.id, row.contractId));
  const removedBefore = (cur?.addendum as Addendum | undefined)?.removedClauses ?? [];
  const addendum = Addendum.parse({
    clauses: draft.clauses,
    freeText: draft.freeText?.trim() || null,
    ...(removedBefore.length ? { removedClauses: removedBefore } : {}),
  });
  // Lazy import: contracts.ts imports this module.
  const { prepareContract } = await import("./contracts.ts");
  return prepareContract(ctx, leaseId, {
    addendum,
    actor,
    reprepare: true,
    fromChangeRequest: true,
    afterPrepared: async (tx, r) => {
      await closeAsReissued(ctx, tx, {
        leaseId,
        row,
        r,
        actor,
        note: `Re-issued as version ${r.version}${b.addendum ? " (edited by staff)" : ""}`,
        event: {
          type: "CONTRACT_CHANGE_REISSUED",
          payload: {
            requestId,
            ref: row.ref,
            newContractId: r.contractId,
            version: r.version,
            edited: !!b.addendum,
          },
        },
      });
    },
  });
}

/**
 * Inside the preparation of the replacing version: the request becomes `reissued` (it may already show `superseded`
 * by this very prepare), a signer who signed the replaced version is told, the officer task closes.
 */
async function closeAsReissued(
  ctx: EngineContext,
  tx: Tx,
  a: {
    leaseId: string;
    row: ChangeRow;
    r: { contractId: string; version: number };
    actor: Actor;
    note: string;
    event: { type: string; payload: Record<string, unknown> };
    marks?: ChangeMark[];
  },
) {
  const { leaseId, row, r, actor } = a;
  const [cur] = await tx.db
    .select({ status: contractChangeRequests.status, note: contractChangeRequests.decisionNote })
    .from(contractChangeRequests)
    .where(eq(contractChangeRequests.id, row.id))
    .for("update");
  // `superseded` only by this very prepare (its note names the new version); closed any other way, it stays closed
  // and the whole preparation rolls back.
  const supersededNow =
    cur?.status === "superseded" && cur.note === `The contract was replaced by version ${r.version}.`;
  if (!cur || !(cur.status === "open" || cur.status === "analysed" || supersededNow))
    throw conflict("This request was closed a moment ago.", "change_request_closed");
  // A party who already signed the replaced version is told their signature no longer applies (no request text).
  const signedBefore = await tx.db
    .select({ id: contractSigners.id })
    .from(contractSigners)
    .where(and(eq(contractSigners.contractId, row.contractId), isNotNull(contractSigners.signedAt)));
  for (const x of signedBefore) {
    await queueLeaseMail(ctx, tx, { leaseId, kind: "signed_replaced", key: x.id, seq: r.version });
  }
  await tx.db
    .update(contractChangeRequests)
    .set({
      status: "reissued",
      newContractId: r.contractId,
      decidedBy: actor,
      decidedAt: ctx.clock.now(),
      decisionNote: a.note,
      ...(a.marks ? { marks: a.marks } : {}),
    })
    .where(eq(contractChangeRequests.id, row.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: leaseId },
    type: a.event.type,
    actor,
    payload: a.event.payload,
  });
  await closeTask(tx, leaseId, row.id);
}

/** A contract version was replaced: its open requests close (called by `supersedeOpenContracts`). */
export async function supersedeChangeRequests(ctx: EngineContext, tx: Tx, contractId: string, note: string) {
  const open = await tx.db
    .select()
    .from(contractChangeRequests)
    .where(and(eq(contractChangeRequests.contractId, contractId), pausing));
  for (const r of open) {
    await tx.db
      .update(contractChangeRequests)
      .set({ status: "superseded", decidedAt: ctx.clock.now(), decisionNote: `The contract was ${note}.` })
      .where(eq(contractChangeRequests.id, r.id));
    await closeTask(tx, r.leaseId, r.id);
  }
}

/** Staff and copilot view: every request on the lease, newest first, with the AI's analysis. */
export async function leaseChangeRequests(db: Pick<Tx, "db">["db"], leaseId: string) {
  const rows = await db
    .select({ r: contractChangeRequests, version: contracts.version })
    .from(contractChangeRequests)
    .innerJoin(contracts, eq(contracts.id, contractChangeRequests.contractId))
    .where(eq(contractChangeRequests.leaseId, leaseId))
    .orderBy(desc(contractChangeRequests.createdAt));
  return rows.map(({ r, version }) => ({
    id: r.id,
    ref: r.ref,
    contractId: r.contractId,
    version,
    role: r.role,
    target: r.target,
    text: r.text,
    marks: r.marks,
    status: r.status,
    analysis: r.analysis,
    helperRunId: r.helperRunId,
    newContractId: r.newContractId,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
  }));
}

/** The decline note for the signer's newest declined request on this version (for the "signing open again" email). */
export async function declineNoteFor(tx: Pick<Tx, "db">, contractId: string, signerId: string): Promise<string | null> {
  const [r] = await tx.db
    .select({ note: contractChangeRequests.decisionNote, status: contractChangeRequests.status })
    .from(contractChangeRequests)
    .where(and(eq(contractChangeRequests.contractId, contractId), eq(contractChangeRequests.signerId, signerId)))
    .orderBy(desc(contractChangeRequests.decidedAt))
    .limit(1);
  return r?.status === "declined" ? r.note : null;
}

/* ---- Change marks: the officer's side (own wording, preview, approve) ---- */

export const MarkWordingBody = z.strictObject({ text: z.string().trim().min(3).max(2000) });
const MarkNo = z.string().regex(/^\d{1,2}$/);
export const MarkDecisionsBody = z.strictObject({
  /** Every mark of the request, by number. */
  decisions: z.record(MarkNo, z.enum(["apply", "keep"])),
  keepReasons: z.record(MarkNo, z.string().trim().max(500)).optional(),
});
export type MarkDecisionsBody = z.infer<typeof MarkDecisionsBody>;

/** A marked request the officer can work on: the AI has answered (every mark has a rewrite or problems). */
async function lockMarked(tx: Tx, leaseId: string, requestId: string): Promise<ChangeRow & { marks: ChangeMark[] }> {
  const row = await lockRequest(tx, leaseId, requestId);
  if (!row.marks?.length) throw conflict("This request has no marked text.", "no_marks");
  if (row.status !== "analysed")
    throw conflict("The AI is still reading the marks. Try again in a moment.", "not_analysed");
  return { ...row, marks: row.marks };
}

const markLabel = (m: ChangeMark) => (m.anchor.kind === "unknown" ? `page ${m.page}` : m.anchor.label);

/**
 * The officer writes their own wording for one mark (typically one the AI refused). The marks helper runs again for
 * that mark with the officer's text as the request and the same code checks; the result replaces the mark's rewrite
 * (author "officer") or its problems. The officer's text is stored on the mark as `officerNote`, never in an event.
 */
export async function officerMarkWording(
  ctx: EngineContext,
  leaseId: string,
  requestId: string,
  n: number,
  body: unknown,
  actor: Actor,
) {
  const { text } = MarkWordingBody.parse(body);
  const staged = await withTx(ctx.database, async (tx) => {
    const row = await lockMarked(tx, leaseId, requestId);
    const mark = row.marks.find((m) => m.n === n);
    if (!mark) throw notFound("mark");
    const [lease] = await tx.db
      .select({ rulesVersion: leases.rulesVersion })
      .from(leases)
      .where(eq(leases.id, leaseId));
    const context = await marksContext(tx, { ...row, marks: [{ ...mark, note: text }] }, "officer");
    if (!context || !lease) throw conflict("The contract is not available.", "no_contract");
    // D72: the lease's records, to plan a term change the officer writes (read only).
    const terms = await termInputs(ctx, tx, leaseId).catch(() => null);
    return { context, rulesVersion: lease.rulesVersion, mark, terms };
  });
  const helper = contractMarksHelper(ctx.contractAiLlm ?? ctx.llm);
  const entity = { kind: "lease" as const, id: leaseId };
  const helperRunId = newId();
  const run = await runOnly(
    ctx,
    helper,
    ContractMarksSchemas,
    entity,
    "contract_marks",
    staged.context,
    staged.rulesVersion,
    helperRunId,
  );
  return withTx(ctx.database, async (tx) => {
    const row = await lockMarked(tx, leaseId, requestId);
    const mark = row.marks.find((m) => m.n === n);
    if (!mark) throw notFound("mark");
    await recordRun(ctx, tx, helper.name, entity, staged.rulesVersion, run, helperRunId);
    const ok = run.result.status === "ok" && run.result.data ? run.result.data : null;
    const [answered] = applyMarkResults(
      [{ ...mark, note: text }],
      staged.context,
      ok,
      (run.result.reasons[0] ?? "The AI gave no valid answer.").slice(0, 400),
      "officer",
      staged.terms ? (c) => planFor(staged.terms!, c) : undefined,
    );
    const updated: ChangeMark = {
      ...mark,
      anchor: answered!.anchor,
      officerNote: text,
      rewrite: answered!.rewrite ? { ...answered!.rewrite, author: "officer" } : null,
      problems: answered!.problems,
      // A changed wording needs a fresh decision.
      decision: null,
    };
    await tx.db
      .update(contractChangeRequests)
      .set({ marks: row.marks.map((m) => (m.n === n ? updated : m)) })
      .where(eq(contractChangeRequests.id, requestId));
    await appendEvent(tx, ctx, {
      entity,
      type: "CONTRACT_CHANGE_WORDING",
      actor,
      payload: { requestId, ref: row.ref, n, helperRunId, accepted: !!updated.rewrite },
      rulesVersion: staged.rulesVersion,
    });
    return { n, rewrite: updated.rewrite, problems: updated.problems };
  });
}

interface MarksPlan {
  addendum: Addendum;
  /** The full list of reworded paragraphs: the open version's, merged with the marks, per paragraph key. */
  rewrites: TemplateRewrite[];
  applied: number[];
  kept: number[];
  /** One line per kept mark: its label and the officer's reason. */
  keptLines: string[];
  marks: ChangeMark[];
  /** D72: the lease terms the applied marks change (what the officer wrote, merged), or null. */
  terms: { change: TermValues; marks: number[]; problems: string[] } | null;
}

/**
 * Turns the officer's decisions into the addendum and rewrites of the next version, in code. Every mark needs a
 * decision; an applied mark needs a passing rewrite; two marks may not change the same text differently. A kept
 * mark changes nothing, so its paragraph prints as it did. Throws 422 listing every problem.
 */
function planMarks(row: ChangeRow & { marks: ChangeMark[] }, c: ContractRow, body: MarkDecisionsBody): MarksPlan {
  const problems: string[] = [];
  const numbers = new Set(row.marks.map((m) => m.n));
  for (const k of Object.keys(body.decisions)) {
    if (!numbers.has(Number(k))) problems.push(`There is no mark ${k}.`);
  }
  const marks: ChangeMark[] = row.marks.map((m) => {
    const decision = body.decisions[String(m.n)] ?? null;
    if (!decision) problems.push(`Mark ${m.n} needs a decision (apply or keep).`);
    if (decision === "apply" && (!m.rewrite || m.problems.length)) {
      problems.push(`Mark ${m.n} has no passing rewrite. Write your own wording for it or keep it.`);
    }
    return { ...m, decision, keepReason: decision === "keep" ? body.keepReasons?.[String(m.n)]?.trim() || null : null };
  });
  const prev = c.addendum as Addendum;
  const clauses = [...prev.clauses];
  const removed = [...(prev.removedClauses ?? [])];
  let freeText: string | null = prev.freeText ?? null;
  const rewrites = [...c.templateRewrites];
  const texts = c.paragraphTexts ?? [];
  const done = new Map<string, { after: string; n: number }>();
  const termMarks: { n: number; change: TermValues; problems: string[] }[] = [];
  for (const m of marks) {
    const w = m.rewrite;
    if (m.decision !== "apply" || !w || m.problems.length) continue;
    if (w.target === "terms") {
      if (!w.terms) problems.push(`Mark ${m.n}: the lease terms to change are missing.`);
      else termMarks.push({ n: m.n, change: w.terms.change, problems: w.terms.problems });
      continue;
    }
    const id = `${w.target}:${w.key}`;
    const same = done.get(id);
    // Several marks in one paragraph share one rewrite; a different rewrite of the same text is a conflict.
    if (same) {
      if (same.after !== w.after)
        problems.push(`Marks ${same.n} and ${m.n} change the same text differently. Apply one.`);
      continue;
    }
    done.set(id, { after: w.after, n: m.n });
    if (w.target === "paragraph") {
      const t = texts.find((p) => p.key === w.key);
      const at = rewrites.findIndex((r) => r.key === w.key);
      const old = at >= 0 ? rewrites[at]! : null;
      // A version prepared before D71 has no stored paragraph list: the marks context already checked the place.
      if (c.paragraphTexts && !t?.rewritable)
        problems.push(`Mark ${m.n}: this part of the contract can't be reworded.`);
      else if (old && w.before !== old.after && w.before !== old.before) {
        problems.push(`Mark ${m.n}: the paragraph changed since the AI read it.`);
      } else {
        const merged = {
          key: w.key,
          before: old?.before ?? w.before,
          after: w.after,
          reason: `Change mark: ${w.summary}`,
        };
        if (at >= 0) rewrites[at] = merged;
        else rewrites.push(merged);
      }
    } else if (w.target === "free_text") {
      if ((freeText ?? "").trim() !== w.before.trim())
        problems.push(`Mark ${m.n}: the additional terms changed since the AI read them.`);
      else freeText = w.after;
    } else if (w.target === "clause_remove") {
      const at = clauses.findIndex((x) => x === w.key);
      // A clause only the contract rule lists (a linked template paragraph) is removed by name: it stops printing.
      if (at < 0 && !(m.anchor.kind === "clause" && m.anchor.ref === w.key)) {
        problems.push(`Mark ${m.n}: that clause is not on the contract any more.`);
      } else {
        if (at >= 0) clauses.splice(at, 1);
        if (!removed.includes(w.key)) removed.push(w.key);
        // D72: an officer's reworded clause: its new wording joins the additional terms.
        const said = w.after.trim();
        if (said) {
          freeText = freeText?.trim() ? `${freeText.trimEnd()} ${said}` : said;
          if (freeText.length > 4000) problems.push(`Mark ${m.n}: the additional terms would be too long.`);
        }
      }
    } else problems.push(`Mark ${m.n}: this kind of change is not supported.`);
  }
  const merged = termMarks.length ? mergeChanges(termMarks) : null;
  if (merged) problems.push(...merged.problems);
  if (problems.length) throw unprocessable("These marks can't be applied.", problems, "marks_invalid");
  const kept = marks.filter((m) => m.decision === "keep");
  return {
    addendum: Addendum.parse({
      clauses,
      freeText: freeText?.trim() || null,
      ...(removed.length ? { removedClauses: removed } : {}),
    }),
    rewrites,
    applied: marks.filter((m) => m.decision === "apply").map((m) => m.n),
    kept: kept.map((m) => m.n),
    keptLines: kept.map((m) => `Mark ${m.n} (${markLabel(m)}): ${m.keepReason ?? "no reason given"}`),
    marks,
    terms: merged ? { change: merged.change, marks: termMarks.map((t) => t.n), problems: [] } : null,
  };
}

async function markedContract(ctx: EngineContext, leaseId: string, requestId: string, body: MarkDecisionsBody) {
  return withTx(ctx.database, async (tx) => {
    const row = await lockMarked(tx, leaseId, requestId);
    const [c] = await tx.db.select().from(contracts).where(eq(contracts.id, row.contractId));
    if (!c) throw notFound("contract");
    return { row, c, plan: planMarks(row, c, body) };
  });
}

/** The contract as it would print with the applied marks, watermarked "Preview". Nothing is stored or changed. */
export async function previewChangeMarks(ctx: EngineContext, leaseId: string, requestId: string, body: unknown) {
  const b = MarkDecisionsBody.parse(body);
  const { c, plan } = await markedContract(ctx, leaseId, requestId, b);
  const { renderChangePreview } = await import("./contracts.ts");
  return renderChangePreview(ctx, leaseId, c, plan.addendum, plan.rewrites, plan.terms?.change);
}

/**
 * Approve changes. Every mark is applied or kept. With no applied mark the request is declined (D67) with a note
 * listing each kept mark and its reason. Otherwise the next version is prepared from the applied marks (no model run;
 * every check must pass or nothing is created) and its `final_contract` approved as this officer, who may approve
 * their own preparation here only (the user's ruling, amending D22 for this route).
 *
 * D72: a mark that changes lease terms changes the lease too (rent, deposit, cheques, dates), so contract, collections
 * and Ejari stay in sync. Inside the offer limits the terms are written, then the version is prepared from them; if it
 * can't be prepared the terms are put back. Outside the limits nothing changes: a leasing manager is asked
 * (`offer_out_of_limits` on the lease) and the request stays open until they decide.
 */
export async function approveChangeMarks(
  ctx: EngineContext,
  leaseId: string,
  requestId: string,
  body: unknown,
  user: StaffUser,
) {
  const b = MarkDecisionsBody.parse(body);
  const { row, plan } = await markedContract(ctx, leaseId, requestId, b);
  if (!plan.applied.length) {
    const note = `We kept the contract as it is. ${plan.keptLines.join(" ")}`.slice(0, 1000);
    return {
      ...(await declineContractChange(ctx, leaseId, requestId, { note }, userActor(user.id), plan.marks)),
      version: null as number | null,
    };
  }
  if (plan.terms) {
    const asked = await askManagerForTerms(ctx, leaseId, row, plan, b, user);
    if (asked) return asked;
  }
  return prepareFromMarks(ctx, leaseId, requestId, b, user);
}

/** Keys sorted, so two equal values hash alike whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** What a manager approves: every mark's rewrite and problems, and the officer's decision on each. */
export function marksFingerprint(marks: ChangeMark[], decisions: Record<string, "apply" | "keep">): string {
  return sha256Hex(stable({ d: decisions, m: marks.map((m) => [m.n, m.rewrite, m.problems]) }));
}

/** Outside the offer limits (rule 3): a pending approval for a leasing manager, nothing else changes. */
async function askManagerForTerms(
  ctx: EngineContext,
  leaseId: string,
  row: ChangeRow & { marks: ChangeMark[] },
  plan: MarksPlan,
  body: MarkDecisionsBody,
  user: StaffUser,
) {
  const { requestApproval } = await import("./approvals.ts");
  return withTx(ctx.database, async (tx) => {
    const i = await termInputs(ctx, tx, leaseId);
    const t = plan.terms!;
    const p = planFor(i, t.change);
    if (!p.problems.length) return null;
    if (!Object.keys(p.to).length) throw unprocessable("These values are already on the lease.", [], "marks_invalid");
    const [c] = await tx.db.select({ id: contracts.id }).from(contracts).where(eq(contracts.id, row.contractId));
    const proposal: LeaseTermsProposal = {
      kind: "lease_terms",
      leaseId,
      leaseRef: i.lease.ref,
      requestId: row.id,
      contractId: c?.id ?? row.contractId,
      decisions: body.decisions,
      ...(body.keepReasons ? { keepReasons: body.keepReasons } : {}),
      change: t.change,
      from: p.from,
      to: p.to,
      terms: p.terms,
      problems: p.problems,
      ...(p.notes.length ? { notes: p.notes } : {}),
      marksHash: marksFingerprint(row.marks, body.decisions),
    };
    const hash = sha256Hex(JSON.stringify({ d: body.decisions, c: t.change })).slice(0, 16);
    const base = `${row.id}:lease_terms:${hash}`;
    const earlier = await tx.db
      .select({ id: approvals.id, status: approvals.status, key: approvals.dedupeKey })
      .from(approvals)
      .where(like(approvals.dedupeKey, `${base}%`));
    const pending = earlier.find((e) => e.status === "pending");
    if (pending)
      return { status: "needs_manager" as const, approvalId: pending.id, problems: p.problems, paused: true };
    // A new ask for this request replaces any earlier pending one (its marks or terms differ).
    const olderPending = await tx.db
      .select({ id: approvals.id })
      .from(approvals)
      .where(
        and(
          like(approvals.dedupeKey, `${row.id}:lease_terms:%`),
          eq(approvals.status, "pending"),
          eq(approvals.entityId, leaseId),
        ),
      );
    for (const e of olderPending) {
      await tx.db
        .update(approvals)
        .set({
          status: "cancelled",
          decidedAt: ctx.clock.now(),
          decisionNote: "Replaced by a newer approval for this change request.",
        })
        .where(eq(approvals.id, e.id));
    }
    const r = await requestApproval(ctx, tx, {
      gate: "offer_out_of_limits",
      entity: { kind: "lease", id: leaseId },
      dedupeKey: earlier.length ? `${base}:${earlier.length}` : base,
      title: `Lease ${i.lease.ref}: change terms outside the limits (${termText(p.to)})`,
      proposal,
      reasons: [
        ...p.problems,
        ...p.notes,
        `Asked by the leasing officer through change request ${row.ref}. Approving applies the change to the lease and prepares a new contract version.`,
      ],
      sources: [],
      rulesVersion: i.lease.rulesVersion,
      proposedBy: userActor(user.id),
    });
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "LEASE_TERMS_NEEDS_MANAGER",
      actor: userActor(user.id),
      payload: { requestId: row.id, ref: row.ref, approvalId: r.id, from: p.from, to: p.to, outsideLimits: p.problems },
      rulesVersion: i.lease.rulesVersion,
    });
    return { status: "needs_manager" as const, approvalId: r.id, problems: p.problems, paused: true };
  });
}

/**
 * D72: when the change moves the start date, the version in force on the NEW start governs the new term (ruling), so
 * the law-only checks on every applied wording run again against that version. (The contract checks of
 * `prepareContract` read the planned records, which carry the new version too.)
 */
async function checkAgainstNewTerm(ctx: EngineContext, leaseId: string, plan: MarksPlan, newStart: CalendarDate) {
  const [lu] = await ctx.database.db
    .select({ startOn: leases.startOn, emirate: units.emirate })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  if (!lu || lu.startOn === newStart) return;
  const rb = getRulebook(rulesVersionForTerm(newStart, lu.emirate));
  const problems: string[] = [];
  for (const m of plan.marks) {
    const w = m.rewrite;
    if (m.decision !== "apply" || !w || w.target === "terms") continue;
    for (const pr of checkMarkRewrite({
      before: w.before,
      after: w.after,
      notes: [m.officerNote ?? m.note],
      rules: {
        renewalNoticeDays: rb.renewalNoticeDays,
        repossessionNoticeMonths: rb.repossessionNoticeMonths,
        lateRentDaysAfterFormalReminder: rb.lateRentDaysAfterFormalReminder,
      },
      emirate: lu.emirate,
      rewritable: true,
      author: w.author === "officer" ? "officer" : "signer",
    }))
      problems.push(`Mark ${m.n}: ${pr}`);
  }
  if (problems.length)
    throw unprocessable(
      `These changes break the rules in force on the new start date (${rb.version}).`,
      problems,
      "marks_check_failed",
    );
}

/**
 * Applies the officer's decisions: writes the lease terms (when marks change them), prepares the next version from
 * the applied marks and approves its `final_contract`, all as `user`. With `viaApprovalId` the user is the manager
 * deciding the lease's `offer_out_of_limits` approval, which is recorded as approved in the same transaction as the new
 * version; a failure leaves it pending. If the version can't be prepared the lease terms are put back.
 */
export async function prepareFromMarks(
  ctx: EngineContext,
  leaseId: string,
  requestId: string,
  b: MarkDecisionsBody,
  user: StaffUser,
  viaApprovalId?: string,
  /** A manager's decision: exactly what was sent for approval (the planned terms, the marks and the change). */
  frozen?: { snapshot: TermSnapshot; marksHash: string; change: TermValues },
) {
  const actor = userActor(user.id);
  const { row, plan } = await markedContract(ctx, leaseId, requestId, b);
  const marksHash = JSON.stringify(row.marks);
  // A manager approves what they were shown: refuse if the officer's marks or decisions changed since.
  if (
    frozen &&
    (marksFingerprint(row.marks, b.decisions) !== frozen.marksHash ||
      stable(plan.terms?.change ?? null) !== stable(frozen.change))
  )
    throw conflict("The marks changed since this was sent for approval.", "change_request_changed");
  const { prepareContract } = await import("./contracts.ts");
  const { decideApprovalIn } = await import("./approvals.ts");
  const reasons = [
    `Change marks from request ${row.ref}: applied ${plan.applied.join(", ")}.`,
    ...(plan.kept.length ? [`Kept as they were: ${plan.keptLines.join(" ")}`] : []),
    "The officer chose and approved these changes; the contract was not reviewed by the contract AI again.",
  ];
  // D72: the terms change in the same transaction that stores the new version (see prepareContract's `fromMarks.terms`).
  // A manager's decision applies the snapshot they were shown; otherwise the change is planned now, inside the limits.
  let termsArg: NonNullable<Parameters<typeof prepareContract>[2]["fromMarks"]>["terms"];
  if (plan.terms) {
    const t = plan.terms;
    let snapshot = frozen?.snapshot;
    if (!snapshot) {
      const p = await withTx(ctx.database, async (tx) => planFor(await termInputs(ctx, tx, leaseId), t.change));
      if (p.problems.length)
        throw conflict("These terms are outside the limits; a leasing manager must approve them.", "needs_manager");
      snapshot = { terms: p.terms, from: p.from, notes: p.notes };
    }
    const to = Object.fromEntries(Object.keys(snapshot.from).map((k) => [k, snapshot!.terms[k as keyof TermValues]]));
    termsArg = {
      snapshot,
      marks: t.marks,
      requestId,
      ref: row.ref,
      ...(viaApprovalId ? { approvalId: viaApprovalId } : {}),
    };
    reasons.push(
      `Lease terms changed: ${termText(snapshot.from)} to ${termText(to as TermValues)}.`,
      ...(snapshot.notes ?? []),
    );
    await checkAgainstNewTerm(ctx, leaseId, plan, snapshot.terms.startOn as CalendarDate);
  }
  {
    const r = await prepareContract(ctx, leaseId, {
      actor,
      reprepare: true,
      fromChangeRequest: true,
      fromMarks: {
        rewrites: plan.rewrites,
        addendum: plan.addendum,
        helperRunId: row.helperRunId,
        reasons,
        ...(termsArg ? { terms: termsArg } : {}),
      },
      afterPrepared: async (tx, p) => {
        // The marks may have been re-analysed or edited since the plan was made: refuse, nothing is created.
        const [fresh] = await tx.db
          .select({ marks: contractChangeRequests.marks })
          .from(contractChangeRequests)
          .where(eq(contractChangeRequests.id, row.id))
          .for("update");
        if (JSON.stringify(fresh?.marks ?? null) !== marksHash) {
          throw conflict(
            "The marks changed while this was being approved. Review them again.",
            "change_request_changed",
          );
        }
        await closeAsReissued(ctx, tx, {
          leaseId,
          row,
          r: p,
          actor,
          note: `Changes approved as version ${p.version}.${plan.kept.length ? ` ${plan.keptLines.join(" ")}` : ""}`.slice(
            0,
            1000,
          ),
          marks: plan.marks,
          // The marks and their decisions and the check results: never the signer's or the officer's text.
          event: {
            type: "CONTRACT_CHANGE_MARKS_APPROVED",
            payload: {
              requestId,
              ref: row.ref,
              newContractId: p.contractId,
              version: p.version,
              marks: plan.marks.map((m) => m.n),
              decisions: Object.fromEntries(plan.marks.map((m) => [m.n, m.decision])),
              authors: Object.fromEntries(plan.marks.filter((m) => m.rewrite).map((m) => [m.n, m.rewrite!.author])),
              removedClauses: plan.addendum.removedClauses ?? [],
              ...(plan.terms ? { termMarks: plan.terms.marks } : {}),
              checks: p.checks,
            },
          },
        });
        // D72: the reservation already paid is not changed; finance follows up when the new terms differ from its basis.
        if (termsArg?.snapshot.notes?.length)
          await createTask(ctx, tx, leaseId, {
            kind: "reservation_review",
            title: `Lease ${row.ref}: the new rent or deposit differs from the reservation basis. Check the reservation already paid.`,
            details: { requestId, version: p.version, notes: termsArg.snapshot.notes },
            assigneeRole: "finance",
            dueOn: ctx.clock.today(),
            dedupeKey: `${leaseId}:reservation_review:${p.version}`,
          });
        if (viaApprovalId)
          await decideApprovalIn(ctx, tx, viaApprovalId, user, { decision: "approve" }, { leaseTermsApplied: true });
        await decideApprovalIn(ctx, tx, p.approvalId, user, { decision: "approve" }, { allowPreparer: true });
      },
    });
    if (r.status !== "prepared") {
      throw unprocessable(
        "The contract with these changes can't be prepared.",
        r.status === "needs_human" ? r.reasons : [],
        "marks_check_failed",
      );
    }
    return {
      status: "approved" as const,
      version: r.version,
      contractId: r.contractId,
      approvalId: r.approvalId,
      paused: false,
    };
  }
}
