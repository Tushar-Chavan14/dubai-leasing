import { createHash } from "node:crypto";
import { type CalendarDate, diffDays, toDubaiDate } from "@platform/kernel/dates";
import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { CHASE_REASONS, type ChaseReasonCode, type SpaRole, neutralChaseReason } from "@spa/core";
import {
  amlCases,
  amlHits,
  chasePauses,
  chases,
  companies,
  dealParties,
  deals,
  documentRequests,
  documents,
  kycRuns,
  outboundMessages,
  parties,
  type SpaDb,
  spaApprovals,
  spaUsers,
  withSpaTx,
} from "@spa/db";
import { chaseBodyHash, fillChaseMail } from "@spa/helpers";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { CHASE_JOB, chaseKey } from "../jobs.ts";
import { currentChaseTemplate } from "./chase-templates.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, unavailable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DealRow } from "./facts.ts";
import { dealKycParties, type DealKycParty } from "./kyc-facts.ts";
import { effectiveKycConfig } from "./kyc-config.ts";
import { sendSpaMail } from "./mail.ts";
import { policyAt } from "./policy.ts";
import { propertyLabel } from "./signing.ts";
import { openTask } from "./tasks.ts";

/** Chasing parties (C25, S23, S60). No model: code finds the items, the reasons come from a fixed list and the email is an
 * admin-approved template that code fills. */

/** A deal in one of these states is never chased (cancelled, completed or handed over). */
const CLOSED: readonly string[] = ["CANCELLED", "COMPLETED", "HANDED_OVER"];
/** Who may pause or resume chasing on a deal: the people who run it (S60). */
const PAUSE_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
const SYSTEM = "system:chaser" as const;

export interface ChaseItem {
  /** Names the item and its cycle: a new failure of the same kind is a new item, so it can be chased again. */
  itemKey: string;
  reason: ChaseReasonCode;
  /** The document in plain words (never printed for the neutral reason). */
  label: string;
}
export interface ChaseParty {
  partyId: string;
  name: string;
  email: string;
  role: DealKycParty["role"];
  /** Under an open compliance matter: one neutral item, nothing else (S23). */
  neutral: boolean;
  items: ChaseItem[];
}

const KIND_LABEL: Record<string, string> = {
  passport: "Passport",
  emirates_id_front: "Emirates ID",
  emirates_id_back: "Emirates ID",
  visa: "Visa",
  proof_of_address: "Proof of address",
  trade_licence: "Trade licence",
  poa: "Power of attorney",
  board_resolution: "Board resolution",
  memorandum: "Memorandum of association",
};

/** A KYC flag kind to a fixed reason; a kind with no party-fixable reason (a person's call) maps to none. */
function reasonOfFlag(
  kind: string,
  p: { role: DealKycParty["role"]; resale: boolean },
  passportExpired: boolean,
): ChaseReasonCode | null {
  switch (kind) {
    case "expired":
    case "expires_too_soon":
      return passportExpired ? "passport_expired" : "document_expired";
    case "unreadable":
    case "low_confidence":
    case "mrz_invalid":
    case "mrz_mismatch":
    case "invalid_date":
    case "invalid_id_number":
      return "photo_unreadable";
    case "name_mismatch":
    case "applicant_name_mismatch":
      return p.role === "seller_person" && p.resale ? "name_differs_title_deed" : "name_differs_deal";
    case "wrong_document":
      return "wrong_document";
    case "missing_document":
      return "document_missing";
    default:
      return null;
  }
}

/**
 * What each party of a deal still owes, from code alone (S60): required documents not on file (against the document
 * requests and the KYC config in force), the latest failed or expired KYC run's reasons, and what compliance asked for.
 * A party under an open compliance matter is neutral: one item, "Additional documents needed", whatever the cause, and
 * the original reason never leaves the compliance code.
 */
