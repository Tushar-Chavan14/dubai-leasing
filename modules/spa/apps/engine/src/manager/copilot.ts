import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { COPILOT_TOOLS, copilotTurn, engineClient, hasAmlWord, RULEBOOK_KEYS, type Transport } from "@spa/copilot";
import type { SpaRole } from "@spa/core";
import {
  type AssistantKind,
  assistantMessages,
  assistantThreads,
  type CopilotDraftKind,
  type CopilotProposalKind,
  copilotDrafts,
  copilotProposals,
  deals,
  signatures,
  signingEnvelopes,
  withSpaTx,
} from "@spa/db";
import { getSalesRulebook, isPending, type RulebookField, salesRulebookOn } from "@spa/rulebook";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import {
  type AssistantRuntime,
  hourBucket,
  principalHash,
  storeTurn,
  storeUserMessage,
  takeRateLimit,
  threadFor,
} from "./assistants.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, gone, notFound, SpaDomainError, tooMany, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { requestDocuments } from "./kyc.ts";
import { enqueuePrepare } from "./prepare.ts";
import { BadQuery } from "./reads.ts";
import { resendSigningLink } from "./signing.ts";
import { openTask } from "./tasks.ts";

/**
 * The staff copilot's engine side (C36, S68). The copilot reads through the existing role-filtered routes, so the only new
 * reads are the rulebook value and the NOC status. A proposal is a stored request for one of four actions: it does nothing
 * until the same user confirms it, and confirming runs the normal manager function as that user. Nothing here approves,
 * sends, signs, submits, clears or edits a setting; a test scans this file for the manager functions that do.
 */
type Person = { id: string; role: SpaRole };

/** A proposal is good for this long; after that it is marked expired and Confirm answers 410. */
export const PROPOSAL_TTL_MINUTES = 30;
/** The chat takes at most this many messages an hour per user. */
export const COPILOT_MESSAGES_PER_HOUR = 120;
const TERMINAL = ["COMPLETED", "HANDED_OVER", "CANCELLED"];
const KIND_TOOL: Record<CopilotDraftKind, string> = {
  email: "draft_email",
  summary: "draft_summary",
  approval_note: "draft_approval_note",
};
const toolRoles = (name: string): readonly SpaRole[] => COPILOT_TOOLS.find((t) => t.name === name)?.roles ?? [];

// ---------------------------------------------------------------------------------------------
// The rulebook value (the only source of a legal or money value for the copilot)

export const RulebookQuery = z.object({ key: z.enum(RULEBOOK_KEYS), dealId: z.uuid().optional() });

export async function copilotRulebook(ctx: SpaContext, q: z.infer<typeof RulebookQuery>) {
  const lookup = ctx.rulebook ?? getSalesRulebook;
  let version: string | null = null;
  if (q.dealId) {
    const [d] = await ctx.database.db.select({ v: deals.rulesVersion }).from(deals).where(eq(deals.id, q.dealId));
    if (!d) throw notFound("deal");
    version = d.v;
  } else version = salesRulebookOn("dubai", ctx.clock.today())?.version ?? null;
  const rb = version ? lookup(version) : null;
  if (!rb) throw unprocessable("rulebook_unavailable", "no rulebook is in force");
  if (isPending(rb, q.key as RulebookField))
    return { key: q.key, rulesVersion: rb.version, status: "pending confirmation" as const };
  const v = rb[q.key as keyof typeof rb] as unknown;
  const base = { key: q.key, rulesVersion: rb.version, status: "confirmed" as const };
  if (q.key.endsWith("Bps") && typeof v === "number") return { ...base, bps: v, percent: v / 100 };
  if (q.key.endsWith("Fils") && typeof v === "number") return { ...base, amountFils: v };
  return { ...base, value: String(v) };
}

// ---------------------------------------------------------------------------------------------
// Storing a proposal or a draft

