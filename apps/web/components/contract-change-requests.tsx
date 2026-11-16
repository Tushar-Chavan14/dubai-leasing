import { CONTRACT_CLAUSES, type ChangeMark, type ContractClauseId, type DiffPart } from "@leasing/core";
import { PauseCircleIcon as IconPause, SparkleIcon as IconSparkle } from "@phosphor-icons/react/dist/ssr";
import { dateTime } from "../lib/format";
import { ChangeMarksButton } from "./change-marks-modal";
import { ChangeRequestActions } from "./contract-change-forms";
import { legacyMarks } from "../lib/change-marks";
import { NOTE_TEXT, TENANT_TEXT } from "./ui/record";

export interface ChangeRequestRow {
  id: string;
  ref: string;
  contractId: string;
  version: number;
  role: "tenant" | "landlord";
  target: string;
  text: string;
  status: "open" | "analysed" | "reissued" | "declined" | "withdrawn" | "superseded";
  analysis: {
    kind: string;
    summary: string;
    analysis: string;
    risks: string[];
    proposal: { clauses: string[]; freeText: string | null } | null;
    blocked: string | null;
    diff: DiffPart[];
  } | null;
  /** Marked text from the signing page; null for requests made before marks. */
  marks?: ChangeMark[] | null;
  newContractId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

const STATUS: Record<ChangeRequestRow["status"], string> = {
  open: "AI is drafting",
  analysed: "Ready for review",
  reissued: "Re-issued",
  declined: "Declined",
  withdrawn: "Withdrawn",
  superseded: "Closed (version replaced)",
};

const KIND: Record<string, string> = {
  clause_wording: "Clause wording",
  remove_clause: "Remove a clause",
  add_term: "Add a term",
  money_or_dates: "Money or dates",
  question: "Question",
  other: "Other",
};

function targetLabel(target: string, companyClauses: { ref: string; title: string }[]): string {
  if (target === "other") return "Something else";
  if (target === "free_text") return "Additional terms";
  const std = CONTRACT_CLAUSES[target as ContractClauseId];
  if (std) return `Clause: ${std.title}`;
  return `Clause: ${companyClauses.find((c) => c.ref === target)?.title ?? "company clause"}`;
}

/** The old addendum against the drafted one, word by word (built by code from the AI's draft). */
function Diff({ parts }: { parts: DiffPart[] }) {
  return (
    <div
      aria-label="Proposed change to the addendum"
      className="whitespace-pre-wrap rounded-xl border border-line bg-page px-3.5 py-3 text-sm leading-relaxed"
    >
      {parts.map((p, i) =>
        p.op === "same" ? (
          <span key={i}>{p.text}</span>
        ) : p.op === "del" ? (
          <del key={i} className="rounded bg-danger/10 text-danger decoration-danger/60">
            {p.text}
          </del>
        ) : (
          <ins key={i} className="rounded bg-primary/10 text-ink no-underline">
            {p.text}
          </ins>
        ),
      )}
    </div>
  );
}

/**
 * D67: change requests from the signing pages. Open ones lead the contract panel (signing is paused) with the AI's
 * analysis, the diff and the officer's actions; closed ones follow as history.
 */
export function ContractChangeRequests({
  leaseId,
  rows,
  canAct,
  companyClauses,
}: {
  leaseId: string;
  rows: ChangeRequestRow[];
  canAct: boolean;
  companyClauses: { ref: string; title: string; text: string }[];
}) {
  if (!rows.length) return null;
  const open = rows.filter((r) => r.status === "open" || r.status === "analysed");
  const closed = rows.filter((r) => !open.includes(r));
  return (
    <section aria-label="Change requests" className="grid gap-3">
      {open.length > 0 && (
        <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
          <IconPause size={16} className="shrink-0" />
          Signing is paused: {open.length === 1 ? "a change was" : `${open.length} changes were`} requested
        </p>
      )}
      {open.map((r) => (
        <article key={r.id} className="grid gap-3 rounded-xl border border-line p-3.5">
          <header className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">
              {r.role === "tenant" ? "Tenant" : "Landlord"} · {targetLabel(r.target, companyClauses)}
            </span>
            <span className="text-xs text-muted">
              <span className="font-mono">{r.ref}</span> · version {r.version} · {dateTime(r.createdAt)} ·{" "}
              {STATUS[r.status]}
            </span>
          </header>
          <p className={TENANT_TEXT}>{r.text}</p>
          {r.analysis ? (
            <div className="grid gap-2.5">
              <p className="m-0 flex items-start gap-2 text-sm">
                <IconSparkle size={15} className="mt-0.5 shrink-0" />
                <span>
                  <b className="font-semibold">{KIND[r.analysis.kind] ?? r.analysis.kind}.</b> {r.analysis.summary}
                </span>
              </p>
              <p className="m-0 text-sm text-muted">{r.analysis.analysis}</p>
              {r.analysis.risks.length > 0 && (
                <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
                  {r.analysis.risks.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
              {r.analysis.diff.length > 0 && <Diff parts={r.analysis.diff} />}
              {r.analysis.blocked && <p className={NOTE_TEXT}>{r.analysis.blocked}</p>}
              <p className={NOTE_TEXT}>
                Written by the leasing agent from the signer&apos;s words. Code checked that the draft adds no amount,
                date or period and uses only approved clauses. A re-issued contract still needs the final contract
                approval.
              </p>
            </div>
          ) : (
            <p className={NOTE_TEXT}>The leasing agent is drafting the change. This page updates when it is ready.</p>
          )}
          {canAct && r.status === "analysed" && (r.marks?.length || r.analysis) ? (
            <div>
              <ChangeMarksButton
                leaseId={leaseId}
                requestId={r.id}
                refCode={r.ref}
                marks={r.marks?.length ? r.marks : legacyMarks(r, targetLabel(r.target, companyClauses))}
                legacy={!r.marks?.length}
                legacyDiff={r.analysis?.diff ?? null}
              />
            </div>
          ) : null}
          {canAct && !r.marks?.length && (
            <ChangeRequestActions
              leaseId={leaseId}
              requestId={r.id}
              proposal={r.analysis?.proposal ?? null}
              companyClauses={companyClauses}
            />
          )}
        </article>
      ))}
      {closed.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Earlier change requests ({closed.length})</summary>
          <ul className="m-0 mt-2 grid list-none gap-2 p-0">
            {closed.map((r) => (
              <li key={r.id} className="grid gap-1 rounded-xl border border-line px-3.5 py-2.5">
                <span className="text-xs text-muted">
                  <span className="font-mono">{r.ref}</span> · {r.role} · version {r.version} · {STATUS[r.status]}
                  {r.decidedAt ? ` ${dateTime(r.decidedAt)}` : ""}
                </span>
                <p className={TENANT_TEXT}>{r.text}</p>
                {r.decisionNote && <p className={NOTE_TEXT}>{r.decisionNote}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