export async function openChaseItems(db: SpaDb, deal: DealRow, today: CalendarDate): Promise<ChaseParty[]> {
  const people = await dealKycParties(db, deal.id);
  if (!people.length) return [];
  const ids = people.map((p) => p.partyId);
  const emails = new Map(
    (await db.select({ id: parties.id, email: parties.email }).from(parties).where(inArray(parties.id, ids))).map(
      (r) => [r.id, r.email],
    ),
  );
  const requested = new Set(
    (
      await db
        .select({ id: documentRequests.partyId })
        .from(documentRequests)
        .where(eq(documentRequests.dealId, deal.id))
    ).map((r) => r.id),
  );
  const docs = await db.select().from(documents).where(eq(documents.dealId, deal.id));
  const runs = await db
    .select()
    .from(kycRuns)
    .where(eq(kycRuns.dealId, deal.id))
    .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id));
  const approvedRuns = new Set(
    (
      await db
        .select({ proposal: spaApprovals.proposal })
        .from(spaApprovals)
        .where(
          and(
            eq(spaApprovals.gate, "kyc_review"),
            eq(spaApprovals.entityKind, "deal"),
            eq(spaApprovals.entityId, deal.id),
            eq(spaApprovals.status, "approved"),
          ),
        )
    ).map((a) => a.proposal.kycRunId),
  );
  // A party under an open compliance matter, and the case it is under (an info request wins over a plain open case).
  const cases = await db
    .select({ id: amlCases.id, status: amlCases.status, openedAt: amlCases.openedAt, partyId: amlHits.partyId })
    .from(amlCases)
    .innerJoin(amlHits, eq(amlHits.caseId, amlCases.id))
    .where(and(eq(amlCases.dealId, deal.id), inArray(amlCases.status, ["open", "info_requested"])))
    .orderBy(asc(amlCases.openedAt), asc(amlCases.id));
  const caseOf = new Map<string, { id: string; status: string }>();
  for (const c of cases) {
    if (!c.partyId) continue;
    const prior = caseOf.get(c.partyId);
    if (!prior || (prior.status !== "info_requested" && c.status === "info_requested")) caseOf.set(c.partyId, c);
  }
  const resale = deal.dealType !== "primary_offplan";
  const out: ChaseParty[] = [];
  for (const p of people) {
    const mine = docs.filter((d) => d.partyId === p.partyId);
    const items: ChaseItem[] = [];
    if (requested.has(p.partyId)) {
      const cfg = await effectiveKycConfig(db, p.role, deal.dealType);
      for (const f of cfg.config.form)
        if (f.type === "document" && f.required && f.documentKind && f.documentKind !== "custom")
          if (!mine.some((d) => d.kind === f.documentKind))
            items.push({ itemKey: `missing:${f.key}`, reason: "document_missing", label: f.label });
    }
    const run = runs.find((r) => r.partyId === p.partyId);
    if (run && run.status !== "needs_human" && !mine.some((d) => d.uploadedAt > run.createdAt)) {
      const expired = !!run.validUntil && run.validUntil < today;
      const failed = run.status === "review" ? !approvedRuns.has(run.id) : run.status === "blocked";
      if (failed || (run.status === "passed" && expired)) {
        const identity = run.identity as { passportExpiresOn?: string | null };
        const passportExpired = !!identity.passportExpiresOn && identity.passportExpiresOn < today;
        const reasons = new Map<ChaseReasonCode, string>();
        for (const f of run.flags as { kind: string; docId: string | null }[]) {
          const r = reasonOfFlag(f.kind, { role: p.role, resale }, passportExpired);
          if (r && !reasons.has(r)) {
            const kind = f.docId ? docs.find((d) => d.id === f.docId)?.kind : undefined;
            reasons.set(r, (kind && KIND_LABEL[kind]) || "Identity document");
          }
        }
        if (expired && !reasons.size)
          reasons.set(passportExpired ? "passport_expired" : "document_expired", "Identity document");
        for (const [reason, label] of reasons) items.push({ itemKey: `kyc:${reason}:${run.id}`, reason, label });
      }
    }
    const c = caseOf.get(p.partyId);
    if (c) {
      const wanted = c.status === "info_requested" || items.length > 0;
      out.push({
        partyId: p.partyId,
        name: p.name,
        email: emails.get(p.partyId) ?? "",
        role: p.role,
        neutral: true,
        items: wanted
          ? [{ itemKey: neutralItemKey(c.id), reason: neutralChaseReason(), label: "Additional documents" }]
          : [],
      });
    } else
      out.push({
        partyId: p.partyId,
        name: p.name,
        email: emails.get(p.partyId) ?? "",
        role: p.role,
        neutral: false,
        items,
      });
  }
  return out.filter((p) => p.items.length > 0);
}

