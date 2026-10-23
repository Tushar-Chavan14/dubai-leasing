import { renderPdf } from "@leasing/adapters";
import {
  type Actor,
  type CalendarDate,
  type DepositResponse,
  formatAed,
  isCalendarDate,
  maskPiiText,
  newId,
  type StaffRole,
  type StaffUser,
} from "@leasing/core";
import {
  approvals,
  depositStatements,
  documents,
  inboundEvents,
  inspections,
  leases,
  tasks,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { ExitDepositSchemas, exitDepositHelper, type Finding, type StatementItem } from "@leasing/helpers";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, forbidden, notFound, unprocessable } from "../errors.ts";
import { advance } from "./advance.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent, getCompanyPolicyVersion } from "./events.ts";
import type { RefundProposal } from "./gate-rules.ts";
import { runAndRecord } from "./helpers.ts";
import { queueLeaseMail } from "./lease-mail.ts";
import { createTask } from "./milestones.ts";
import { ensureMoveOutInspection, type FindingRecord, moveOutStatus, queueEjariCancel } from "./move-out.ts";

/**
 * Deposit statement, refund and settlement (step 10). The Exit & Deposit helper computes the
 * statement in code from the deposit, the confirmed findings and the price list. Finance acts on
 * every refund: the `refund` approval first when the refund is above the threshold, the tenant
 * disputes it, or an amount isn't on the price list; then, always, the payout record that
 * settles the deposit. Settled deposit + cancelled Ejari → SETTLED → CLOSED → unit back to PREP.
 */
export const REFUND_ROLES: StaffRole[] = ["finance"];

type LeaseRow = typeof leases.$inferSelect;
type StatementRow = typeof depositStatements.$inferSelect;

async function latestStatement(tx: Tx, leaseId: string): Promise<StatementRow | null> {
  const [s] = await tx.db
    .select()
    .from(depositStatements)
    .where(eq(depositStatements.leaseId, leaseId))
    .orderBy(desc(depositStatements.revision))
    .limit(1);
  return s ?? null;
}

/**
 * Staff complete the move-out inspection: everything ticked and a photo of every room. Then the
 * statement goes to the tenant and, from the move-out date, Ejari is cancelled.
 */
export async function completeMoveOut(ctx: EngineContext, leaseId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (!lease) throw notFound("lease");
    if (lease.state !== "MOVE_OUT") throw conflict(`the lease is ${lease.state}, not moving out`, "not_move_out");
    const inspection = await ensureMoveOutInspection(ctx, tx, leaseId);
    if (inspection.status === "done") throw conflict("the move-out inspection is already complete", "inspection_done");
    const status = await moveOutStatus(ctx, tx, leaseId);
    if (status.missing.length)
      throw unprocessable("the move-out inspection isn't complete", status.missing, "guard_failed");
    if (status.suggestions.some((s) => s.status === "pending"))
      throw conflict(
        "a photo comparison is still running; wait for it or remove the room's photos",
        "comparison_pending",
      );
    await tx.db
      .update(inspections)
      .set({ status: "done", doneOn: ctx.clock.today() })
      .where(eq(inspections.id, inspection.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "MOVE_OUT_INSPECTED",
      actor: `user:${user.id}`,
      payload: { inspectionId: inspection.id, findings: status.findings.length },
      rulesVersion: lease.rulesVersion,
    });
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(
        and(
          eq(tasks.entityId, leaseId),
          inArray(tasks.kind, ["move_out_inspection", "move_out_inspection_due"]),
          eq(tasks.status, "open"),
        ),
      );
    const statement = await issueStatement(ctx, tx, lease, `user:${user.id}`);
    await queueEjariCancel(ctx, tx, lease);
    return { statement };
  });
}

