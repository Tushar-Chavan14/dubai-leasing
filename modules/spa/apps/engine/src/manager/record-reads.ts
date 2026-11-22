import { toDubaiDate } from "@platform/kernel/dates";
import { maskPiiText } from "@platform/kernel/pii";
import {
  agreements,
  bankLetters,
  documentReads,
  documents,
  nocRecords,
  parties,
  payments,
  riskAssessments,
  spaTemplates,
  spaTemplateVersions,
} from "@spa/db";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { amlCasesView } from "./aml-screening.ts";
import type { SpaContext } from "./context.ts";

/**
 * The reads the deal record sections need that no route had (C39, S71). No role check here: the section's `visibleTo`
 * is the rule. Nothing here writes, and nothing carries a file name, storage key, hash, mime type or size.
 */

export type DocumentReadState = "read" | "not_read";

/**
 * A deal's current documents as a person reads them: what it is, whose it is (masked), the day it came in and whether
 * the reader has been through it. `confirmed` is true only when a person entered or confirmed a value from it (a NOC, a
 * bank letter, a payment); a read alone is not a confirmation.
 */
export async function documentsView(ctx: SpaContext, dealId: string) {
  const db = ctx.database.db;
  const rows = await db
    .select({
      id: documents.id,
      kind: documents.kind,
      uploadedAt: documents.uploadedAt,
      supersedesId: documents.supersedesId,
      partyName: parties.fullNameEn,
    })
    .from(documents)
    .leftJoin(parties, eq(parties.id, documents.partyId))
    .where(eq(documents.dealId, dealId))
    .orderBy(asc(documents.uploadedAt), asc(documents.id));
  const replaced = new Set(rows.map((r) => r.supersedesId).filter((x): x is string => !!x));
  const current = rows.filter((r) => !replaced.has(r.id));
  if (!current.length) return [];
  const ids = current.map((r) => r.id);
  const read = new Set(
    (
      await db
        .select({ id: documentReads.documentId })
        .from(documentReads)
        .where(inArray(documentReads.documentId, ids))
    ).map((r) => r.id),
  );
  const confirmed = new Set<string>();
  for (const r of await db
    .select({ id: nocRecords.documentId })
    .from(nocRecords)
    .where(and(eq(nocRecords.dealId, dealId), ne(nocRecords.status, "superseded"), eq(nocRecords.source, "manual"))))
    confirmed.add(r.id);
  for (const r of await db
    .select({ id: bankLetters.documentId })
    .from(bankLetters)
    .where(and(eq(bankLetters.dealId, dealId), eq(bankLetters.status, "current"), isNotNull(bankLetters.confirmedBy))))
    confirmed.add(r.id);
  for (const r of await db
    .select({ id: payments.documentId })
    .from(payments)
    .where(and(eq(payments.dealId, dealId), isNotNull(payments.confirmedBy))))
    confirmed.add(r.id);
  return current.map((r) => ({
    kind: r.kind,
    partyName: r.partyName === null ? null : maskPiiText(r.partyName),
    uploadedOn: toDubaiDate(r.uploadedAt) as string,
    readState: (read.has(r.id) ? "read" : "not_read") as DocumentReadState,
    confirmed: confirmed.has(r.id),
  }));
}

/** The latest agreement: its version and status, the template it was made from and when it was prepared. */
export async function agreementView(ctx: SpaContext, dealId: string) {
  const [a] = await ctx.database.db
    .select({
      kind: agreements.kind,
      version: agreements.version,
      status: agreements.status,
      preparedAt: agreements.preparedAt,
      templateName: spaTemplates.name,
      templateVersion: spaTemplateVersions.version,
    })
    .from(agreements)
    .innerJoin(spaTemplateVersions, eq(spaTemplateVersions.id, agreements.templateVersionId))
    .innerJoin(spaTemplates, eq(spaTemplates.id, spaTemplateVersions.templateId))
    .where(eq(agreements.dealId, dealId))
    .orderBy(desc(agreements.version))
    .limit(1);
  if (!a) return null;
  return {
    kind: a.kind,
    version: a.version,
    status: a.status,
    templateName: maskPiiText(a.templateName),
    templateVersion: a.templateVersion,
    preparedOn: toDubaiDate(a.preparedAt) as string,
  };
}

const LEVELS = ["low", "medium", "high"] as const;

/** Compliance roles only (the section's rule): the cases with their status, the highest current risk level and the count. */
export async function amlSummary(ctx: SpaContext, dealId: string) {
  const view = await amlCasesView(ctx, dealId);
  const rows = await ctx.database.db
    .select({ partyId: riskAssessments.partyId, level: riskAssessments.level })
    .from(riskAssessments)
    .where(eq(riskAssessments.dealId, dealId))
    .orderBy(desc(riskAssessments.createdAt), desc(riskAssessments.id));
  const latest = new Map<string, (typeof LEVELS)[number]>();
  for (const r of rows) if (!latest.has(r.partyId)) latest.set(r.partyId, r.level);
  const top = Math.max(-1, ...[...latest.values()].map((l) => LEVELS.indexOf(l)));
  return {
    caseCount: view.cases.length,
    riskLevel: top < 0 ? null : LEVELS[top]!,
    cases: view.cases.map((c) => ({ id: c.id, status: c.status, openedOn: toDubaiDate(c.openedAt) as string })),
  };
}