/**
 * The key of a neutral item (S60 amendment). It lands in chase rows and in a task's `detail`, which every sales role
 * reads, so it must not hold the compliance case's id: a short hash tells cases apart and names none.
 */
const neutralItemKey = (caseId: string): string =>
  `additional_documents:${createHash("sha256").update(`chase-neutral:${caseId}`).digest("hex").slice(0, 12)}`;

export interface ChaseResult {
  sent: number;
  tasks: number;
  skipped?: "closed" | "paused" | "no_template";
}

const isPaused = async (db: SpaDb, dealId: string): Promise<boolean> =>
  (await db.select({ resumedAt: chasePauses.resumedAt }).from(chasePauses).where(eq(chasePauses.dealId, dealId))).some(
    (p) => p.resumedAt === null,
  );

/** The agent's name and address for the email: the deal's owner, else fixed words. */
async function agentOf(db: SpaDb, d: DealRow): Promise<{ name: string; email: string }> {
  const id = d.createdBy.startsWith("user:") ? d.createdBy.slice(5) : null;
  const [u] = id && /^[0-9a-f-]{36}$/.test(id) ? await db.select().from(spaUsers).where(eq(spaUsers.id, id)) : [];
  return { name: u?.name ?? "your agent", email: u?.email ?? "this address" };
}

/**
 * One deal's chasing (`spa.chase`, S60). For every party with something still owed, sends the admin-approved template,
 * filled by code, at the request (step 0), and again after each of the policy's reminder days counted from the first
 * chase; a job that was down sends the latest step that has come due, not each one missed. An item still unanswered at
 * `chaseTaskAfterDays` becomes a task for the agent. Every send goes through `sendSpaMail` (stored as evidence) and is
 * recorded once per party, item and step, so the same day's run twice sends once. Stops: a cancelled, completed or
 * handed-over deal, an agent's pause, and, for an item, an upload after its first chase.
 */