/** A rejected statement is reissued after the officer corrected the findings. */
export async function reissueStatement(ctx: EngineContext, leaseId: string, user: StaffUser) {
  return withTx(ctx.database, async (tx) => {
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (!lease || lease.state !== "MOVE_OUT") throw conflict("the lease is not moving out", "not_move_out");
    const prev = await latestStatement(tx, leaseId);
    if (prev?.status !== "superseded")
      throw conflict("only a statement finance rejected can be reissued", "statement_not_rejected");
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.entityId, leaseId), eq(tasks.kind, "revise_deposit_statement"), eq(tasks.status, "open")));
    return { statement: await issueStatement(ctx, tx, lease, `user:${user.id}`) };
  });
}

/** Computes the next revision with the Exit & Deposit helper, stores its PDF and emails it. */
async function issueStatement(ctx: EngineContext, tx: Tx, lease: LeaseRow, actor: Actor) {
  const today = ctx.clock.today();
  const policy = await getCompanyPolicyVersion(tx, today);
  const inspection = await ensureMoveOutInspection(ctx, tx, lease.id);
  const findings = (inspection.findings as unknown as FindingRecord[]).map(
    ({ fromSuggestion: _f, by: _b, at: _a, ...f }) => f as Finding,
  );
  const { run, helperRunId } = await runAndRecord(
    ctx,
    tx,
    exitDepositHelper,
    ExitDepositSchemas,
    { kind: "lease", id: lease.id },
    "MOVE_OUT",
    {
      leaseRef: lease.ref,
      depositFils: lease.depositFils,
      refundThresholdFils: policy.values.refundApprovalThresholdFils,
      priceList: policy.values.deductionPriceList,
      findings,
    },
    lease.rulesVersion,
  );
  const data = run.result.data;
  if (run.result.status !== "ok" || !data) {
    await createTask(ctx, tx, lease.id, {
      kind: "deposit_statement_failed",
      title: `${lease.ref}: the deposit statement could not be computed`,
      details: { helperRunId, reasons: run.result.reasons },
      assigneeRole: "leasing_officer",
      dueOn: today,
      dedupeKey: `${lease.id}:deposit_statement_failed:${helperRunId}`,
    });
    throw unprocessable("the deposit statement could not be computed", run.result.reasons, "statement_failed");
  }
  const prev = await latestStatement(tx, lease.id);
  const revision = (prev?.revision ?? 0) + 1;
  const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
  const unitLabel = unit ? `${unit.unitNo ?? unit.code}, ${unit.building}` : lease.ref;
  const id = newId();
  const pdf = await renderPdf(
    { title: "Deposit statement", subject: `${lease.ref} deposit statement ${revision}` },
    statementBlocks({ lease, unitLabel, revision, today, ...data, demo: ctx.demoMode }),
  );
  const stored = await ctx.documents.put(pdf, "pdf");
  const documentId = newId();
  await tx.db.insert(documents).values({
    id: documentId,
    leaseId: lease.id,
    kind: "deposit_statement",
    sha256: stored.sha256,
    path: stored.path,
    mime: "application/pdf",
    extracted: { statementId: id, revision },
  });
  await tx.db.insert(depositStatements).values({
    id,
    leaseId: lease.id,
    revision,
    inspectionId: inspection.id,
    depositFils: data.depositFils,
    items: data.items as unknown as Record<string, unknown>[],
    deductionsFils: data.deductionsFils,
    refundFils: data.refundFils,
    owedFils: data.owedFils,
    policyVersion: policy.version,
    status: "sent",
    needsApproval: data.approvalReasons.length > 0,
    documentId,
    createdBy: actor,
    createdAt: ctx.clock.now(),
  });
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: "DEPOSIT_STATEMENT_ISSUED",
    actor,
    payload: {
      statementId: id,
      revision,
      depositFils: data.depositFils,
      deductionsFils: data.deductionsFils,
      refundFils: data.refundFils,
      owedFils: data.owedFils,
      policyVersion: policy.version,
      helperRunId,
      sha256: stored.sha256,
    },
    rulesVersion: lease.rulesVersion,
  });
  if (data.owedFils > 0) {
    await createTask(ctx, tx, lease.id, {
      kind: "amount_owed",
      title: `${lease.ref}: confirmed damage is ${formatAed(data.owedFils)} more than the deposit; decide whether to claim it`,
      details: { statementId: id, owedFils: data.owedFils },
      assigneeRole: "leasing_manager",
      dueOn: today,
      dedupeKey: `${lease.id}:amount_owed#${revision}`,
    });
  }
  await queueLeaseMail(ctx, tx, { leaseId: lease.id, kind: "deposit_statement", key: id, seq: 1 });
  return { id, revision, ...data };
}

