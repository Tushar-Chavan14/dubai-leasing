import { maskPii, maskPiiText } from "@platform/kernel/pii";
import { toDubaiDate } from "@platform/kernel/dates";
import { AML_LIST_LABEL } from "@spa/helpers";
import { getSalesRulebook, isPending } from "@spa/rulebook";
import { STAFF_EVENTS } from "@spa/core";
import {
  amlCases,
  amlHits,
  dealEvents,
  dealParties,
  deals,
  documentReads,
  documents,
  parties,
  riskAssessments,
  spaApprovals,
  type SpaDb,
} from "@spa/db";
import { and, asc, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { latestScreenings } from "./aml-facts.ts";
import type { SpaContext } from "./context.ts";
import { notFound } from "./errors.ts";
import { requireCompliance } from "./compliance.ts";
import { Cursor, cursorOf, getApproval, Limit, paged, type Page } from "./reads.ts";
import { userNames, viewEvent, type Viewer } from "./views.ts";

/**
 * The Compliance screen's case list and case view (C33, S65). Compliance roles only: every other role, admin
 * included, is refused first with the plain 403, so nothing says whether a case exists (S6, S57, S62). Everything here
 * reads existing tables; nothing writes. The model's summary is shown as a labelled suggestion, apart from the hits
 * that code found. Personal numbers are masked.
 */

export const CASE_TABS = ["open", "info_requested", "edd", "reported", "closed"] as const;
export const CasesQuery = z.object({ status: z.enum(CASE_TABS).default("open"), limit: Limit, cursor: Cursor });
export type CasesQuery = z.infer<typeof CasesQuery>;

const SUGGESTION = "Suggestion";
const suggestionOf = (summary: string, model: string | null, instructionLike: boolean, max?: number) => {
  const text = maskPiiText(summary);
  return {
    label: SUGGESTION,
    text: max && text.length > max ? `${text.slice(0, max)}…` : text,
    fromModel: model !== null,
    model,
    instructionLike,
  };
};

export interface CaseItem {
  id: string;
  kind: "case" | "edd";
  status: (typeof CASE_TABS)[number] | "cleared" | "stopped";
  dealId: string;
  dealRef: string;
  openedAt: Date;
  closedAt: Date | null;
  rules: string[];
  /** The person an EDD sign-off is about; null for a case. */
  partyName: string | null;
  suggestion: ReturnType<typeof suggestionOf> | null;
}

const dealRefs = async (db: SpaDb, ids: string[]): Promise<Map<string, string>> =>
  ids.length
    ? new Map(
        (
          await db
            .select({ id: deals.id, ref: deals.ref })
            .from(deals)
            .where(inArray(deals.id, [...new Set(ids)]))
        ).map((d) => [d.id, d.ref]),
      )
    : new Map();

export async function listCaseItems(ctx: SpaContext, viewer: Viewer, q: CasesQuery): Promise<Page<CaseItem>> {
  requireCompliance(viewer);
  const db = ctx.database.db;
  const cur = cursorOf(q.cursor);
  if (q.status === "edd") {
    const where: (SQL | undefined)[] = [eq(spaApprovals.gate, "edd_signoff"), eq(spaApprovals.status, "pending")];
    if (cur)
      where.push(sql`(${spaApprovals.createdAt}, ${spaApprovals.id}) > (${cur.at}::timestamptz, ${cur.id}::uuid)`);
    const rows = await db
      .select()
      .from(spaApprovals)
      .where(and(...where))
      .orderBy(asc(spaApprovals.createdAt), asc(spaApprovals.id))
      .limit(q.limit + 1);
    const p = paged(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }));
    const refs = await dealRefs(
      db,
      p.rows.map((r) => r.entityId),
    );
    const partyIds = p.rows.map((r) => r.proposal.partyId).filter((x): x is string => typeof x === "string");
    const names = partyIds.length
      ? new Map(
          (
            await db
              .select({ id: parties.id, name: parties.fullNameEn })
              .from(parties)
              .where(inArray(parties.id, partyIds))
          ).map((x) => [x.id, x.name]),
        )
      : new Map<string, string>();
    return {
      items: p.rows.map((r) => ({
        id: r.id,
        kind: "edd" as const,
        status: "edd" as const,
        dealId: r.entityId,
        dealRef: refs.get(r.entityId) ?? "",
        openedAt: r.createdAt,
        closedAt: null,
        rules: [],
        partyName: maskPiiText(names.get(String(r.proposal.partyId)) ?? "Party"),
        suggestion: null,
      })),
      nextCursor: p.nextCursor,
    };
  }
  const statuses =
    q.status === "closed"
      ? (["cleared", "stopped"] as const)
      : ([q.status] as ["open" | "info_requested" | "reported"]);
  const newestFirst = q.status === "closed" || q.status === "reported";
  const where: (SQL | undefined)[] = [inArray(amlCases.status, [...statuses])];
  if (cur)
    where.push(
      newestFirst
        ? sql`(${amlCases.openedAt}, ${amlCases.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`
        : sql`(${amlCases.openedAt}, ${amlCases.id}) > (${cur.at}::timestamptz, ${cur.id}::uuid)`,
    );
  const rows = await db
    .select()
    .from(amlCases)
    .where(and(...where))
    .orderBy(
      ...(newestFirst ? [desc(amlCases.openedAt), desc(amlCases.id)] : [asc(amlCases.openedAt), asc(amlCases.id)]),
    )
    .limit(q.limit + 1);
  const p = paged(rows, q.limit, (r) => ({ at: r.openedAt, id: r.id }));
  const refs = await dealRefs(
    db,
    p.rows.map((r) => r.dealId),
  );
  const hits = p.rows.length
    ? await db
        .select({ caseId: amlHits.caseId, rule: amlHits.rule })
        .from(amlHits)
        .where(
          inArray(
            amlHits.caseId,
            p.rows.map((r) => r.id),
          ),
        )
    : [];
  return {
    items: p.rows.map((r) => ({
      id: r.id,
      kind: "case" as const,
      status: r.status as CaseItem["status"],
      dealId: r.dealId,
      dealRef: refs.get(r.dealId) ?? "",
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      rules: [...new Set(hits.filter((h) => h.caseId === r.id).map((h) => h.rule))],
      partyName: null,
      suggestion: suggestionOf(r.summary, r.summaryModel, r.instructionLike, 200),
    })),
    nextCursor: p.nextCursor,
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** One case, or one EDD sign-off, with everything a compliance officer reads before deciding. */
export async function getCaseView(ctx: SpaContext, viewer: Viewer, id: string) {
  requireCompliance(viewer);
  const db = ctx.database.db;
  const [c] = await db.select().from(amlCases).where(eq(amlCases.id, id));
  const [edd] = c
    ? []
    : await db
        .select()
        .from(spaApprovals)
        .where(and(eq(spaApprovals.id, id), eq(spaApprovals.gate, "edd_signoff"), eq(spaApprovals.entityKind, "deal")));
  if (!c && !edd) throw notFound("case");
  const dealId = c ? c.dealId : edd!.entityId;
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw notFound("case");
  const rb = (ctx.rulebook ?? getSalesRulebook)(deal.rulesVersion);
  const threshold = rb ? rb.amlNameMatchThreshold : null;
  const thresholdPending = rb ? isPending(rb, "amlNameMatchThreshold") : true;

  const onDeal = await db
    .select({ id: parties.id, name: parties.fullNameEn, role: dealParties.role, order: dealParties.order })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(eq(dealParties.dealId, dealId))
    .orderBy(asc(dealParties.role), asc(dealParties.order));
  const latest = await latestScreenings(db, dealId);
  const hits = c
    ? await db.select().from(amlHits).where(eq(amlHits.caseId, c.id)).orderBy(asc(amlHits.createdAt), asc(amlHits.id))
    : [];
  const risks = await db
    .select()
    .from(riskAssessments)
    .where(eq(riskAssessments.dealId, dealId))
    .orderBy(desc(riskAssessments.createdAt), desc(riskAssessments.id));

  const subjectKeys = [
    ...onDeal.map((p) => `party:${p.id}`),
    ...[...latest.keys()].filter((k) => !onDeal.some((p) => k === `party:${p.id}` || k === p.id)),
  ];
  const subjects = subjectKeys.map((requested) => {
    const party = onDeal.find((p) => requested === `party:${p.id}`);
    const key = party ? ([`party:${party.id}`, party.id].find((k) => latest.has(k)) ?? requested) : requested;
    const s = latest.get(key);
    const label = party
      ? `${maskPiiText(party.name)} (${party.role})`
      : `Payer: ${maskPiiText(key.replace(/^payer:/, ""))}`;
    const matches = (s?.matches ?? {}) as { entries?: { list: string; entryId: string; score: number }[] };
    const check = (rule: "sanctions" | "pep", score: number | null) => ({
      rule,
      score: score === null ? null : round(score),
      threshold,
      thresholdPending,
      over: score !== null && threshold !== null && score >= threshold,
      list: s!.listVersion,
      date: toDubaiDate(s!.screenedAt),
    });
    const risk = party ? risks.find((r) => r.partyId === party.id) : undefined;
    return {
      subjectKey: key,
      partyId: party?.id ?? null,
      label,
      screening: s
        ? {
            id: s.id,
            trigger: s.trigger,
            listLabel: AML_LIST_LABEL,
            listVersion: s.listVersion,
            exact: s.exact,
            notScreened: s.sanctionsScore === null || s.pepScore === null,
            date: toDubaiDate(s.screenedAt),
            checks: [check("sanctions", s.sanctionsScore), check("pep", s.pepScore)],
            entries: (matches.entries ?? []).map((e) => ({ list: e.list, entryId: e.entryId, score: round(e.score) })),
          }
        : null,
      hits: hits
        .filter((h) => h.subjectKey === key || h.subjectKey === requested)
        .map((h) => ({
          rule: h.rule,
          severity: h.severity,
          detail: maskPiiText(h.detail),
          listVersion: h.listVersion,
        })),
      risk: risk
        ? {
            level: risk.level,
            points: risk.points,
            flagged: risk.flagged,
            policyVersion: risk.policyVersion,
            rulesVersion: risk.rulesVersion,
            breakdown: maskPii(Array.isArray(risk.detail.breakdown) ? risk.detail.breakdown : []),
            date: toDubaiDate(risk.createdAt),
          }
        : null,
    };
  });

  const reads = await db
    .select({
      id: documentReads.id,
      profile: documentReads.profile,
      fields: documentReads.fields,
      instructionFound: documentReads.instructionFound,
      readAt: documentReads.readAt,
      fileName: documents.fileName,
      partyId: documents.partyId,
    })
    .from(documentReads)
    .innerJoin(documents, eq(documents.id, documentReads.documentId))
    .where(and(eq(documents.dealId, dealId), inArray(documentReads.profile, ["sof_evidence", "edd"])))
    .orderBy(asc(documentReads.readAt), asc(documentReads.id));

  const approvalId = c ? c.approvalId : edd!.id;
  const approval = approvalId ? await getApproval(ctx, viewer, approvalId) : null;

  const events = await db
    .select()
    .from(dealEvents)
    .where(
      and(
        eq(dealEvents.entityKind, "deal"),
        eq(dealEvents.entityId, dealId),
        or(
          sql`${dealEvents.type} not in (${sql.join(
            [...STAFF_EVENTS].map((t) => sql`${t}`),
            sql`, `,
          )})`,
          approvalId ? sql`${dealEvents.payload}->>'approvalId' = ${approvalId}` : undefined,
        ),
      ),
    )
    .orderBy(asc(dealEvents.at), asc(dealEvents.id));
  const names = await userNames(
    db,
    events.map((e) => e.actor),
  );
  const trail = events.map((e) => viewEvent(e, viewer.role, names)).filter((e) => e !== null);

  return {
    label: AML_LIST_LABEL,
    case: {
      id,
      kind: c ? ("case" as const) : ("edd" as const),
      status: c ? c.status : ("edd" as const),
      openedAt: c ? c.openedAt : edd!.createdAt,
      closedAt: c ? c.closedAt : null,
    },
    dealId,
    dealRef: deal.ref,
    suggestion: c ? suggestionOf(c.summary, c.summaryModel, c.instructionLike) : null,
    subjects,
    sourceOfFunds: reads.map((r) => ({
      id: r.id,
      profile: r.profile,
      fileName: maskPiiText(r.fileName),
      partyName: maskPiiText(onDeal.find((p) => p.id === r.partyId)?.name ?? ""),
      fields: maskPii(r.fields),
      instructionFound: r.instructionFound,
      readAt: r.readAt,
    })),
    approval,
    trail,
  };
}