const ThreadId = z.uuid();
export const ProposalBody = z.object({
  threadId: ThreadId,
  kind: z.enum(["request_documents", "create_task", "resend_signing_link", "prepare_agreement"]),
  dealId: z.uuid().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const DraftBody = z.object({
  threadId: ThreadId,
  kind: z.enum(["email", "summary", "approval_note"]),
  dealId: z.uuid().nullable().optional(),
  body: z.string().trim().min(10).max(2000),
  to: z.enum(["buyer", "seller", "broker", "colleague"]).optional(),
  subject: z.string().trim().min(3).max(120).optional(),
});
const TaskPayload = z.object({
  title: z.string().trim().min(3).max(120),
  forRole: z.enum(["sales_officer", "sales_manager", "sales_admin", "legal", "finance"]).optional(),
});
const ResendPayload = z.object({ signatureId: z.uuid() });

/** The thread must be this user's own staff thread: a hash of the user id, never the id. */
async function ownThread(ctx: SpaContext, threadId: string, user: Person): Promise<void> {
  const [t] = await ctx.database.db.select().from(assistantThreads).where(eq(assistantThreads.id, threadId));
  if (!t || t.kind !== "staff" || t.principalHash !== principalHash("staff", user.id)) throw notFound("thread");
}

async function openDeal(ctx: SpaContext, dealId: string) {
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  if (TERMINAL.includes(d.state)) throw conflict("deal_closed", `this deal is ${d.state.toLowerCase()}`);
  return d;
}

/** Never names the deal's state: a hold for a compliance review must not be told to a role outside compliance (S42, S57). */
const notAtAgreementStep = () =>
  conflict("not_in_agreement_draft", "this deal is not at the step where an agreement is prepared");

export async function storeProposal(ctx: SpaContext, user: Person, raw: z.infer<typeof ProposalBody>) {
  await ownThread(ctx, raw.threadId, user);
  if (!toolRoles(raw.kind).includes(user.role)) throw forbidden("your role can't ask for this");
  if (raw.kind !== "create_task" && !raw.dealId) throw new BadQuery("a deal is needed for this proposal");
  const deal = raw.dealId ? await openDeal(ctx, raw.dealId) : null;
  let payload: Record<string, unknown> = {};
  let summary: string;
  switch (raw.kind) {
    case "request_documents":
      summary = `ask the buyers and sellers of ${deal!.ref} for their documents`;
      break;
    case "prepare_agreement":
      if (deal!.state !== "AGREEMENT_DRAFT") throw notAtAgreementStep();
      summary = `prepare the agreement for ${deal!.ref} (legal still has to approve it)`;
      break;
    case "create_task": {
      const t = TaskPayload.safeParse(raw.payload);
      if (!t.success)
        throw unprocessable("invalid_task", "a task needs a title of 3 to 120 characters and a work role");
      // A task title is plain words for the role that sees it: never a compliance word, never personal data (S55).
      if (hasAmlWord(t.data.title))
        throw unprocessable("invalid_task", "a task title can't mention compliance matters");
      const title = maskPiiText(t.data.title);
      payload = { title, ...(t.data.forRole ? { forRole: t.data.forRole } : {}) };
      summary = `open a task "${title}"${deal ? ` on ${deal.ref}` : ""} for ${(t.data.forRole ?? user.role).replaceAll("_", " ")}`;
      break;
    }
    case "resend_signing_link": {
      const p = ResendPayload.safeParse(raw.payload);
      if (!p.success) throw unprocessable("invalid_signature", "name the signature to resend");
      const [s] = await ctx.database.db
        .select({ s: signatures, e: signingEnvelopes })
        .from(signatures)
        .innerJoin(signingEnvelopes, eq(signingEnvelopes.id, signatures.envelopeId))
        .where(and(eq(signatures.id, p.data.signatureId), eq(signingEnvelopes.dealId, deal!.id)));
      if (!s) throw notFound("signature");
      if (s.s.signedAt) throw conflict("already_signed", "this person has already signed");
      if (s.e.status !== "open") throw conflict("signing_closed", `the signing is ${s.e.status}`);
      payload = { signatureId: s.s.id };
      summary = `email a new signing link to the ${s.s.role} who signs ${s.s.seq === 1 ? "first" : `in place ${s.s.seq}`} on ${deal!.ref}`;
      break;
    }
  }
  const id = newId();
  const now = ctx.clock.now();
  const expiresAt = new Date(now.getTime() + PROPOSAL_TTL_MINUTES * 60_000);
  await ctx.database.db.insert(copilotProposals).values({
    id,
    threadId: raw.threadId,
    userId: user.id,
    kind: raw.kind,
    dealId: raw.dealId ?? null,
    payload: { ...payload, summary },
    expiresAt,
    createdAt: now,
  });
  return { id, kind: raw.kind, status: "proposed" as const, expiresAt: expiresAt.toISOString(), summary };
}

export async function storeDraft(ctx: SpaContext, user: Person, raw: z.infer<typeof DraftBody>) {
  await ownThread(ctx, raw.threadId, user);
  if (!toolRoles(KIND_TOOL[raw.kind]).includes(user.role)) throw forbidden("your role can't ask for this");
  if (raw.dealId) {
    const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, raw.dealId));
    if (!d) throw notFound("deal");
  }
  if (raw.kind === "approval_note" && !raw.dealId) throw new BadQuery("a deal is needed for an approval note");
  const text =
    raw.kind === "email" ? `To: ${raw.to ?? "colleague"}\nSubject: ${raw.subject ?? ""}\n\n${raw.body}` : raw.body;
  const body = maskPiiText(text);
  // Compliance matters never land in a draft a non-compliance role reads (S6, S42, S57).
  if (!["compliance_officer", "mlro"].includes(user.role) && hasAmlWord(body))
    throw unprocessable("draft_refused", "that draft can't be saved here");
  const id = newId();
  await ctx.database.db.insert(copilotDrafts).values({
    id,
    threadId: raw.threadId,
    userId: user.id,
    kind: raw.kind as CopilotDraftKind,
    dealId: raw.dealId ?? null,
    body,
    createdAt: ctx.clock.now(),
  });
  return { id, kind: raw.kind };
}