function statementBlocks(d: {
  lease: LeaseRow;
  unitLabel: string;
  revision: number;
  today: CalendarDate;
  items: StatementItem[];
  depositFils: number;
  deductionsFils: number;
  refundFils: number;
  demo: boolean;
}) {
  return [
    { kind: "title" as const, text: "Deposit statement" },
    {
      kind: "meta" as const,
      rows: [
        ["Lease", d.lease.ref],
        ["Property", d.unitLabel],
        ["Statement", `${d.revision}, issued ${d.today}`],
      ] as [string, string][],
    },
    { kind: "heading" as const, text: "Deductions" },
    d.items.length
      ? {
          kind: "list" as const,
          items: d.items.map(
            (i) =>
              `${i.room ? `${i.room}: ` : ""}${i.label}, ${i.quantity} × ${formatAed(i.unitPriceFils)} = ${formatAed(i.amountFils)}${i.fromPriceList ? "" : " (subject to approval)"}`,
          ),
        }
      : { kind: "para" as const, text: "No damage was found beyond normal wear and tear." },
    {
      kind: "facts" as const,
      rows: [
        ["Security deposit", formatAed(d.depositFils)],
        ["Deductions", formatAed(d.deductionsFils)],
        ["Refund to you", formatAed(d.refundFils)],
      ] as [string, string][],
    },
    {
      kind: "small" as const,
      text: "Normal wear and tear is not deducted. Prices come from our published price list. Accept the statement to receive the refund, or dispute it and tell us why; a person will review it.",
    },
    ...(d.demo ? [{ kind: "small" as const, text: "DEMO: fictional data." }] : []),
  ];
}

/**
 * The tenant's answer (portal, single-use link). Accept: finance approves first when needed,
 * otherwise confirms the payout. Dispute: always finance's `refund` approval, plus a manager task.
 * The tenant's reason is untrusted text: shown to people, never acted on.
 */
export async function applyDepositResponse(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  ev: typeof inboundEvents.$inferSelect,
): Promise<{ applied: boolean; detail: Record<string, unknown> }> {
  const p = ev.payload as DepositResponse;
  const s = await latestStatement(tx, lease.id);
  if (!s || s.revision !== p.revision || s.status !== "sent" || lease.state !== "MOVE_OUT") {
    await createTask(ctx, tx, lease.id, {
      kind: "deposit_response_stale",
      title: `${lease.ref}: the tenant answered deposit statement ${p.revision}, which is no longer open`,
      details: { inboundEventId: ev.id, choice: p.choice },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:deposit_response_stale:${ev.id}`,
    });
    return { applied: false, detail: { reason: "statement not open" } };
  }
  const disputed = p.choice === "dispute";
  await tx.db
    .update(depositStatements)
    .set({ status: disputed ? "disputed" : "accepted", responseInboundId: ev.id })
    .where(eq(depositStatements.id, s.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: lease.id },
    type: disputed ? "DEPOSIT_DISPUTED" : "DEPOSIT_ACCEPTED",
    actor: ev.actor as Actor,
    payload: { inboundEventId: ev.id, ref: ev.ref, statementId: s.id, revision: s.revision },
    rulesVersion: lease.rulesVersion,
  });
  if (disputed) {
    await createTask(ctx, tx, lease.id, {
      kind: "deposit_dispute",
      title: `${lease.ref}: the tenant disputes deposit statement ${s.revision}`,
      details: {
        statementId: s.id,
        inboundEventId: ev.id,
        reason: p.reason ? maskPiiText(p.reason) : null,
        untrusted: true,
      },
      assigneeRole: "leasing_manager",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:deposit_dispute#${s.revision}`,
    });
  }
  // The reason is shown to finance as untrusted text; identifiers in it are masked.
  if (disputed || s.needsApproval)
    await proposeRefund(ctx, tx, lease, s, disputed ? maskPiiText(p.reason ?? "") : null);
  else await payoutTask(ctx, tx, lease, s);
  return { applied: true, detail: { choice: p.choice, needsApproval: disputed || s.needsApproval } };
}

