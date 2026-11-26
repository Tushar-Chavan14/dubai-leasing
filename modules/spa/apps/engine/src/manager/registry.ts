import { createHash } from "node:crypto";
import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { type DealType, REGISTRY_GATE_OF_KIND, type RegistryKind, type RegistryField, type RegistryRejection, type SpaActor, type SpaGateId, type SpaRole, hasAnyRole } from "@spa/core";
import { deals, helperRuns, registrations, spaApprovals, type SpaTx, withSpaTx } from "@spa/db";
import {
  buildOqoodRegister,
  buildOqoodTransfer,
  buildTrusteeTransfer,
  type OqoodAdapter,
  type TransferAdapter,
} from "@spa/helpers";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { OQOOD_SUBMIT_JOB, type RegistrySubmitData, TRANSFER_SUBMIT_JOB } from "../jobs.ts";
import { advance } from "./advance.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DealRow } from "./facts.ts";
import { currentNoc } from "./noc-facts.ts";
import { buildDealSheet } from "./sheet.ts";
import { planNameFixes } from "./registry-fix.ts";
import { canonicalJson } from "./settlement-facts.ts";

export const REGISTRY_ACTOR: SpaActor = "system:registry";
const HELPER = "spa_registry";

/** What the process needs to reach the registry: the Oqood and the trustee adapters (one HTTP client serves both). */
export interface RegistryDeps {
  oqood: OqoodAdapter;
  transfer: TransferAdapter;
}

type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
const REQUEST_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
const READ_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "legal", "finance", "admin"];

/** Which registry service a deal type uses: Oqood for a primary sale, the trustee for a ready resale, Oqood transfer off-plan. */
export const registryKindFor = (type: DealType): RegistryKind =>
  type === "primary_offplan" ? "oqood_register" : type === "resale_ready" ? "trustee_transfer" : "oqood_transfer";
/** The deal state a kind's submission runs in. */
const STATE_OF_KIND = {
  oqood_register: "REGISTRATION",
  oqood_transfer: "TRANSFER",
  trustee_transfer: "TRANSFER",
} as const;
const GATE_TITLE = { oqood_submission: "Oqood registration", transfer_submission: "Resale transfer" } as const;
const SERVICE_LABEL: Record<RegistryKind, string> = {
  oqood_register: "Oqood registration",
  oqood_transfer: "Oqood transfer",
  trustee_transfer: "Trustee transfer",
};

export const registryJobKey = (dealId: string, kind: RegistryKind, approvalId: string) =>
  `${dealId}:${kind}:${approvalId}`;
const sha = (payload: unknown): string => createHash("sha256").update(canonicalJson(payload)).digest("hex");
export const jobOf = (kind: RegistryKind) => (kind === "oqood_register" ? OQOOD_SUBMIT_JOB : TRANSFER_SUBMIT_JOB);

/** The state a deal enters, and the gate that state opens (S53). */
const GATE_ON_ENTER: Readonly<Record<string, "oqood_submission" | "transfer_submission">> = {
  REGISTRATION: "oqood_submission",
  TRANSFER: "transfer_submission",
};

/** Opens (or finds) the submission gate for a deal, as the system. The proposal carries no ID number. */
async function proposeSubmission(
  ctx: SpaContext,
  tx: SpaTx,
  deal: Pick<DealRow, "id" | "dealType" | "unitNo">,
  gate: "oqood_submission" | "transfer_submission",
  proposedBy: SpaActor,
) {
  const kind = registryKindFor(deal.dealType);
  return proposeApproval(
    ctx,
    {
      gate,
      entity: { kind: "deal", id: deal.id },
      dedupeKey: `${deal.id}:${gate}`,
      title: GATE_TITLE[gate],
      proposal: { kind, service: SERVICE_LABEL[kind], unitNo: deal.unitNo },
      proposedBy,
    },
    tx,
  );
}

/**
 * The deal entered `REGISTRATION` or `TRANSFER`: propose the sales admin's submission gate, once (dedupe key
 * `<dealId>:<gate>`). Runs inside the step's transaction; a refusal here is logged and never undoes the step: the
 * request route raises the proposal again.
 */