/** A draft, for its own user only (the inbox note box and the chat card read it). */
export async function getDraft(ctx: SpaContext, user: Person, id: string) {
  const [d] = await ctx.database.db.select().from(copilotDrafts).where(eq(copilotDrafts.id, id));
  if (!d || d.userId !== user.id) throw notFound("draft");
  return { id: d.id, kind: d.kind, dealId: d.dealId, body: d.body, createdAt: d.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------------------------
// Confirm and cancel: the user's own click

/**
 * Queues preparation for a proposal. The deal moving out of the agreement step between the check and the queue is the same
 * neutral refusal as at storing: the raw message of `enqueuePrepare` names the state, which may be a compliance hold (S42, S57).
 */
export async function prepareForProposal(ctx: SpaContext, boss: Pick<PgBoss, "send">, dealId: string, user: Person) {
  try {
    return await enqueuePrepare(ctx, boss, dealId, user);
  } catch (e) {
    if (e instanceof SpaDomainError && e.code === "not_in_agreement_draft") throw notAtAgreementStep();
    throw e;
  }
}

/** What the effect of a confirmed proposal did, or why it did not (never re-run: the proposal stays confirmed). */
async function runEffect(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  p: { id: string; kind: string; payload: unknown },
  deal: { id: string } | null,
  user: Person,
): Promise<Record<string, unknown>> {
  const payload = p.payload as { title?: string; forRole?: SpaRole; signatureId?: string };
  switch (p.kind as CopilotProposalKind) {
    case "request_documents":
      return { ...(await requestDocuments(ctx, deal!.id, user)) };
    case "prepare_agreement": {
      const r = await prepareForProposal(ctx, boss, deal!.id, user);
      return { queued: r.queued };
    }
    case "resend_signing_link":
      return { ...(await resendSigningLink(ctx, deal!.id, payload.signatureId ?? "", user)) };
    case "create_task": {
      const t = await withSpaTx(ctx.database, (tx) =>
        openTask(ctx, tx, {
          dealId: deal?.id ?? null,
          kind: "copilot_task",
          role: payload.forRole ?? user.role,
          title: payload.title ?? "",
          detail: { proposalId: p.id },
          dedupeKey: `copilot:${p.id}`,
        }),
      );
      return { taskId: t.id, created: t.created };
    }
  }
}

/**
 * Runs the proposal as the user who made it and who clicks (a different user is 403, an expired one 410, a decided one
 * 409). In one transaction the row is locked, role and deal state are checked again, and the proposal is marked confirmed
 * with the event `COPILOT_PROPOSAL_CONFIRMED` (actor the user, `viaProposal`). Only then does the normal manager function
 * run, as that user, with its own events. A click can therefore never run the effect twice: if the effect throws, the
 * proposal stays confirmed, its result says `failed`, and a second Confirm is 409 (the person asks the copilot again).
 */
export async function confirmProposal(ctx: SpaContext, boss: Pick<PgBoss, "send">, id: string, user: Person) {
  const out = await withSpaTx(ctx.database, async (tx) => {
    const [p] = await tx.db.select().from(copilotProposals).where(eq(copilotProposals.id, id)).for("update");
    if (!p) throw notFound("proposal");
    if (p.userId !== user.id) throw forbidden("this proposal is not yours to confirm");
    if (p.status !== "proposed") throw conflict("proposal_decided", `this proposal is already ${p.status}`);
    if (p.expiresAt.getTime() <= ctx.clock.now().getTime()) {
      await tx.db.update(copilotProposals).set({ status: "expired" }).where(eq(copilotProposals.id, id));
      return { expired: true as const };
    }
    if (!toolRoles(p.kind).includes(user.role)) throw forbidden("your role can't do this any more");
    const deal = p.dealId ? await openDeal(ctx, p.dealId) : null;
    if (p.kind === "prepare_agreement" && deal!.state !== "AGREEMENT_DRAFT") throw notAtAgreementStep();
    if (deal)
      await appendDealEvent(tx, ctx, {
        entity: { kind: "deal", id: deal.id },
        type: "COPILOT_PROPOSAL_CONFIRMED",
        actor: `user:${user.id}`,
        rulesVersion: deal.rulesVersion,
        payload: { proposalId: p.id, kind: p.kind, viaProposal: true },
      });
    await tx.db
      .update(copilotProposals)
      .set({ status: "confirmed", confirmedAt: ctx.clock.now() })
      .where(eq(copilotProposals.id, id));
    return { proposal: p, deal };
  });
  if ("expired" in out) throw gone("proposal_expired", "this proposal has expired; ask the copilot again");
  let result: Record<string, unknown>;
  try {
    result = await runEffect(ctx, boss, out.proposal, out.deal, user);
  } catch (e) {
    result = {
      failed: true,
      message:
        (e instanceof SpaDomainError ? e.message : "it could not be done") +
        ". Nothing was repeated; ask the copilot again if you still want it.",
    };
  }
  await ctx.database.db.update(copilotProposals).set({ result }).where(eq(copilotProposals.id, id));
  return { id, status: "confirmed" as const, result };
}

export async function cancelProposal(ctx: SpaContext, id: string, user: Person) {
  const [p] = await ctx.database.db.select().from(copilotProposals).where(eq(copilotProposals.id, id));
  if (!p) throw notFound("proposal");
  if (p.userId !== user.id) throw forbidden("this proposal is not yours");
  const done = await ctx.database.db
    .update(copilotProposals)
    .set({ status: "cancelled" })
    .where(and(eq(copilotProposals.id, id), eq(copilotProposals.status, "proposed")))
    .returning({ id: copilotProposals.id });
  if (!done.length) throw conflict("proposal_decided", `this proposal is already ${p.status}`);
  return { id, status: "cancelled" as const };
}

// ---------------------------------------------------------------------------------------------
// The chat

export interface CopilotReply {
  threadId: string;
  reply: string;
  kind: string;
  verified: boolean;
  unverified: string[];
  tools: { name: string; ok: boolean }[];
  scope: { offTopic: boolean; probability: number } | null;
  proposals: { id: string; kind: string; status: "proposed"; expiresAt: string; summary: string }[];
  drafts: { id: string; kind: string; dealId: string | null; body: string }[];
}

/**
 * One message to the copilot, as the signed-in user. The tools reach the engine through `transport`, which the route builds
 * from the app's own routes and the user's own session, so every read is role-filtered by the route it calls. Never throws a
 * model failure: the loop answers with a fixed line.
 */
export async function runCopilotChat(
  ctx: SpaContext,
  rt: AssistantRuntime,
  input: { user: Person; text: string; transport: (threadId: string) => Transport },
): Promise<CopilotReply> {
  const { user } = input;
  if (
    !(await takeRateLimit(ctx, {
      key: `copilot:${user.id}`,
      bucket: hourBucket(ctx),
      limit: COPILOT_MESSAGES_PER_HOUR,
    }))
  )
    throw tooMany("you have sent a lot of messages; try again in a while");
  const threadId = await threadFor(ctx, { kind: "staff", subjectId: "staff", principal: user.id });
  const history = await threadHistoryOf(ctx, threadId);
  await storeUserMessage(ctx, threadId, input.text);
  const result = await copilotTurn(
    { model: rt.model, llm: rt.llm, ...(rt.timeoutMs ? { timeoutMs: rt.timeoutMs } : {}) },
    engineClient(input.transport(threadId)),
    user,
    { text: input.text, history },
  );
  await storeTurn(ctx, threadId, result, rt.tag);
  const draftRows = result.drafts.length
    ? await ctx.database.db
        .select()
        .from(copilotDrafts)
        .where(
          and(
            inArray(
              copilotDrafts.id,
              result.drafts.map((d) => d.draftId),
            ),
            eq(copilotDrafts.userId, user.id),
          ),
        )
    : [];
  return {
    threadId,
    reply: maskPiiText(result.reply),
    kind: result.kind,
    verified: result.verified,
    unverified: result.unverified,
    tools: result.tools.map((t) => ({ name: t.name, ok: t.ok })),
    scope: result.scope ? { offTopic: result.scope.offTopic, probability: result.scope.probability } : null,
    proposals: result.proposals.map((p) => ({
      id: p.proposalId,
      kind: p.kind,
      status: p.status,
      expiresAt: p.expiresAt,
      summary: p.summary,
    })),
    drafts: draftRows.map((d) => ({ id: d.id, kind: d.kind, dealId: d.dealId, body: d.body })),
  };
}

const threadHistoryOf = async (ctx: SpaContext, threadId: string) => {
  const rows = await ctx.database.db
    .select({ role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.threadId, threadId), inArray(assistantMessages.role, ["user", "assistant"])))
    .orderBy(desc(assistantMessages.at), desc(assistantMessages.id))
    .limit(10);
  return rows.reverse().map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
};

/** The user's own recent conversation, for the dock to show again after a reload. User and assistant messages only. */
export async function copilotThread(ctx: SpaContext, user: Person) {
  const kind: AssistantKind = "staff";
  const [t] = await ctx.database.db
    .select({ id: assistantThreads.id })
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.kind, kind),
        eq(assistantThreads.subjectId, "staff"),
        eq(assistantThreads.principalHash, principalHash(kind, user.id)),
      ),
    )
    .orderBy(desc(assistantThreads.createdAt), desc(assistantThreads.id))
    .limit(1);
  if (!t) return { messages: [] };
  const rows = await ctx.database.db
    .select()
    .from(assistantMessages)
    .where(and(eq(assistantMessages.threadId, t.id), inArray(assistantMessages.role, ["user", "assistant"])))
    .orderBy(desc(assistantMessages.at), desc(assistantMessages.id))
    .limit(20);
  return {
    messages: rows.reverse().map((m) => ({
      role: m.role,
      content: m.content,
      verified: m.verified,
      unverified: m.unverifiedValues,
      at: m.at.toISOString(),
    })),
  };
}