export async function chaseDeal(ctx: SpaContext, dealId: string): Promise<ChaseResult> {
  if (!ctx.mail) throw unavailable("mail_unavailable", "email isn't configured, so no chase can be sent");
  const db = ctx.database.db;
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw notFound("deal");
  if (CLOSED.includes(deal.state)) return { sent: 0, tasks: 0, skipped: "closed" };
  if (await isPaused(db, dealId)) return { sent: 0, tasks: 0, skipped: "paused" };
  const tpl = await currentChaseTemplate(db);
  if (!tpl) return { sent: 0, tasks: 0, skipped: "no_template" };
  const today = ctx.clock.today();
  const policy = await policyAt(db, deal.policyVersion);
  const steps = [0, ...policy.reminderDays];
  const taskAfter = Math.max(policy.chaseTaskAfterDays, (policy.reminderDays.at(-1) ?? 0) + 1);
  const list = await openChaseItems(db, deal, today);
  const prior = await db.select().from(chases).where(eq(chases.dealId, dealId)).orderBy(asc(chases.step));
  const docs = await db.select().from(documents).where(eq(documents.dealId, dealId));
  const property = await propertyLabel({ db }, deal);
  const agent = await agentOf(db, deal);
  const [company] = await db.select({ name: companies.name }).from(companies).limit(1);
  const out: ChaseResult = { sent: 0, tasks: 0 };

  for (const party of list) {
    const due: { item: ChaseItem; step: number }[] = [];
    const open: ChaseItem[] = [];
    for (const item of party.items) {
      const rows = prior.filter((c) => c.partyId === party.partyId && c.itemKey === item.itemKey);
      if (!rows.length) {
        due.push({ item, step: 0 });
        open.push(item);
        continue;
      }
      const first = rows[0]!;
      // An upload after the first chase answers a failed or requested item (a missing document is answered by its kind).
      const answered =
        !item.itemKey.startsWith("missing:") &&
        docs.some((d) => d.partyId === party.partyId && d.uploadedAt > first.createdAt);
      if (answered) continue;
      open.push(item);
      const since = diffDays(toDubaiDate(first.createdAt), today);
      const last = rows.at(-1)!.step;
      let step = 0;
      steps.forEach((s, i) => {
        if (s <= since) step = i;
      });
      if (step > last) due.push({ item, step });
      if (since >= taskAfter) {
        const t = await withSpaTx(ctx.database, (tx) =>
          openTask(ctx, tx, {
            dealId,
            kind: "chase_overdue",
            role: "sales_officer",
            // Plain words: never a name, a number or a reason that hints at a review (S55).
            title: "A reminder for documents has gone unanswered: contact the party directly.",
            detail: { partyId: party.partyId, itemKey: item.itemKey, reason: item.reason, reminders: last },
            dedupeKey: `${dealId}:${party.partyId}:${item.itemKey}:chase_overdue`,
          }),
        );
        if (t.created) out.tasks++;
      }
    }
    if (!due.length) continue;

    const parts = fillChaseMail(
      { version: tpl.version, subject: tpl.subject, body: tpl.body },
      {
        partyName: party.name,
        property,
        agentName: agent.name,
        agentEmail: agent.email,
        companyName: company?.name ?? "the sales team",
        items: open.map((i) => ({ label: i.label, reason: i.reason })),
      },
    );
    const milestone = `${party.partyId}:${due
      .map((d) => `${d.item.itemKey}@${d.step}`)
      .toSorted()
      .join("+")}`;
    const r = await sendSpaMail(ctx, {
      entityKind: "deal",
      entityId: dealId,
      purpose: "reminder",
      milestone,
      to: party.email,
      parts,
    });
    // Recorded only once the mail is stored as sent (a failed one is tried again on the next run).
    const [stored] = await db
      .select({ status: outboundMessages.status })
      .from(outboundMessages)
      .where(eq(outboundMessages.id, r.outboundId));
    if (stored?.status !== "sent") continue;
    const bodySha256 = chaseBodyHash(parts);
    const at = ctx.clock.now();
    const inserted = await withSpaTx(ctx.database, async (tx) => {
      const rows = await tx.db
        .insert(chases)
        .values(
          due.map((d) => ({
            id: newId(),
            dealId,
            partyId: party.partyId,
            itemKey: d.item.itemKey,
            reasonCode: d.item.reason,
            step: d.step,
            templateId: tpl.id,
            templateVersion: tpl.version,
            subject: parts.subject,
            bodySha256,
            outboundMessageId: r.outboundId,
            createdAt: at,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: chases.id });
      if (rows.length)
        await appendDealEvent(tx, ctx, {
          entity: { kind: "deal", id: dealId },
          type: "CHASE_SENT",
          actor: SYSTEM,
          rulesVersion: deal.rulesVersion,
          // Reason codes and steps, never a name or a document.
          payload: { partyId: party.partyId, steps: due.map((d) => d.step), reasons: due.map((d) => d.item.reason) },
        });
      return rows.length;
    });
    if (inserted) out.sent++;
  }
  return out;
}

/**
 * The daily sweep (`spa.chase.sweep`, 08:30 Dubai): queues one `spa.chase` job per open deal, key `<dealId>:chase:<date>`.
 * Safe to run twice (the queue keeps one job per key, and each chase is recorded once).
 */
export async function chaseSweep(ctx: SpaContext, boss: Pick<PgBoss, "send">): Promise<{ queued: number }> {
  const open = await ctx.database.db
    .select({ id: deals.id })
    .from(deals)
    .where(notInArray(deals.state, CLOSED as never[]));
  const today = ctx.clock.today();
  let queued = 0;
  for (const d of open)
    if (await boss.send(CHASE_JOB, { dealId: d.id }, { singletonKey: chaseKey(d.id, today) })) queued++;
  return { queued };
}

// ---- pause and resume ---------------------------------------------------------------------------------------------

type Person = { id: string; role: SpaRole };
async function lockDeal(ctx: SpaContext, tx: { db: SpaDb }, dealId: string) {
  const [d] = await (tx.db as never as SpaDb).select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d) throw notFound("deal");
  return d;
}

/** An agent pauses chasing on a deal (S60). Pausing again changes nothing. A closed deal needs no pause. */
export async function pauseChasing(
  ctx: SpaContext,
  user: Person,
  dealId: string,
): Promise<{ paused: true; changed: boolean }> {
  if (!PAUSE_ROLES.includes(user.role)) throw forbidden("you can't pause chasing on a deal");
  return withSpaTx(ctx.database, async (tx) => {
    const d = await lockDeal(ctx, tx, dealId);
    if (CLOSED.includes(d.state)) throw conflict("deal_closed", "this deal is closed: nothing is chased");
    if (await isPaused(tx.db, dealId)) return { paused: true as const, changed: false };
    await tx.db
      .insert(chasePauses)
      .values({ id: newId(), dealId, pausedBy: `user:${user.id}`, pausedAt: ctx.clock.now() });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "CHASE_PAUSED",
      actor: `user:${user.id}`,
      rulesVersion: d.rulesVersion,
    });
    return { paused: true as const, changed: true };
  });
}