export async function proposeOnDealEntered(
  ctx: SpaContext,
  e: { dealId: string; to: string },
  tx: SpaTx,
): Promise<void> {
  const gate = GATE_ON_ENTER[e.to];
  if (!gate) return;
  try {
    const [deal] = await tx.db.select().from(deals).where(eq(deals.id, e.dealId));
    if (!deal || STATE_OF_KIND[registryKindFor(deal.dealType)] !== e.to) return;
    await proposeSubmission(ctx, tx, deal, gate, REGISTRY_ACTOR);
  } catch (err) {
    console.warn(`could not propose the ${gate} gate: ${(err as Error).message}`);
  }
}

/** Queues the submission job for an approved gate: one job per deal, kind and approval (rule 7). */
export async function enqueueRegistration(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  input: { dealId: string; approvalId: string },
): Promise<{ key: string; kind: RegistryKind; queued: boolean }> {
  const [d] = await ctx.database.db.select({ type: deals.dealType }).from(deals).where(eq(deals.id, input.dealId));
  if (!d) throw notFound("deal");
  const kind = registryKindFor(d.type);
  const key = registryJobKey(input.dealId, kind, input.approvalId);
  const data: RegistrySubmitData = { dealId: input.dealId, approvalId: input.approvalId, kind };
  const jobId = await boss.send(jobOf(kind), data, { singletonKey: key });
  return { key, kind, queued: jobId !== null };
}

/** `ctx.onGateApproved`: an approved submission gate queues its job; any other gate queues nothing. */
export async function onRegistryGateApproved(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  e: { approvalId: string; gate: SpaGateId; dealId: string },
): Promise<void> {
  if (e.gate !== "oqood_submission" && e.gate !== "transfer_submission") return;
  await enqueueRegistration(ctx, boss, e);
}

/**
 * `ctx.onHelperReleased` for the registry (S59): a person looked at the auto-fix and it counts, so the submission job runs again
 * for the same approval; it finds the recorded fix and sends the corrected name once. Any other helper queues nothing.
 */
export async function onRegistryFixReleased(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  e: { helper: string; dealId: string; runId: string; result: Record<string, unknown> },
): Promise<void> {
  if (e.helper !== "registry") return;
  const approvalId = e.result.approvalId;
  if (typeof approvalId !== "string") return;
  const [d] = await ctx.database.db.select({ type: deals.dealType }).from(deals).where(eq(deals.id, e.dealId));
  if (!d) throw notFound("deal");
  const kind = registryKindFor(d.type);
  const data: RegistrySubmitData = { dealId: e.dealId, approvalId, kind };
  await boss.send(jobOf(kind), data, { singletonKey: `${registryJobKey(e.dealId, kind, approvalId)}:fix:${e.runId}` });
}

/**
 * How one submission call relates to earlier ones (S56). `first`: a new attempt for an approval that hasn't run. `fix`:
 * a new attempt (new request id) with the name spelling fixed for these fields, under the same approval. `retry`: the
 * same attempt and request id again after an "unavailable" answer, with the same fix if that attempt had one.
 */
export type SubmitMode =
  | { type: "first" }
  | { type: "fix"; fields: RegistryField[] }
  | { type: "retry"; attempt: number; fields?: RegistryField[] };

/** The payload for a deal's registry call, built from its records by code (S53). Nothing is sent. */
export async function buildRegistryPayload(ctx: SpaContext, tx: SpaTx, deal: DealRow, kind: RegistryKind) {
  const sheet = await buildDealSheet(ctx, tx, deal);
  const today = ctx.clock.today();
  const noc = kind === "oqood_register" ? null : await currentNoc(tx, deal, today);
  const nocOk =
    kind === "oqood_register"
      ? false
      : (await ctx.facts.deal(tx, deal, today, { amlListVersion: ctx.amlListVersion })).nocOk;
  const src = {
    purchasers: sheet.purchasers,
    sellers: sheet.sellers,
    values: sheet.values,
    projectCode: deal.projectCode,
    nocOk,
    serviceChargesCleared: noc ? noc.record.serviceChargesCleared : null,
  };
  return kind === "oqood_register"
    ? buildOqoodRegister(src)
    : kind === "oqood_transfer"
      ? buildOqoodTransfer(src)
      : buildTrusteeTransfer(src);
}

