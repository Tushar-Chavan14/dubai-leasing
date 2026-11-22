import {
  type HelperMode,
  HELPER_LABELS,
  HELPER_MODES,
  isSwitchableHelper,
  READER_SCOPES,
  REVIEWABLE_READER_SCOPES,
  reviewAllowed,
  scopeAllowed,
  type SpaRole,
  SWITCHABLE_HELPERS,
  type SwitchableHelper,
} from "@spa/core";
import {
  deals,
  documentReads,
  helperReviewHolds,
  helperRuns,
  type SpaDb,
  spaApprovals,
  spaHelperSettings,
  spaUsers,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, takingVersion, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { proposeApproval } from "./approvals.ts";
import { openTask } from "./tasks.ts";

/** Where the settings events are written (a fixed id, like the AML policy's): no record, just the settings. */
const HELPER_SETTINGS = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000024" };

/**
 * The mode in force for a helper and scope (S22, S59): the latest version of that scope, else of `*`, else `auto`. Reads
 * through any database handle, so a fact loader and a job can ask inside their own transaction.
 */
export async function helperMode(db: SpaDb, helper: string, scope = "*"): Promise<HelperMode> {
  const rows = await db
    .select({ scope: spaHelperSettings.scope, mode: spaHelperSettings.mode, version: spaHelperSettings.version })
    .from(spaHelperSettings)
    .where(
      and(eq(spaHelperSettings.helper, helper), inArray(spaHelperSettings.scope, scope === "*" ? ["*"] : [scope, "*"])),
    )
    .orderBy(desc(spaHelperSettings.version));
  const exact = rows.find((r) => r.scope === scope);
  return (exact ?? rows.find((r) => r.scope === "*"))?.mode ?? "auto";
}

const MODEL_KEY = /model|prompt|tag/i;
const SettingBody = z.strictObject({
  helper: z.string(),
  scope: z.string().min(1).max(40).optional(),
  mode: z.enum(HELPER_MODES),
});

export interface HelperSettingResult {
  helper: SwitchableHelper;
  scope: string;
  mode: HelperMode;
  version: number;
  /** False when the mode was already this: no new version was written. */
  changed: boolean;
}

/**
 * An admin sets one helper's mode (S22, S59). A change is a new version row and a `HELPER_MODE_SET` event; the same mode
 * again changes nothing. A helper that is not switchable is 422, and so is any model or prompt field: models are
 * read-only (S25). Running jobs keep the mode they started under; the next result reads the new one.
 */
export async function setHelperMode(
  ctx: SpaContext,
  user: { id: string; role: SpaRole },
  input: unknown,
): Promise<HelperSettingResult> {
  if (user.role !== "admin") throw forbidden("only an admin changes how the helpers run");
  if (input && typeof input === "object" && Object.keys(input).some((k) => MODEL_KEY.test(k)))
    throw unprocessable("model_read_only", "models are set in the engine's environment, not here");
  const body = SettingBody.safeParse(input);
  if (!body.success)
    throw unprocessable("invalid_helper_setting", "send a helper, an optional scope and a mode (auto, review or off)");
  const { helper, mode } = body.data;
  const scope = body.data.scope ?? "*";
  if (!isSwitchableHelper(helper))
    throw unprocessable("not_switchable", "this one always runs the same way and can't be switched");
  if (!scopeAllowed(helper, scope)) throw unprocessable("invalid_helper_setting", "this helper has no such scope");
  if (mode === "review" && !reviewAllowed(helper, scope))
    throw unprocessable("review_not_available", "a person's check isn't offered for this kind: its read holds nothing");
  return takingVersion(() =>
    withSpaTx(ctx.database, async (tx) => {
      await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`helper_mode:${helper}:${scope}`}))`);
      const [latest] = await tx.db
        .select()
        .from(spaHelperSettings)
        .where(and(eq(spaHelperSettings.helper, helper), eq(spaHelperSettings.scope, scope)))
        .orderBy(desc(spaHelperSettings.version))
        .limit(1);
      const current = latest?.mode ?? (await helperMode(tx.db, helper, scope));
      if (latest && latest.mode === mode) return { helper, scope, mode, version: latest.version, changed: false };
      // Nothing was ever set for `*` and the mode asked for is the default: there is nothing to record.
      if (!latest && scope === "*" && mode === "auto") return { helper, scope, mode, version: 0, changed: false };
      const version = (latest?.version ?? 0) + 1;
      await tx.db
        .insert(spaHelperSettings)
        .values({ helper, scope, version, mode, setBy: `user:${user.id}`, setAt: ctx.clock.now() });
      await appendDealEvent(tx, ctx, {
        entity: HELPER_SETTINGS,
        type: "HELPER_MODE_SET",
        actor: `user:${user.id}`,
        payload: { helper, scope, mode, version, previous: current },
      });
      return { helper, scope, mode, version, changed: true };
    }),
  );
}

export interface ModelTags {
  vision?: string | null | undefined;
  chat?: string | null | undefined;
  decision?: string | null | undefined;
}
/** Which env model each helper uses, if any (read-only on the screen). The agreement is filled by code: no model. */
const MODEL_OF: Record<SwitchableHelper, keyof ModelTags | null> = {
  spa_ownership_check: "vision",
  spa_kyc: "vision",
  spa_company_check: "vision",
  spa_document_reader: "vision",
  spa_prepare: null,
  registry: "decision",
  spa_agreement_review: "chat",
};

/** What Settings → AI helpers shows (S59). An admin edits; a sales manager reads; nobody else. */
export async function getHelperSettings(ctx: SpaContext, user: { id: string; role: SpaRole }, models: ModelTags) {
  if (user.role !== "admin" && user.role !== "sales_manager")
    throw forbidden("only an admin or a sales manager sees how the helpers run");
  const rows = await ctx.database.db.select().from(spaHelperSettings).orderBy(desc(spaHelperSettings.version));
  const names = new Map(
    (await ctx.database.db.select({ id: spaUsers.id, name: spaUsers.name }).from(spaUsers)).map((u) => [u.id, u.name]),
  );
  return {
    canEdit: user.role === "admin",
    helpers: SWITCHABLE_HELPERS.map((helper) => {
      const mine = rows.filter((r) => r.helper === helper);
      const latest = new Map<string, (typeof mine)[number]>();
      for (const r of mine) if (!latest.has(r.scope)) latest.set(r.scope, r);
      const star = latest.get("*");
      const scopes = ["*", ...[...latest.keys()].filter((s) => s !== "*").toSorted()];
      const key = MODEL_OF[helper];
      return {
        helper,
        label: HELPER_LABELS[helper],
        model: key ? (models[key] ?? null) : null,
        availableScopes: helper === "spa_document_reader" ? ["*", ...READER_SCOPES] : ["*"],
        /** The scopes that may be set to `review` (the others can only be auto or off). */
        reviewScopes: helper === "spa_document_reader" ? ["*", ...REVIEWABLE_READER_SCOPES] : ["*"],
        settings: scopes.map((scope) => {
          const r = latest.get(scope);
          return {
            scope,
            mode: (r ?? star)?.mode ?? ("auto" as HelperMode),
            version: r?.version ?? 0,
            setAt: r?.setAt.toISOString() ?? null,
            setBy: r ? (names.get(r.setBy.replace(/^user:/, "")) ?? null) : null,
          };
        }),
      };
    }),
  };
}

export interface HelperResult {
  helper: SwitchableHelper;
  scope: string;
  dealId: string;
  /** The `helper_runs` row this result is. */
  runId: string;
  status: "ok" | "needs_human";
}

/**
 * Runs at the end of each switchable helper, inside its transaction (S22, S59). An `ok` result in review mode is held:
 * a `helper_review_holds` row and a `helper_review` gate for a sales officer. Everything else is untouched: `auto`
 * lets the result count at once, `needs_human` goes to its usual gate in every mode, and `off` never gets here (the
 * job isn't queued). Safe to run twice for one run: one hold, one gate.
 */
export async function afterHelperResult(ctx: SpaContext, tx: SpaTx, r: HelperResult): Promise<{ held: boolean }> {
  if (r.status !== "ok") return { held: false };
  if ((await helperMode(tx.db, r.helper, r.scope)) !== "review") return { held: false };
  const [seen] = await tx.db.select().from(helperReviewHolds).where(eq(helperReviewHolds.runId, r.runId));
  if (seen) return { held: true };
  const approval = await proposeApproval(
    ctx,
    {
      gate: "helper_review",
      entity: { kind: "deal", id: r.dealId },
      dedupeKey: `${r.runId}:helper_review`,
      title: `Check the result: ${HELPER_LABELS[r.helper]}`,
      proposal: { helper: r.helper, scope: r.scope, runId: r.runId },
      reasons: ["The helper's result is waiting for a person to look at it. Nothing moves on until you do."],
      proposedBy: `system:${r.helper}`,
    },
    tx,
  );
  const inserted = await tx.db
    .insert(helperReviewHolds)
    .values({
      runId: r.runId,
      dealId: r.dealId,
      approvalId: approval.id,
      status: "pending",
      createdAt: ctx.clock.now(),
    })
    .onConflictDoNothing()
    .returning({ runId: helperReviewHolds.runId });
  if (inserted.length)
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: r.dealId },
      type: "HELPER_REVIEW_HELD",
      actor: `system:${r.helper}`,
      payload: { helper: r.helper, scope: r.scope, runId: r.runId, approvalId: approval.id },
    });
  return { held: true };
}

/**
 * The runs of this deal that must not count: held and not released (pending, or rejected by a person). Every real fact
 * loader skips a run named here.
 */
export async function heldRunIds(tx: SpaTx, dealId: string): Promise<Set<string>> {
  const rows = await tx.db
    .select({ runId: helperReviewHolds.runId })
    .from(helperReviewHolds)
    .where(and(eq(helperReviewHolds.dealId, dealId), ne(helperReviewHolds.status, "released")));
  return new Set(rows.map((r) => r.runId));
}

/** The agreements of this deal whose preparation is held (the `spa_prepare` run names its agreement). */
export async function heldAgreementIds(tx: SpaTx, dealId: string, pendingOnly = false): Promise<Set<string>> {
  const held = pendingOnly
    ? (
        await tx.db
          .select({ runId: helperReviewHolds.runId })
          .from(helperReviewHolds)
          .where(and(eq(helperReviewHolds.dealId, dealId), eq(helperReviewHolds.status, "pending")))
      ).map((r) => r.runId)
    : [...(await heldRunIds(tx, dealId))];
  if (!held.length) return new Set();
  const rows = await tx.db
    .select({ result: helperRuns.result })
    .from(helperRuns)
    .where(and(inArray(helperRuns.id, held), eq(helperRuns.helper, "spa_prepare")));
  return new Set(rows.flatMap((r) => (typeof r.result.agreementId === "string" ? [r.result.agreementId] : [])));
}

/** The documents of this deal whose read is held: what a reader wrote from them (a NOC, a bank letter) doesn't count. */
export async function heldDocumentIds(tx: SpaTx, dealId: string): Promise<Set<string>> {
  const held = [...(await heldRunIds(tx, dealId))];
  if (!held.length) return new Set();
  const rows = await tx.db
    .select({ documentId: documentReads.documentId })
    .from(documentReads)
    .where(inArray(documentReads.runId, held));
  return new Set(rows.map((r) => r.documentId));
}

export interface HeldDecision {
  dealId: string;
  helper: SwitchableHelper;
  scope: string;
  runId: string;
  decision: "released" | "rejected";
  result: Record<string, unknown>;
}

/**
 * A person decides a `helper_review` (inside `decideApproval`'s transaction). Approving releases the hold; the result then
 * counts. Rejecting closes it for good: the result never counts, and a task tells the agent to do the step by hand.
 */
export async function applyHelperReviewDecision(
  tx: SpaTx,
  ctx: SpaContext,
  approval: typeof spaApprovals.$inferSelect,
  decision: "approve" | "reject",
  user: { id: string },
): Promise<HeldDecision | null> {
  const [hold] = await tx.db
    .select()
    .from(helperReviewHolds)
    .where(eq(helperReviewHolds.approvalId, approval.id))
    .for("update");
  if (!hold) return null;
  const [run] = await tx.db.select().from(helperRuns).where(eq(helperRuns.id, hold.runId));
  const helper = run!.helper as SwitchableHelper;
  const scope = String(approval.proposal.scope ?? "*");
  const status = decision === "approve" ? "released" : "rejected";
  await tx.db
    .update(helperReviewHolds)
    .set({ status, decidedAt: ctx.clock.now() })
    .where(eq(helperReviewHolds.runId, hold.runId));
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: hold.dealId },
    type: decision === "approve" ? "HELPER_REVIEW_RELEASED" : "HELPER_REVIEW_REJECTED",
    actor: `user:${user.id}`,
    payload: { helper, scope, runId: hold.runId, approvalId: approval.id },
  });
  if (decision === "reject") {
    const [deal] = await tx.db.select({ ref: deals.ref }).from(deals).where(eq(deals.id, hold.dealId));
    await openTask(ctx, tx, {
      dealId: hold.dealId,
      kind: "helper_rejected",
      role: "sales_officer",
      title: `${HELPER_LABELS[helper]}: a person didn't accept the result${deal?.ref ? ` on ${deal.ref}` : ""}. Do this step by hand and check the same things.`,
      detail: { helper, scope, runId: hold.runId },
      dedupeKey: `${hold.runId}:helper_rejected`,
    });
  }
  return { dealId: hold.dealId, helper, scope, runId: hold.runId, decision: status, result: run!.result };
}

