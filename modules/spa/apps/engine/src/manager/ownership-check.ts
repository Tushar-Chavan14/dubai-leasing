import { newId } from "@platform/kernel/ids";
import { maskPii } from "@platform/kernel/pii";
import type { SpaActor } from "@spa/core";
import { deals, helperRuns, withSpaTx } from "@spa/db";
import { interpretDeed, interpretLicence, ownershipChecks, READER_PROMPT_VERSION, type ReadFields } from "@spa/helpers";
import { and, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { OWNERSHIP_CHECK_JOB } from "../jobs.ts";
import { driveAfter } from "./drive.ts";
import { afterHelperResult, requireHelperOn } from "./helper-modes.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { matchOwners } from "./listings.ts";
import { currentOwnershipDocs, sellerLicences } from "./ownership-docs.ts";
import { ensureRead, needSales, type ReaderDeps } from "./readers.ts";

export { OWNERSHIP_CHECK_JOB };
export const ownershipJobKey = (dealId: string, docsHash: string) => `${dealId}:ownership:${docsHash}`;

const CHECKER: SpaActor = "system:ownership-check";
const CLOSED = new Set(["HANDED_OVER", "COMPLETED", "CANCELLED"]);

async function resaleDeal(ctx: SpaContext, dealId: string) {
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  if (d.dealType === "primary_offplan")
    throw unprocessable("not_resale", "a primary deal's unit is the developer's: there is no ownership document");
  return d;
}

async function docsHashFor(ctx: SpaContext, deal: Awaited<ReturnType<typeof resaleDeal>>) {
  const docs = await currentOwnershipDocs(ctx.database.db, deal);
  if (!docs) throw unprocessable("no_ownership_document", "upload the title deed or Oqood to this deal first");
  return docs;
}

export interface OwnershipCheckResult {
  status: "matched" | "review" | "needs_human";
  /** False when the same documents had already been checked. */
  created: boolean;
}

/** Queues an ownership check: one job per deal and set of documents (rule 7). */
export async function enqueueOwnershipCheck(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  input: { dealId: string },
  user?: { id: string; role: Parameters<typeof needSales>[0]["role"] },
): Promise<{ key: string; jobId: string | null; queued: boolean }> {
  if (user) needSales(user, "start an ownership check");
  const deal = await resaleDeal(ctx, input.dealId);
  await requireHelperOn(ctx, "spa_ownership_check", "*", input.dealId);
  const { hash } = await docsHashFor(ctx, deal);
  const key = ownershipJobKey(input.dealId, hash);
  const jobId = await boss.send(OWNERSHIP_CHECK_JOB, input, { singletonKey: key });
  return { key, jobId, queued: jobId !== null };
}

/**
 * Checks a resale's ownership document against its sellers (S14, S52). The reader copies the owners, shares and property
 * number; code decides, using the C5 listing matching (`matchOwners`, one to one, every owner a seller): shares add to
 * exactly 10000 bps, the property number is the deal's (a number the record lacks is `not_checked`, which is review),
 * and a company owner is the name on its trade licence. Anything else is `review`: `seller_verification` for a sales
 * manager. The result is a `helper_runs` row; a model can't make it `matched`.
 */
export async function runOwnershipCheck(
  ctx: SpaContext,
  deps: ReaderDeps,
  input: { dealId: string },
  actor: SpaActor = CHECKER,
): Promise<OwnershipCheckResult> {
  const r = await runOwnershipCheckOnce(ctx, deps, input, actor);
  await driveAfter(ctx, input.dealId);
  return r;
}

async function runOwnershipCheckOnce(
  ctx: SpaContext,
  deps: ReaderDeps,
  input: { dealId: string },
  actor: SpaActor = CHECKER,
): Promise<OwnershipCheckResult> {
  const deal = await resaleDeal(ctx, input.dealId);
  if (CLOSED.has(deal.state)) throw conflict("deal_closed", `a deal in ${deal.state} needs no more checks`);
  await requireHelperOn(ctx, "spa_ownership_check", "*", deal.id);
  const db = ctx.database.db;
  const { deed, licences, hash } = await docsHashFor(ctx, deal);
  const latest = async (d: typeof db) =>
    (
      await d
        .select()
        .from(helperRuns)
        .where(and(eq(helperRuns.helper, "spa_ownership_check"), eq(helperRuns.entityId, deal.id)))
        .orderBy(desc(helperRuns.createdAt), desc(helperRuns.id))
        .limit(1)
    )[0];
  const done = (r: Awaited<ReturnType<typeof latest>>) =>
    r && r.status === "ok" && (r.result as { docsHash?: string }).docsHash === hash
      ? ((r.result as { status: "matched" | "review" }).status as "matched" | "review")
      : null;
  const before = done(await latest(db));
  if (before) return { status: before, created: false };

  const reading = await ensureRead(ctx, deps, deed);
  const licenceNames = new Map<string, string | null>();
  // Instruction-like text on the deed or on any licence read: never a "matched" (S52 amendment).
  let instructionFound = reading.ok && reading.row.instructionFound;
  for (const l of licences) {
    const r = await ensureRead(ctx, deps, l);
    if (r.ok && r.row.instructionFound) instructionFound = true;
    const name = r.ok ? interpretLicence(r.row.fields as ReadFields).tradeName : null;
    licenceNames.set(l.partyId!, name);
  }
  const sellers = await sellerLicences(db, deal.id);
  const result = reading.ok
    ? ownershipChecks({
        deed: interpretDeed(reading.row.fields as ReadFields),
        dealUnitNo: deal.unitNo,
        sellers: sellers.map((s) => ({ name: s.name, kind: s.kind, licenceName: licenceNames.get(s.id) ?? null })),
        matchOwners,
        instructionFound,
      })
    : null;

  return withSpaTx(ctx.database, async (tx): Promise<OwnershipCheckResult> => {
    await tx.db.select().from(deals).where(eq(deals.id, deal.id)).for("update");
    const again = done(await latest(tx.db));
    if (again) return { status: again, created: false };
    const status = result ? result.status : "needs_human";
    const messages = result ? result.findings.map((f) => f.message) : reading.ok ? [] : reading.reasons;
    const runId = newId();
    await tx.db.insert(helperRuns).values({
      id: runId,
      helper: "spa_ownership_check",
      dealId: deal.id,
      entityKind: "deal",
      entityId: deal.id,
      status: result ? "ok" : "needs_human",
      result: maskPii({
        status,
        docsHash: hash,
        docKind: deed.kind,
        findings: result?.findings.map((f) => ({ code: f.code, message: f.message })) ?? [],
        instructionFound,
      }),
      reasons: maskPii(messages),
      modelTag: reading.ok ? reading.row.modelTag : (deps.llm.visionModelName ?? null),
      promptVersion: READER_PROMPT_VERSION,
      rulesVersion: deal.rulesVersion,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: deal.id },
      type: "OWNERSHIP_CHECKED",
      actor,
      rulesVersion: deal.rulesVersion,
      payload: { status, docKind: deed.kind, codes: result?.findings.map((f) => f.code) ?? [] },
    });
    // Review mode (S59): a match waits for a person's "looks right" before it counts.
    if (status === "matched")
      await afterHelperResult(ctx, tx, {
        helper: "spa_ownership_check",
        scope: "*",
        dealId: deal.id,
        runId,
        status: "ok",
      });
    if (status === "review")
      await proposeApproval(
        ctx,
        {
          gate: "seller_verification",
          entity: { kind: "deal", id: deal.id },
          dedupeKey: `${deal.id}:ownership:${hash}`,
          title: "Ownership document doesn't match",
          proposal: { ownershipDocsHash: hash, codes: result!.findings.map((f) => f.code) },
          reasons: messages,
          proposedBy: actor,
        },
        tx,
      );
    return { status, created: true };
  });
}