export interface SubmitResult {
  status: "issued" | "rejected" | "unavailable" | "incomplete" | "skipped";
  attempt?: number;
  registryNo?: string;
  reason?: string;
}

/**
 * One attempt to register an approved deal (S53). Checks the gate (an approved, unused approval of the right gate for
 * this deal), builds the payload from the deal's records by code, calls the registry once with request id
 * `<dealId>:<kind>:<attempt>` and stores the answer. A number moves the deal (`REGISTERED` or `TRANSFERRED`) as
 * `system:registry` with that approval, which consumes it. A rejection or an outage is stored and left to a person
 * (a `needs_human` row): nothing is retried here. Safe to run twice: one attempt per approval.
 */
export async function submitRegistration(
  ctx: SpaContext,
  deps: RegistryDeps,
  input: { dealId: string; approvalId: string },
  mode: SubmitMode = { type: "first" },
): Promise<SubmitResult> {
  // 1. Decide, read the records and build the payload (a short transaction; the call below is outside it).
  const plan = await withSpaTx(ctx.database, async (tx) => {
    const [deal] = await tx.db.select().from(deals).where(eq(deals.id, input.dealId));
    if (!deal) throw notFound("deal");
    const kind = registryKindFor(deal.dealType);
    const gate = REGISTRY_GATE_OF_KIND[kind];
    const [a] = await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, input.approvalId));
    const reasons: string[] = [];
    if (!a) reasons.push("approval not found");
    else {
      if (a.gate !== gate) reasons.push(`approval for ${a.gate}, not ${gate}`);
      if (a.entityKind !== "deal" || a.entityId !== deal.id) reasons.push("approval for another record");
      if (a.status !== "approved") reasons.push(`approval is ${a.status}`);
    }
    if (reasons.length) throw conflict("gate_required", `${gate} approval not usable: ${reasons.join("; ")}`, reasons);
    if (a!.consumedByEventId) return { skip: "the approval was already used" } as const;
    if (deal.state !== STATE_OF_KIND[kind]) return { skip: `the deal is in ${deal.state}` } as const;
    const prior = await tx.db
      .select({
        attempt: registrations.attempt,
        approvalId: registrations.approvalId,
        status: registrations.status,
        payloadHash: registrations.payloadHash,
      })
      .from(registrations)
      .where(and(eq(registrations.dealId, deal.id), eq(registrations.kind, kind)));
    if (mode.type === "first" && prior.some((p) => p.approvalId === input.approvalId))
      return { skip: "this approval already ran" } as const;
    if (prior.some((p) => p.status === "issued")) return { skip: "a number was already issued" } as const;
    let attempt = Math.max(0, ...prior.map((p) => p.attempt)) + 1;
    let storedHash: string | null = null;
    if (mode.type === "retry") {
      // The same attempt again: only while every try of it was "unavailable" (the registry never answered).
      const mine = prior.filter((p) => p.attempt === mode.attempt && p.approvalId === input.approvalId);
      if (!mine.length) return { skip: "there is no such attempt" } as const;
      if (mine.some((p) => p.status !== "unavailable")) return { skip: "the registry already answered it" } as const;
      attempt = mode.attempt;
      storedHash = mine[0]!.payloadHash;
    } else if (mode.type === "fix" && !prior.some((p) => p.approvalId === input.approvalId)) {
      return { skip: "a fix follows a rejected attempt" } as const;
    }

    const built = await buildRegistryPayload(ctx, tx, deal, kind);
    if (!built.ok) {
      // Nothing is sent: a person fixes the deal's records and requests again.
      await tx.db.insert(helperRuns).values({
        id: newId(),
        helper: HELPER,
        dealId: deal.id,
        entityKind: "deal",
        entityId: deal.id,
        status: "needs_human",
        result: { kind, outcome: "incomplete", missing: built.missing },
        reasons: built.missing,
        rulesVersion: deal.rulesVersion,
        createdAt: ctx.clock.now(),
      });
      return { incomplete: built.missing } as const;
    }
    let payload = built.payload;
    const fields = mode.type === "first" ? [] : (mode.fields ?? []);
    if (fields.length) {
      // The one safe fix (S56): the verified spelling of a name, from code; nothing else in the payload changes.
      const fixed = await planNameFixes(tx, deal, kind, payload, fields);
      if (!fixed.ok) return { incomplete: ["no safe name fix for this deal"] } as const;
      payload = fixed.payload;
    }
    if (storedHash !== null && sha(payload) !== storedHash)
      return { incomplete: ["the payload changed since the first try"] } as const;
    return { kind, attempt, payload, deal } as const;
  });
  if ("skip" in plan) return { status: "skipped", reason: plan.skip };
  if ("incomplete" in plan) return { status: "incomplete", reason: plan.incomplete.join("; ") };

  // 2. One call. The registry answers the same request id with the same answer, so a crash here costs nothing.
  const { kind, attempt, payload, deal } = plan;
  const requestId = `${deal.id}:${kind}:${attempt}`;
  const opts = { requestId };
  let outcome:
    | { status: "issued"; no: string; issuedOn: string }
    | { status: "rejected"; reasons: RegistryRejection[] }
    | { status: "unavailable"; message: string };
  try {
    const r =
      kind === "oqood_register"
        ? await deps.oqood.register(payload as never, opts)
        : kind === "oqood_transfer"
          ? await deps.oqood.transfer(payload as never, opts)
          : await deps.transfer.book(payload as never, opts);
    outcome = r.ok ? { status: "issued", no: r.no, issuedOn: r.issuedOn } : { status: "rejected", reasons: r.reasons };
  } catch (e) {
    if ((e as Error).name !== "RegistryUnavailableError") throw e;
    outcome = { status: "unavailable", message: (e as Error).message };
  }

  // 3. Store it, and on a number move the deal, in one transaction that re-checks the gate.
  return withSpaTx(ctx.database, async (tx): Promise<SubmitResult> => {
    const [locked] = await tx.db.select().from(deals).where(eq(deals.id, deal.id)).for("update");
    const [a] = await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, input.approvalId)).for("update");
    if (!locked || locked.state !== STATE_OF_KIND[kind] || !a || a.status !== "approved" || a.consumedByEventId)
      return { status: "skipped", reason: "the gate or the deal changed while the registry was called" };
    // One answered row per request id; a new attempt (first or fix) must not already have a row.
    const again = await tx.db
      .select({ status: registrations.status })
      .from(registrations)
      .where(
        and(
          eq(registrations.dealId, deal.id),
          mode.type === "first"
            ? eq(registrations.approvalId, input.approvalId)
            : eq(registrations.requestId, requestId),
        ),
      );
    if (mode.type === "retry" ? again.some((x) => x.status !== "unavailable") : again.length)
      return { status: "skipped", reason: "this approval already ran" };
    const reasons = outcome.status === "rejected" ? outcome.reasons : [];
    await tx.db.insert(registrations).values({
      id: newId(),
      dealId: deal.id,
      kind,
      attempt,
      requestId,
      status: outcome.status,
      registryNo: outcome.status === "issued" ? outcome.no : null,
      issuedOn: outcome.status === "issued" ? outcome.issuedOn : null,
      reasons,
      approvalId: input.approvalId,
      payloadHash: sha(payload),
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: deal.id },
      type: "REGISTRATION_ATTEMPTED",
      rulesVersion: deal.rulesVersion,
      actor: REGISTRY_ACTOR,
      payload: {
        kind,
        attempt,
        status: outcome.status,
        approvalId: input.approvalId,
        ...(outcome.status === "issued" ? { registryNo: outcome.no } : {}),
        ...(reasons.length ? { codes: reasons.map((r) => r.code) } : {}),
      },
    });
    if (outcome.status === "issued") {
      await advance(ctx, { kind: "deal", id: deal.id }, kind === "oqood_register" ? "REGISTERED" : "TRANSFERRED", {
        actor: REGISTRY_ACTOR,
        approvalId: input.approvalId,
        payload: { kind, attempt, registryNo: outcome.no },
        tx,
      });
      return { status: "issued", attempt, registryNo: outcome.no };
    }
    const messages = outcome.status === "rejected" ? outcome.reasons.map((r) => r.message) : [outcome.message];
    await tx.db.insert(helperRuns).values({
      id: newId(),
      helper: HELPER,
      dealId: deal.id,
      entityKind: "deal",
      entityId: deal.id,
      status: "needs_human",
      result: { kind, attempt, outcome: outcome.status, codes: reasons.map((r) => r.code) },
      reasons: messages,
      rulesVersion: deal.rulesVersion,
      createdAt: ctx.clock.now(),
    });
    return { status: outcome.status, attempt };
  });
}