/**
 * What the agent does by hand when a helper is off: the same checks the helper makes, in plain words. No compliance
 * wording, no names and no numbers (a task is read by every sales role).
 */
const OFF_WORDS: Record<SwitchableHelper, string> = {
  spa_ownership_check:
    "Check the title deed yourself: the property number is this deal's, every owner on it is a seller, and the shares add up to 100%.",
  spa_kyc:
    "Check each party's documents yourself: the identity document is readable and not expired, and the names match the deal.",
  spa_company_check:
    "Check the company's papers yourself: the trade licence is valid, the signer holds a power over property, and note the shareholders at or above the owner threshold.",
  spa_document_reader:
    "Enter the document's details by hand, from the document itself, with the same checks as for a typed entry.",
  spa_prepare:
    "Prepare the agreement by hand from the approved template and check that every core field is filled from this deal.",
  registry: "Fix the registry rejection by hand if a record is wrong, then request the registration again.",
  spa_agreement_review:
    "Read the agreement and the offer's conditions yourself: look for clauses that conflict, and for any amount or date that isn't this deal's.",
};

/**
 * Off mode (S59): the helper's job is not queued and not run. The route answers 409 `helper_off`, and one task (per deal,
 * helper and scope, while it is open) tells the agent the step is theirs. Nothing counts as done: the facts stay closed.
 * Call it where a job would be queued and where its handler starts (a job queued before the switch is turned off too).
 */
export async function requireHelperOn(
  ctx: SpaContext,
  helper: SwitchableHelper,
  scope: string,
  dealId: string,
): Promise<void> {
  if ((await helperMode(ctx.database.db, helper, scope)) !== "off") return;
  const what = scope === "*" ? OFF_WORDS[helper] : `${OFF_WORDS[helper]} (${scope.replaceAll("_", " ")})`;
  await openHelperOffTask(ctx, helper, dealId, what, `${dealId}:${helper}:${scope}`);
  throw conflict("helper_off", `${HELPER_LABELS[helper]} is switched off: a task was opened to do this step by hand`);
}

/** Opens (once) the task that tells the agent a helper is off and the step is theirs, with the checks to make. */
export async function openHelperOffTask(
  ctx: SpaContext,
  helper: SwitchableHelper,
  dealId: string | null,
  what: string,
  key: string,
): Promise<void> {
  await withSpaTx(ctx.database, (tx) =>
    openTask(ctx, tx, {
      dealId,
      kind: "helper_off",
      role: "sales_officer",
      title: `${HELPER_LABELS[helper]} is switched off. ${what}`,
      detail: { helper },
      dedupeKey: `${key}:helper_off`,
    }),
  );
}