async function proposeRefund(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  s: StatementRow,
  disputeReason: string | null,
) {
  const policy = await getCompanyPolicyVersion(tx, ctx.clock.today());
  const items = s.items as unknown as StatementItem[];
  const reasons = [
    ...(disputeReason !== null ? ["The tenant disputes the statement (their reason is untrusted text)."] : []),
    ...(items.some((i) => !i.fromPriceList) ? ["It includes an amount that is not on the company price list."] : []),
    ...(s.refundFils > policy.values.refundApprovalThresholdFils
      ? [
          `The refund ${formatAed(s.refundFils)} is above the ${formatAed(policy.values.refundApprovalThresholdFils)} threshold.`,
        ]
      : []),
  ];
  const proposal: RefundProposal = {
    leaseId: lease.id,
    statementId: s.id,
    revision: s.revision,
    depositFils: s.depositFils,
    items,
    deductionsFils: s.deductionsFils,
    refundFils: s.refundFils,
    owedFils: s.owedFils,
    thresholdFils: policy.values.refundApprovalThresholdFils,
    disputed: disputeReason !== null,
    disputeReason,
    policyVersion: s.policyVersion,
  };
  const a = await requestApproval(ctx, tx, {
    gate: "refund",
    entity: { kind: "lease", id: lease.id },
    dedupeKey: `${lease.id}:refund#${s.revision}`,
    title: `Deposit refund ${formatAed(s.refundFils)} for ${lease.ref}${disputeReason !== null ? " (disputed)" : ""}`,
    proposal: proposal as unknown as Record<string, unknown>,
    reasons,
    sources: [
      ...(s.documentId
        ? [{ kind: "document" as const, documentId: s.documentId, label: `Deposit statement ${s.revision}` }]
        : []),
      {
        kind: "field",
        label: "Price list",
        value: policy.version === null ? "built-in defaults" : `policy v${policy.version}`,
      },
    ],
    rulesVersion: lease.rulesVersion,
    proposedBy: "system",
  });
  await tx.db.update(depositStatements).set({ approvalId: a.id }).where(eq(depositStatements.id, s.id));
}

async function payoutTask(ctx: EngineContext, tx: Tx, lease: LeaseRow, s: StatementRow) {
  await createTask(ctx, tx, lease.id, {
    kind: "refund_payout",
    title: `${lease.ref}: pay the deposit refund of ${formatAed(s.refundFils)} and record it`,
    details: {
      statementId: s.id,
      revision: s.revision,
      refundFils: s.refundFils,
      responseInboundId: s.responseInboundId,
    },
    assigneeRole: "finance",
    dueOn: ctx.clock.today(),
    dedupeKey: `${lease.id}:refund_payout#${s.revision}`,
  });
}

