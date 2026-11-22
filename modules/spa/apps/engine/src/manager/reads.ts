import { maskPiiText } from "@platform/kernel/pii";
import {
  canDecideSpaGate,
  type DealStep,
  HELPER_LABELS,
  type DealState,
  DealType,
  DEAL_STATES,
  isComplianceGate,
  isComplianceRole,
  SpaGateId,
  type SpaRole,
  stageKey,
  type StageKey,
  stageLabel,
  STAFF_EVENTS,
  taskVisibleTo,
} from "@spa/core";
import {
  dealEvents,
  dealParties,
  deals,
  helperRuns,
  listings,
  parties,
  spaApprovals,
  type SpaDb,
  spaTasks,
  units,
} from "@spa/db";
import { and, asc, count, desc, eq, ilike, inArray, notInArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { notFound, forbidden } from "./errors.ts";
import type { DealRow } from "./facts.ts";
import { agreementReviewView } from "./agreement-review.ts";
import {
  type ApprovalRow,
  type RecordSection,
  RECORD_SECTIONS,
  stepReached,
  userNames,
  viewApproval,
  viewHelperRun,
  viewEvent,
  viewTask,
  type Viewer,
  waitingFor,
} from "./views.ts";

/**
 * The read side (C29, S57): what the staff app calls. No write, no state change. Every function takes the session's
 * viewer (id and role, from the verified token and nothing else) and answers through `views.ts`.
 */

// ---------------------------------------------------------------------------------------------
// Paging: a cursor is the last row's time and id, so a page never skips or repeats a row.

const bool = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");
export const Limit = z.coerce.number().int().min(1).max(100).default(50);
export const Cursor = z.string().min(1).max(200).optional();

const encodeCursor = (at: Date, id: string): string => Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decodeCursor(c: string | undefined): { at: string; id: string } | null | undefined {
  if (!c) return undefined;
  const [at, id, ...rest] = Buffer.from(c, "base64url").toString("utf8").split("|");
  if (rest.length || !at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at: new Date(at).toISOString(), id };
}
/** Throws a 400-class error for the route when the cursor isn't one we made. */
export class BadQuery extends Error {}
export const cursorOf = (c: string | undefined) => {
  const d = decodeCursor(c);
  if (d === null) throw new BadQuery("that page cursor is not valid");
  return d;
};
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export function paged<T>(
  rows: T[],
  limit: number,
  key: (r: T) => { at: Date; id: string },
): { rows: T[]; nextCursor: string | null } {
  const more = rows.length > limit;
  const slice = more ? rows.slice(0, limit) : rows;
  const last = slice.at(-1);
  return { rows: slice, nextCursor: more && last ? encodeCursor(key(last).at, key(last).id) : null };
}

// ---------------------------------------------------------------------------------------------
// Deals

const TYPE_LABELS: Record<DealType, string> = {
  primary_offplan: "Primary off-plan",
  resale_ready: "Ready resale",
  resale_offplan: "Off-plan resale",
};

export const DealsQuery = z.object({
  type: DealType.optional(),
  stage: z.string().max(30).optional(),
  q: z.string().trim().max(100).optional(),
  mine: bool,
  hold: bool,
  default: bool,
  limit: Limit,
  cursor: Cursor,
});
export type DealsQuery = z.infer<typeof DealsQuery>;

/** The states a stage filter means for this role, or null when the role may not use that word. */
export function stageStates(stage: string, role: SpaRole): DealState[] | null {
  if (stage === "ON_HOLD") return ["AML_HOLD"];
  if (stage === "AML_HOLD") return isComplianceRole(role) ? ["AML_HOLD"] : null;
  return (DEAL_STATES as readonly string[]).includes(stage) ? [stage as DealState] : null;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
export const TERMINAL: DealState[] = ["HANDED_OVER", "COMPLETED", "CANCELLED"];

export interface DealView {
  id: string;
  ref: string;
  type: DealType;
  typeLabel: string;
  stage: StageKey;
  stageLabel: string;
  property: { kind: "unit" | "listing"; label: string };
  sellers: string[];
  buyers: string[];
  priceFils: number;
  onHold: boolean;
  inDefault: boolean;
  waitingFor: ReturnType<typeof waitingFor>;
  owner: { label: string } | null;
  createdAt: Date;
  ageDays: number;
}

type DealJoined = { deal: DealRow; unitCode: string | null; listingRef: string | null; listingTitle: string | null };

/** The shared row shape for the Work list and the record header: parties, property, owner and who it waits for. */
async function dealViews(ctx: SpaContext, viewer: Viewer, rows: DealJoined[]): Promise<DealView[]> {
  if (!rows.length) return [];
  const db = ctx.database.db;
  const ids = rows.map((r) => r.deal.id);
  const people = await db
    .select({ dealId: dealParties.dealId, role: dealParties.role, order: dealParties.order, name: parties.fullNameEn })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(inArray(dealParties.dealId, ids))
    .orderBy(asc(dealParties.order));
  const pending = await db
    .select({
      id: spaApprovals.id,
      entityId: spaApprovals.entityId,
      gate: spaApprovals.gate,
      approverRole: spaApprovals.approverRole,
      createdAt: spaApprovals.createdAt,
    })
    .from(spaApprovals)
    .where(
      and(eq(spaApprovals.entityKind, "deal"), inArray(spaApprovals.entityId, ids), eq(spaApprovals.status, "pending")),
    );
  const entered = await db
    .selectDistinctOn([dealEvents.entityId], { entityId: dealEvents.entityId, at: dealEvents.at })
    .from(dealEvents)
    .where(
      and(eq(dealEvents.entityKind, "deal"), inArray(dealEvents.entityId, ids), sql`${dealEvents.toState} is not null`),
    )
    .orderBy(dealEvents.entityId, desc(dealEvents.at), desc(dealEvents.id));
  const names = await userNames(
    db,
    rows.map((r) => r.deal.createdBy),
  );
  const now = ctx.clock.now();
  return rows.map(({ deal, unitCode, listingRef, listingTitle }) => {
    const stage = stageKey(deal.state, viewer.role);
    const owner = deal.createdBy.startsWith("user:") ? (names.get(deal.createdBy.slice(5)) ?? null) : null;
    return {
      id: deal.id,
      ref: deal.ref,
      type: deal.dealType,
      typeLabel: TYPE_LABELS[deal.dealType],
      stage,
      stageLabel: stageLabel(stage),
      property: deal.unitId
        ? { kind: "unit", label: unitCode ?? deal.unitNo ?? "Unit" }
        : { kind: "listing", label: listingTitle ?? listingRef ?? "Listing" },
      sellers: people.filter((p) => p.dealId === deal.id && p.role === "seller").map((p) => maskPiiText(p.name)),
      buyers: people.filter((p) => p.dealId === deal.id && p.role === "buyer").map((p) => maskPiiText(p.name)),
      priceFils: deal.priceFils,
      onHold: deal.state === "AML_HOLD",
      inDefault: deal.inDefault,
      waitingFor: waitingFor(
        deal,
        pending.filter((p) => p.entityId === deal.id),
        entered.find((e) => e.entityId === deal.id)?.at ?? null,
        viewer.role,
        now,
      ),
      owner: owner ? { label: owner } : null,
      createdAt: deal.createdAt,
      ageDays: Math.max(0, Math.floor((now.getTime() - deal.createdAt.getTime()) / 86_400_000)),
    };
  });
}

const dealSelect = (db: SpaDb) =>
  db
    .select({ deal: deals, unitCode: units.code, listingRef: listings.ref, listingTitle: listings.title })
    .from(deals)
    .leftJoin(units, eq(units.id, deals.unitId))
    .leftJoin(listings, eq(listings.id, deals.listingId));

/** The Work list's deals (design §4.2): newest first, filtered, 100 at most. Search covers ref, property and party names, never ID numbers. */
export async function listDeals(ctx: SpaContext, viewer: Viewer, q: DealsQuery): Promise<Page<DealView>> {
  const cur = cursorOf(q.cursor);
  const where: (SQL | undefined)[] = [];
  if (q.type) where.push(eq(deals.dealType, q.type));
  if (q.stage) {
    const states = stageStates(q.stage, viewer.role);
    if (!states) throw new BadQuery("that stage is not one you can filter by");
    where.push(inArray(deals.state, states));
  }
  if (q.hold) where.push(eq(deals.state, "AML_HOLD"));
  if (q.default) where.push(eq(deals.inDefault, true));
  if (q.mine) where.push(eq(deals.createdBy, `user:${viewer.id}`));
  if (q.q) {
    const like = `%${likeEscape(q.q)}%`;
    where.push(
      or(
        ilike(deals.ref, like),
        ilike(units.code, like),
        ilike(listings.ref, like),
        ilike(listings.title, like),
        sql`exists (select 1 from ${dealParties} dp join ${parties} p on p.id = dp.party_id where dp.deal_id = ${deals.id} and p.full_name_en ilike ${like})`,
      ),
    );
  }
  if (cur) where.push(sql`(${deals.createdAt}, ${deals.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await dealSelect(ctx.database.db)
    .where(and(...where))
    .orderBy(desc(deals.createdAt), desc(deals.id))
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.deal.createdAt, id: r.deal.id }));
  return { items: await dealViews(ctx, viewer, p.rows), nextCursor: p.nextCursor };
}

/** The deal record: the header and every section in `RECORD_SECTIONS` that applies to this deal. */
export async function getDealRecord(ctx: SpaContext, viewer: Viewer, dealId: string) {
  const [row] = await dealSelect(ctx.database.db).where(eq(deals.id, dealId));
  if (!row) throw notFound("deal");
  const [head] = await dealViews(ctx, viewer, [row]);
  const d = row.deal;
  const sections: Record<string, unknown> = {};
  // `steps` loads first, so a later section can ask whether the deal has reached its step (C39, S71).
  for (const s of RECORD_SECTIONS as readonly RecordSection[]) {
    if (!s.appliesTo(d)) continue;
    if (s.visibleTo && !s.visibleTo(viewer.role)) continue;
    if (s.steps && !stepReached((sections.steps ?? []) as DealStep[], s.steps)) continue;
    sections[s.key] = await s.load(ctx.database, d, viewer, ctx);
  }
  return {
    deal: {
      ...head!,
      rulesVersion: d.rulesVersion,
      policyVersion: d.policyVersion,
      sellerMortgage: d.sellerMortgage,
      buyerMortgage: d.buyerMortgage,
      planTakenOver: d.planTakenOver,
      targetTransferOn: d.targetTransferOn,
      unitNo: d.unitNo,
      projectCode: d.projectCode,
      inDefaultSince: d.inDefaultSince,
      inDefaultReason: d.inDefaultReason,
    },
    waitingFor: head!.waitingFor,
    sections,
  };
}

// ---------------------------------------------------------------------------------------------
// Activity timeline

export const EventsQuery = z.object({ limit: Limit, cursor: Cursor });

export async function listDealEvents(ctx: SpaContext, viewer: Viewer, dealId: string, q: z.infer<typeof EventsQuery>) {
  const db = ctx.database.db;
  const cur = cursorOf(q.cursor);
  const [d] = await db.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const where: (SQL | undefined)[] = [eq(dealEvents.entityKind, "deal"), eq(dealEvents.entityId, dealId)];
  // The allowlist is applied in the query, so a page is never short because of hidden rows (fail closed: S57).
  if (!isComplianceRole(viewer.role)) where.push(inArray(dealEvents.type, [...STAFF_EVENTS]));
  if (cur) where.push(sql`(${dealEvents.at}, ${dealEvents.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await db
    .select()
    .from(dealEvents)
    .where(and(...where))
    .orderBy(desc(dealEvents.at), desc(dealEvents.id))
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.at, id: r.id }));
  const names = await userNames(
    db,
    p.rows.map((r) => r.actor),
  );
  return {
    items: p.rows.map((r) => viewEvent(r, viewer.role, names)).filter((v) => v !== null),
    nextCursor: p.nextCursor,
  };
}

// ---------------------------------------------------------------------------------------------
// Approvals

export const ApprovalsQuery = z
  .object({
    scope: z.enum(["inbox", "deal"]).default("inbox"),
    dealId: z.uuid().optional(),
    status: z.enum(["pending", "decided", "all"]).default("all"),
    limit: Limit,
    cursor: Cursor,
  })
  .refine((q) => q.scope !== "deal" || !!q.dealId, { message: "send dealId with scope=deal", path: ["dealId"] });

const refsOf = async (db: SpaDb, rows: ApprovalRow[]): Promise<Map<string, string>> => {
  const ids = [...new Set(rows.filter((r) => r.entityKind === "deal").map((r) => r.entityId))];
  if (!ids.length) return new Map();
  return new Map(
    (await db.select({ id: deals.id, ref: deals.ref }).from(deals).where(inArray(deals.id, ids))).map((d) => [
      d.id,
      d.ref,
    ]),
  );
};
const decidable = (role: SpaRole): SpaGateId[] =>
  SpaGateId.options.filter((g) => canDecideSpaGate(g, role) && (isComplianceRole(role) || !isComplianceGate(g)));

/** The inbox is the gates this role decides (oldest first); the deal scope is every gate on one deal, in its neutral form where it must be. */
export async function listApprovals(ctx: SpaContext, viewer: Viewer, q: z.infer<typeof ApprovalsQuery>) {
  const db = ctx.database.db;
  const cur = cursorOf(q.cursor);
  const where: (SQL | undefined)[] = [];
  if (q.scope === "inbox") {
    const gates = decidable(viewer.role);
    if (!gates.length) return { items: [], nextCursor: null } satisfies Page<never>;
    where.push(eq(spaApprovals.status, "pending"), inArray(spaApprovals.gate, gates));
  } else {
    where.push(eq(spaApprovals.entityKind, "deal"), eq(spaApprovals.entityId, q.dealId!));
    if (q.status === "pending") where.push(eq(spaApprovals.status, "pending"));
    if (q.status === "decided") where.push(sql`${spaApprovals.status} <> 'pending'`);
  }
  if (cur) where.push(sql`(${spaApprovals.createdAt}, ${spaApprovals.id}) > (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await db
    .select()
    .from(spaApprovals)
    .where(and(...where))
    .orderBy(asc(spaApprovals.createdAt), asc(spaApprovals.id))
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }));
  const names = await userNames(db, [...p.rows.map((r) => r.proposedBy), ...p.rows.map((r) => r.decidedBy)]);
  const refs = await refsOf(db, p.rows);
  return {
    items: await Promise.all(
      p.rows.map((r) =>
        withReview(ctx, viewer, r, { ...viewApproval(r, viewer, names), entityRef: refs.get(r.entityId) ?? null }),
      ),
    ),
    nextCursor: p.nextCursor,
  };
}

/**
 * What a card carries beyond the row. The review of an agreement joins the `agreement_approval` card (S60): flags for
 * legal, advice only. The result a `helper_review` card holds joins it (S63): the helper's name, its status and the
 * reasons it gave, masked, unless the run is marked for compliance. Only the staff approval routes call this: no party
 * route reads either.
 */
async function withReview<T extends { id: string }>(ctx: SpaContext, viewer: Viewer, row: ApprovalRow, item: T) {
  if (row.gate === "agreement_approval" && typeof row.proposal.agreementId === "string")
    return { ...item, agreementReview: await agreementReviewView(ctx, row.proposal.agreementId) };
  if (row.gate === "helper_review" && typeof row.proposal.runId === "string") {
    const [run] = await ctx.database.db.select().from(helperRuns).where(eq(helperRuns.id, row.proposal.runId));
    const seen = run ? viewHelperRun(run, viewer.role) : null;
    if (!seen) return item;
    const label = HELPER_LABELS[seen.helper as keyof typeof HELPER_LABELS] ?? seen.helper;
    return { ...item, heldResult: { helper: seen.helper, label, status: seen.status, reasons: seen.reasons } };
  }
  return item;
}

export async function getApproval(ctx: SpaContext, viewer: Viewer, id: string) {
  const db = ctx.database.db;
  const [row] = await db.select().from(spaApprovals).where(eq(spaApprovals.id, id));
  if (!row) throw notFound("approval");
  const names = await userNames(db, [row.proposedBy, row.decidedBy]);
  const refs = await refsOf(db, [row]);
  return withReview(ctx, viewer, row, {
    ...viewApproval(row, viewer, names),
    entityRef: refs.get(row.entityId) ?? null,
  });
}

// ---------------------------------------------------------------------------------------------
// Tasks and the Home counts

export const TasksQuery = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  status: z.enum(["open", "done", "all"]).default("open"),
  dealId: z.uuid().optional(),
  limit: Limit,
  cursor: Cursor,
});

const ROLES_FOR_ALL = (viewer: SpaRole): SpaRole[] =>
  (["sales_officer", "sales_manager", "sales_admin", "legal", "finance", "admin"] as SpaRole[]).filter((r) =>
    taskVisibleTo(r, viewer),
  );

export async function listTasks(ctx: SpaContext, viewer: Viewer, q: z.infer<typeof TasksQuery>) {
  const db = ctx.database.db;
  const cur = cursorOf(q.cursor);
  if (q.scope === "all" && viewer.role !== "sales_manager")
    throw forbidden("only a sales manager sees everyone's tasks");
  const roles = q.scope === "all" ? ROLES_FOR_ALL(viewer.role) : [viewer.role];
  const ascending = q.status === "open";
  const where: (SQL | undefined)[] = [inArray(spaTasks.role, roles)];
  if (q.status !== "all") where.push(eq(spaTasks.status, q.status === "open" ? "open" : "done"));
  if (q.dealId) where.push(eq(spaTasks.dealId, q.dealId));
  if (cur)
    where.push(
      ascending
        ? sql`(${spaTasks.createdAt}, ${spaTasks.id}) > (${cur.at}::timestamptz, ${cur.id}::uuid)`
        : sql`(${spaTasks.createdAt}, ${spaTasks.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`,
    );
  const rows = await db
    .select()
    .from(spaTasks)
    .where(and(...where))
    .orderBy(
      ...(ascending ? [asc(spaTasks.createdAt), asc(spaTasks.id)] : [desc(spaTasks.createdAt), desc(spaTasks.id)]),
    )
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }));
  return { items: p.rows.filter((t) => taskVisibleTo(t.role, viewer.role)).map(viewTask), nextCursor: p.nextCursor };
}

/** Home's counts (design §4.1): what waits for this role, and the open deals by the stage this role may read. */
export async function homeSummary(ctx: SpaContext, viewer: Viewer) {
  const db = ctx.database.db;
  const gates = decidable(viewer.role);
  const [inbox] = gates.length
    ? await db
        .select({ n: count() })
        .from(spaApprovals)
        .where(and(eq(spaApprovals.status, "pending"), inArray(spaApprovals.gate, gates)))
    : [{ n: 0 }];
  const [tasks] = await db
    .select({ n: count() })
    .from(spaTasks)
    .where(and(eq(spaTasks.status, "open"), eq(spaTasks.role, viewer.role)));
  const open = await db
    .select({
      state: deals.state,
      inDefault: deals.inDefault,
      mine: sql<boolean>`${deals.createdBy} = ${`user:${viewer.id}`}`,
    })
    .from(deals)
    .where(notInArray(deals.state, TERMINAL));
  const byStage: Record<string, number> = {};
  for (const d of open) byStage[stageKey(d.state, viewer.role)] = (byStage[stageKey(d.state, viewer.role)] ?? 0) + 1;
  return {
    role: viewer.role,
    inbox: { open: inbox!.n },
    tasks: { open: tasks!.n },
    deals: {
      open: open.length,
      mine: open.filter((d) => d.mine).length,
      onHold: open.filter((d) => d.state === "AML_HOLD").length,
      inDefault: open.filter((d) => d.inDefault).length,
      byStage,
    },
  };
}