export interface RequestResult {
  status: "proposed" | "already_pending" | "queued";
  approvalId: string;
}

/**
 * Staff ask for the submission step again (S53): after a rejection or an outage, or if the queue was down. An approved
 * gate that hasn't run yet is queued; otherwise a new proposal is raised (or the pending one returned). It never
 * approves anything: the sales admin still decides.
 */
export async function requestRegistration(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  dealId: string,
  user: Person,
): Promise<RequestResult> {
  if (!hasAnyRole(user, REQUEST_ROLES))
    throw forbidden(`only ${REQUEST_ROLES.join(", ")} can request a registration`);
  const [deal] = await ctx.database.db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw notFound("deal");
  const kind = registryKindFor(deal.dealType);
  const gate = REGISTRY_GATE_OF_KIND[kind];
  if (deal.state !== STATE_OF_KIND[kind])
    throw conflict(
      "not_in_registration_step",
      `a ${SERVICE_LABEL[kind]} is requested in ${STATE_OF_KIND[kind]}, not ${deal.state}`,
    );
  return withSpaTx(ctx.database, async (tx) => {
    const gates = await tx.db
      .select()
      .from(spaApprovals)
      .where(and(eq(spaApprovals.entityId, dealId), eq(spaApprovals.gate, gate)))
      .orderBy(desc(spaApprovals.createdAt));
    const ran = new Set(
      (
        await tx.db.select({ a: registrations.approvalId }).from(registrations).where(eq(registrations.dealId, dealId))
      ).map((r) => r.a),
    );
    const ready = gates.find((g) => g.status === "approved" && !g.consumedByEventId && !ran.has(g.id));
    if (ready) {
      await enqueueRegistration(ctx, boss, { dealId, approvalId: ready.id });
      return { status: "queued" as const, approvalId: ready.id };
    }
    const p = await proposeSubmission(ctx, tx, deal, gate, `user:${user.id}`);
    return { status: p.created ? ("proposed" as const) : ("already_pending" as const), approvalId: p.id };
  });
}