/** Finance's decision on the `refund` approval (called from approvals.ts). */
export async function onRefundDecided(
  ctx: EngineContext,
  tx: Tx,
  a: typeof approvals.$inferSelect,
  status: "approved" | "rejected" | "edited",
) {
  const p = a.proposal as unknown as RefundProposal;
  const [s] = await tx.db.select().from(depositStatements).where(eq(depositStatements.id, p.statementId)).for("update");
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, p.leaseId));
  if (!s || !lease) return;
  if (s.status !== "accepted" && s.status !== "disputed") return;
  if (status === "rejected") {
    await tx.db.update(depositStatements).set({ status: "superseded" }).where(eq(depositStatements.id, s.id));
    await createTask(ctx, tx, lease.id, {
      kind: "revise_deposit_statement",
      title: `${lease.ref}: finance rejected deposit statement ${s.revision}; correct the findings and reissue it`,
      details: { statementId: s.id, approvalId: a.id, note: a.decisionNote },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${lease.id}:revise_deposit_statement#${s.revision}`,
    });
    return;
  }
  await tx.db.update(depositStatements).set({ status: "approved" }).where(eq(depositStatements.id, s.id));
  await payoutTask(ctx, tx, lease, s);
}

export const RecordRefund = z.object({
  paidOn: z.string().refine(isCalendarDate, "expected YYYY-MM-DD"),
  ref: z.string().trim().min(1).max(120),
});

/** Finance records the refund paid (finance acts on every refund). Settles the deposit. */
export async function recordRefundPaid(ctx: EngineContext, user: StaffUser, leaseId: string, raw: unknown) {
  if (!REFUND_ROLES.includes(user.role)) throw forbidden("only finance records a deposit refund");
  const input = RecordRefund.parse(raw);
  const today = ctx.clock.today();
  if (input.paidOn > today) throw unprocessable("the payment date can't be in the future", [], "invalid_date");
  return withTx(ctx.database, async (tx) => {
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (!lease || lease.state !== "MOVE_OUT") throw conflict("the lease is not moving out", "not_move_out");
    const s = await latestStatement(tx, leaseId);
    const ready = s && (s.status === "approved" || (s.status === "accepted" && !s.needsApproval));
    if (!s || !ready)
      throw conflict(
        s?.needsApproval && s.status === "accepted"
          ? "this refund needs finance's approval in the inbox first"
          : "there is no accepted or approved deposit statement to pay",
        "refund_not_ready",
      );
    await tx.db
      .update(depositStatements)
      .set({ status: "paid", paidOn: input.paidOn as CalendarDate, paymentRef: input.ref, paidBy: `user:${user.id}` })
      .where(eq(depositStatements.id, s.id));
    await tx.db
      .update(leases)
      .set({ depositSettledOn: input.paidOn as CalendarDate })
      .where(eq(leases.id, leaseId));
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.entityId, leaseId), eq(tasks.kind, "refund_payout"), eq(tasks.status, "open")));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "DEPOSIT_REFUNDED",
      actor: `user:${user.id}`,
      payload: {
        statementId: s.id,
        revision: s.revision,
        refundFils: s.refundFils,
        paidOn: input.paidOn,
        ref: maskPiiText(input.ref),
      },
      rulesVersion: lease.rulesVersion,
    });
    return { settled: await trySettle(ctx, tx, leaseId) };
  });
}

/**
 * The refund account the tenant gave, for finance to pay (finance only). It lives only in the
 * tenant's submission; each view is recorded on the lease, without the account details.
 */
export async function refundAccount(ctx: EngineContext, user: StaffUser, leaseId: string) {
  if (!REFUND_ROLES.includes(user.role)) throw forbidden("only finance sees the refund account");
  return withTx(ctx.database, async (tx) => {
    const s = await latestStatement(tx, leaseId);
    if (!s?.responseInboundId || !["accepted", "approved", "paid"].includes(s.status)) throw notFound("refund account");
    const [ev] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.id, s.responseInboundId));
    const p = ev?.payload as DepositResponse | undefined;
    if (!p?.iban || !p.accountName) throw notFound("refund account");
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "REFUND_ACCOUNT_VIEWED",
      actor: `user:${user.id}`,
      payload: { statementId: s.id, revision: s.revision },
      rulesVersion: await tx.db
        .select({ v: leases.rulesVersion })
        .from(leases)
        .where(eq(leases.id, leaseId))
        .then((r) => r[0]?.v ?? null),
    });
    return { accountName: p.accountName, iban: p.iban, refundFils: s.refundFils, revision: s.revision };
  });
}