/** An agent resumes chasing: the schedule goes on from the first chase of each item. Resuming when not paused changes nothing. */
export async function resumeChasing(
  ctx: SpaContext,
  user: Person,
  dealId: string,
): Promise<{ paused: false; changed: boolean }> {
  if (!PAUSE_ROLES.includes(user.role)) throw forbidden("you can't resume chasing on a deal");
  return withSpaTx(ctx.database, async (tx) => {
    const d = await lockDeal(ctx, tx, dealId);
    const open = (await tx.db.select().from(chasePauses).where(eq(chasePauses.dealId, dealId))).find(
      (p) => p.resumedAt === null,
    );
    if (!open) return { paused: false as const, changed: false };
    await tx.db
      .update(chasePauses)
      .set({ resumedAt: ctx.clock.now(), resumedBy: `user:${user.id}` })
      .where(eq(chasePauses.id, open.id));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "CHASE_RESUMED",
      actor: `user:${user.id}`,
      rulesVersion: d.rulesVersion,
    });
    return { paused: false as const, changed: true };
  });
}

// ---- what the deal record shows -----------------------------------------------------------------------------------

export interface ChasingView {
  paused: boolean;
  pausedSince: Date | null;
  template: { version: number } | null;
  /** Days after the first chase: the reminders, then the task. */
  schedule: { reminderDays: number[]; taskAfterDays: number };
  open: { partyName: string; item: string; reason: string; chased: number; lastChasedAt: Date | null }[];
  history: { partyName: string; reason: string; step: number; templateVersion: number; sentAt: Date }[];
}

/**
 * The record's "Chasing" section (S60): what is still owed and what was sent. Reasons are the fixed words, so what staff
 * read is what the party read, and a neutral item reads "Additional documents needed" for everyone.
 */
export async function chasingView(ctx: SpaContext, deal: DealRow): Promise<ChasingView> {
  const db = ctx.database.db;
  const today = ctx.clock.today();
  const policy = await policyAt(db, deal.policyVersion);
  const pause = (
    await db.select().from(chasePauses).where(eq(chasePauses.dealId, deal.id)).orderBy(desc(chasePauses.pausedAt))
  ).find((p) => p.resumedAt === null);
  const tpl = await currentChaseTemplate(db);
  const list = CLOSED.includes(deal.state) ? [] : await openChaseItems(db, deal, today);
  const rows = await db
    .select()
    .from(chases)
    .where(eq(chases.dealId, deal.id))
    .orderBy(desc(chases.createdAt), desc(chases.step));
  const names = new Map(
    (
      await db
        .select({ id: parties.id, name: parties.fullNameEn })
        .from(dealParties)
        .innerJoin(parties, eq(parties.id, dealParties.partyId))
        .where(eq(dealParties.dealId, deal.id))
    ).map((p) => [p.id, maskPiiText(p.name)]),
  );
  return {
    paused: !!pause,
    pausedSince: pause?.pausedAt ?? null,
    template: tpl ? { version: tpl.version } : null,
    schedule: { reminderDays: policy.reminderDays, taskAfterDays: policy.chaseTaskAfterDays },
    open: list.flatMap((p) =>
      p.items.map((i) => {
        const mine = rows.filter((c) => c.partyId === p.partyId && c.itemKey === i.itemKey);
        return {
          partyName: maskPiiText(p.name),
          item: i.reason === "additional_documents" ? CHASE_REASONS.additional_documents : i.label,
          reason: CHASE_REASONS[i.reason],
          chased: mine.length,
          lastChasedAt: mine[0]?.createdAt ?? null,
        };
      }),
    ),
    history: rows.slice(0, 30).map((c) => ({
      partyName: names.get(c.partyId) ?? "Party",
      reason: CHASE_REASONS[c.reasonCode as ChaseReasonCode],
      step: c.step,
      templateVersion: c.templateVersion,
      sentAt: c.createdAt,
    })),
  };
}
