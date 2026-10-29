import { type CompanyClauseRef, type CompanyClauseText, companyClauseIdOf, isCompanyClauseRef } from "@leasing/core";
import { companyClauses, type Tx } from "@leasing/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { unprocessable } from "../errors.ts";

/** Approved clauses of a company, for contract forms and rules. */
export async function approvedClauses(tx: Pick<Tx, "db">, companyId: string) {
  return tx.db
    .select()
    .from(companyClauses)
    .where(and(eq(companyClauses.companyId, companyId), eq(companyClauses.status, "approved")))
    .orderBy(asc(companyClauses.createdAt), asc(companyClauses.id));
}

/**
 * Every `cc:` id must be an approved clause of this company, or the request is refused (422).
 * Returns the wording as approved, in the order given.
 */
export async function resolveCompanyClauses(
  tx: Pick<Tx, "db">,
  companyId: string,
  ids: readonly string[],
): Promise<CompanyClauseText[]> {
  const refs = ids.filter((i): i is CompanyClauseRef => isCompanyClauseRef(i));
  if (!refs.length) return [];
  const uuids = [...new Set(refs.map(companyClauseIdOf))];
  const rows = await tx.db.select().from(companyClauses).where(inArray(companyClauses.id, uuids));
  const ok = new Map(rows.filter((r) => r.companyId === companyId && r.status === "approved").map((r) => [r.id, r]));
  const bad = uuids.filter((u) => !ok.has(u));
  if (bad.length) {
    throw unprocessable(
      "Only approved clauses of this company can be used.",
      bad.map((b) => `cc:${b}`),
      "bad_clause",
    );
  }
  return [...new Set(uuids)].map((u) => ({
    id: u,
    title: ok.get(u)!.title,
    text: ok.get(u)!.textEn,
    category: ok.get(u)!.category,
  }));
}