/** SETTLED once the deposit is settled and Ejari (if any) cancelled. Safe to call any time. */
export async function trySettle(ctx: EngineContext, tx: Tx, leaseId: string): Promise<boolean> {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease || lease.state !== "MOVE_OUT" || !lease.depositSettledOn) return false;
  if (lease.ejariNo && !lease.ejariCancelledOn) return false;
  await advance(ctx, { kind: "lease", id: leaseId }, "SETTLED", { actor: "system", tx });
  return true;
}

/**
 * The Ejari cancellation job (singleton per lease). Already cancelled → nothing to do; a registry
 * that says "no active registration" is checked with `status()` and counts as cancelled only if
 * it reports cancelled. Unreachable → the job retries; a person is told once.
 */
export async function cancelEjari(ctx: EngineContext, leaseId: string) {
  const [lease] = await ctx.database.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease?.ejariNo || lease.ejariCancelledOn || lease.state !== "MOVE_OUT") return { cancelled: false };
  const ejariNo = lease.ejariNo;
  let ok = false;
  try {
    ok = (await ctx.ejari.cancel(ejariNo, `tenancy ${lease.ref} ended: tenant moved out`)).ok;
    if (!ok) ok = (await ctx.ejari.status(ejariNo)).state === "cancelled";
  } catch (e) {
    const reason = maskPiiText(e instanceof Error ? e.message : String(e));
    await withTx(ctx.database, (tx) =>
      createTask(ctx, tx, leaseId, {
        kind: "ejari_cancel_failed",
        title: `${lease.ref}: Ejari ${ejariNo} could not be cancelled yet (${reason}); retrying`,
        details: { ejariNo, reason },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${leaseId}:ejari_cancel_failed`,
      }),
    );
    throw e;
  }
  if (!ok) {
    await withTx(ctx.database, (tx) =>
      createTask(ctx, tx, leaseId, {
        kind: "ejari_cancel_failed",
        title: `${lease.ref}: the registry refused to cancel Ejari ${ejariNo}; check it`,
        details: { ejariNo },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${leaseId}:ejari_cancel_failed`,
      }),
    );
    return { cancelled: false };
  }
  return withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(leases).where(eq(leases.id, leaseId)).for("update");
    if (!locked || locked.ejariCancelledOn) return { cancelled: true };
    const today = ctx.clock.today();
    await tx.db.update(leases).set({ ejariCancelledOn: today }).where(eq(leases.id, leaseId));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "EJARI_CANCELLED",
      actor: "system",
      payload: { ejariNo, cancelledOn: today },
      rulesVersion: locked.rulesVersion,
    });
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.entityId, leaseId), eq(tasks.kind, "ejari_cancel_failed"), eq(tasks.status, "open")));
    await trySettle(ctx, tx, leaseId);
    return { cancelled: true };
  });
}

/** The tenant's part of the latest statement, for the portal (no internal ids beyond the revision). */
export async function portalStatement(tx: Tx, leaseId: string) {
  const s = await latestStatement(tx, leaseId);
  if (!s || s.status === "superseded") return null;
  return {
    revision: s.revision,
    status: s.status,
    depositFils: s.depositFils,
    deductionsFils: s.deductionsFils,
    refundFils: s.refundFils,
    items: (s.items as unknown as StatementItem[]).map((i) => ({
      room: i.room,
      label: i.label,
      quantity: i.quantity,
      amountFils: i.amountFils,
    })),
    paidOn: s.paidOn,
  };
}

export { latestStatement };