/** A deal's registration attempts, newest last: what was sent where and what came back. No payload, no ID numbers. */
export async function listRegistrations(ctx: SpaContext, dealId: string, user: Person) {
  if (!hasAnyRole(user, READ_ROLES)) throw forbidden("your role can't read registrations");
  const [d] = await ctx.database.db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  return registrationsView(ctx, dealId);
}

/** The registry attempts with no role check: the caller (a route or a record section) has made it. */
export async function registrationsView(ctx: SpaContext, dealId: string) {
  const rows = await ctx.database.db
    .select({
      id: registrations.id,
      kind: registrations.kind,
      attempt: registrations.attempt,
      status: registrations.status,
      registryNo: registrations.registryNo,
      issuedOn: registrations.issuedOn,
      reasons: registrations.reasons,
      approvalId: registrations.approvalId,
      createdAt: registrations.createdAt,
    })
    .from(registrations)
    .where(eq(registrations.dealId, dealId))
    .orderBy(asc(registrations.createdAt), asc(registrations.attempt));
  // What a registry says back may repeat an ID or an account number it was sent: masked on the way out (rule 8).
  return {
    attempts: rows.map((r) => ({ ...r, reasons: r.reasons.map((x) => ({ ...x, message: maskPiiText(x.message) })) })),
  };
}
