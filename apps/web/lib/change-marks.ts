import { type ChangeMark, type DiffPart, formatAed, type MarkRewrite } from "@leasing/core";

export type MarkDecision = "apply" | "keep";
/** Keyed by mark number. */
export type MarkDecisions = Record<number, MarkDecision | undefined>;

export type MarkStatus = "passed" | "broken";

/** A mark's pill: the rewrite exists and every check passed, or it breaks a rule (no rewrite or problems listed). */
export function markStatus(m: Pick<ChangeMark, "rewrite" | "problems">): MarkStatus {
  return m.rewrite && m.problems.length === 0 ? "passed" : "broken";
}

export const STATUS_PILL: Record<MarkStatus, string> = { passed: "Checks passed", broken: "Breaks a rule" };

/** Approve is allowed only when every mark has a decision and every "apply" mark has a passing rewrite. */
export function canApprove(marks: Pick<ChangeMark, "n" | "rewrite" | "problems">[], decisions: MarkDecisions): boolean {
  if (marks.length === 0) return false;
  return marks.every((m) => {
    const d = decisions[m.n];
    if (d === "keep") return true;
    return d === "apply" && markStatus(m) === "passed";
  });
}

/** Decisions with every passing mark applied (the officer can change any of them). */
export function defaultDecisions(marks: Pick<ChangeMark, "n" | "rewrite" | "problems">[]): MarkDecisions {
  const out: MarkDecisions = {};
  for (const m of marks) if (markStatus(m) === "passed") out[m.n] = "apply";
  return out;
}

/** The body parts shown on each side: "Now" keeps same + del, "Contract AI" keeps same + add. */
export function diffSides(parts: DiffPart[]): { now: DiffPart[]; ai: DiffPart[] } {
  return {
    now: parts.filter((p) => p.op !== "add"),
    ai: parts.filter((p) => p.op !== "del"),
  };
}

interface LegacyRequest {
  text: string;
  target: string;
  analysis: {
    proposal: { clauses: string[]; freeText: string | null } | null;
    blocked: string | null;
    summary: string;
    diff: DiffPart[];
  } | null;
}

/** A request stored before marks: one mark, no quote, the old target as its label, the D67 draft as its rewrite. */
export function legacyMarks(r: LegacyRequest, label: string): ChangeMark[] {
  const draft = r.analysis?.proposal ?? null;
  const rewrite: ChangeMark["rewrite"] = draft
    ? {
        target: "free_text",
        key: "free_text",
        before: r
          .analysis!.diff.filter((p) => p.op !== "add")
          .map((p) => p.text)
          .join(""),
        after: r
          .analysis!.diff.filter((p) => p.op !== "del")
          .map((p) => p.text)
          .join(""),
        summary: r.analysis!.summary,
        author: "ai",
      }
    : null;
  return [
    {
      n: 1,
      page: 1,
      quote: "",
      note: r.text,
      anchor: { kind: "fixed", label },
      rewrite,
      problems: rewrite ? [] : [r.analysis?.blocked ?? "The agent has not drafted a change."],
      decision: null,
      keepReason: null,
      officerNote: null,
    },
  ];
}

export interface TermRow {
  label: string;
  from: string;
  to: string;
}

/** D72: the rows of a term change ("Rent  AED 135,000 → AED 140,000"), only for values that change. */
export function termRows(rewrite: { terms?: MarkRewrite["terms"] } | null): TermRow[] {
  const t = rewrite?.terms;
  if (!t) return [];
  const rows: TermRow[] = [];
  const money = (label: string, a?: number, b?: number) => {
    if (b !== undefined) rows.push({ label, from: a === undefined ? "—" : formatAed(a), to: formatAed(b) });
  };
  money("Rent", t.from.annualRentFils, t.to.annualRentFils);
  money("Deposit", t.from.depositFils, t.to.depositFils);
  if (t.to.cheques !== undefined)
    rows.push({ label: "Cheques", from: String(t.from.cheques ?? "—"), to: String(t.to.cheques) });
  if (t.to.moveInOn !== undefined) rows.push({ label: "Move-in", from: t.from.moveInOn ?? "—", to: t.to.moveInOn });
  if (t.to.startOn !== undefined) rows.push({ label: "Start", from: t.from.startOn ?? "—", to: t.to.startOn });
  return rows;
}

/** D72: a term change outside the offer limits needs a leasing manager before it takes effect. */
export function needsManager(rewrite: { terms?: MarkRewrite["terms"] } | null): boolean {
  return (rewrite?.terms?.problems.length ?? 0) > 0;
}

export const OWN_CHANGE_HINT =
  "Write exactly what to change. Amounts and dates update the lease; the law's notice periods can't be changed.";
