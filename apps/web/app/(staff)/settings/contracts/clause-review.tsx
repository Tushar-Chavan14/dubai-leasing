"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { LegalTag, needsLegalCheck } from "../../../../components/legal-tag";
import type { RuleResult } from "../../../../lib/portfolio";
import { readingLabel } from "../../../../lib/status-labels";
import type { CompanyClauseView, ContractRuleRow, RuleReview } from "../../../../lib/types";
import { decideClause, retrySample, toggleRuleClause } from "./actions";

/** The dashed "Upload sample contract" button for one rule row. */
export function UploadSample({ rule, label = "Upload sample contract" }: { rule: ContractRuleRow; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ busy: true });
    const res = await fetch(`/api/contract-rules/${rule.id}/sample`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: file,
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res || !res.ok) {
      setState({ error: body?.error ?? "The upload did not go through. Try again." });
    } else {
      setState({});
      router.refresh();
    }
    if (input.current) input.current.value = "";
  }
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button type="button" className="btn small dashed" disabled={state.busy} onClick={() => input.current?.click()}>
        {state.busy ? "Uploading…" : label}
      </button>
      {state.error && (
        <span className="err" role="alert" style={{ display: "block", marginTop: 4, whiteSpace: "normal" }}>
          {state.error}
        </span>
      )}
    </div>
  );
}

function ruleFields(rule: ContractRuleRow) {
  return {
    ruleId: rule.id,
    clauseIds: rule.clauseIds.join(","),
    category: rule.category,
    subtype: rule.subtype ?? "",
    tenures: rule.tenures.join(","),
    minCheques: String(rule.minCheques),
    maxCheques: String(rule.maxCheques),
    sampleDocumentId: rule.sampleDocumentId ?? "",
  };
}

function Hidden({ fields }: { fields: Record<string, string> }) {
  return Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
}

function Clause({ clause, rule, canEdit }: { clause: CompanyClauseView; rule: ContractRuleRow; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [state, act, pending] = useActionState<RuleResult, FormData>(decideClause, {});
  const [toggleState, toggle, toggling] = useActionState<RuleResult, FormData>(toggleRuleClause, {});
  const toggleForm = useRef<HTMLFormElement>(null);
  const added = rule.clauseIds.includes(clause.ref);
  const proposed = clause.status === "proposed";
  const needsBox = clause.hasValues || editing;
  return (
    <li className="clause" data-status={clause.status}>
      <div className="clause-head">
        <b>{clause.title}</b>
        {needsLegalCheck(clause.category) && <LegalTag />}
        {clause.hasValues && (
          <span className="status" data-tone="warn">
            Includes amounts or dates
          </span>
        )}
        {clause.status === "approved" && (
          <span className="status" data-tone="good">
            Approved
          </span>
        )}
        {clause.status === "rejected" && (
          <span className="status" data-tone="quiet">
            Rejected
          </span>
        )}
      </div>
      {editing ? (
        <form id={`edit-${clause.id}`} action={act} className="stack">
          <Hidden fields={{ id: clause.id, decision: "approve" }} />
          <label className="field">
            <span className="field-label">Clause text</span>
            <textarea name="editedText" rows={4} maxLength={1200} defaultValue={clause.text} required />
          </label>
        </form>
      ) : (
        <p className="clause-text">{clause.text}</p>
      )}
      {clause.quote && <p className="clause-quote muted">From the sample: &ldquo;{clause.quote}&rdquo;</p>}
      {canEdit && proposed && (
        <div className="stack" style={{ gap: 8 }}>
          {needsBox && (
            <label className="check-row">
              <input
                type="checkbox"
                name="confirmValues"
                form={editing ? `edit-${clause.id}` : `approve-${clause.id}`}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked the amounts and dates in this clause
            </label>
          )}
          <div className="btn-row">
            {editing ? (
              <>
                <button type="submit" form={`edit-${clause.id}`} className="btn small primary" disabled={pending}>
                  {pending ? "Saving…" : "Save and approve"}
                </button>
                <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <form id={`approve-${clause.id}`} action={act}>
                  <Hidden fields={{ id: clause.id, decision: "approve" }} />
                  <button
                    type="submit"
                    className="btn small primary"
                    disabled={pending || (clause.hasValues && !confirmed)}
                  >
                    Approve
                  </button>
                </form>
                <button type="button" className="btn small" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <form action={act}>
                  <Hidden fields={{ id: clause.id, decision: "reject" }} />
                  <button type="submit" className="btn small danger" disabled={pending}>
                    Reject
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
      {state.error && (
        <span className="err" role="alert" style={{ display: "block" }}>
          {state.error}
        </span>
      )}
      {canEdit && clause.status === "approved" && (
        <form ref={toggleForm} action={toggle}>
          <Hidden fields={ruleFields(rule)} />
          <input type="hidden" name="ref" value={clause.ref} />
          <label className="check-row">
            <input
              type="checkbox"
              name="on"
              defaultChecked={added}
              disabled={toggling}
              onChange={() => toggleForm.current?.requestSubmit()}
            />
            Add to this rule
          </label>
          {toggleState.error && (
            <span className="err" role="alert" style={{ display: "block" }}>
              {toggleState.error}
            </span>
          )}
        </form>
      )}
      {!canEdit && clause.status === "approved" && added && <p className="muted">Part of this rule.</p>}
    </li>
  );
}

/** What happened to the uploaded sample, and the clauses proposed from it, for one contract rule. */
export function ClauseReview({
  rule,
  review,
  canEdit,
  templateReady = false,
}: {
  rule: ContractRuleRow;
  review: RuleReview | undefined;
  canEdit: boolean;
  /** The company template read from the same sample exists: clause suggestions are then a secondary, optional job. */
  templateReady?: boolean;
}) {
  const router = useRouter();
  const sample = review?.sample ?? null;
  const reading = sample?.status === "queued";
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [reading, router]);

  const [retryState, retry, retrying] = useActionState<RuleResult, FormData>(retrySample, {});
  if (!sample) return null;
  const retryButton = canEdit && (sample.status === "failed" || sample.status === "needs_human") && (
    <form action={retry}>
      <input type="hidden" name="ruleId" value={rule.id} />
      <button type="submit" className="btn small" disabled={retrying}>
        {templateReady ? "Read clauses again" : "Try again"}
      </button>
      {retryState.error && (
        <span className="err" role="alert" style={{ display: "block" }}>
          {retryState.error}
        </span>
      )}
    </form>
  );
  const clauses = review?.clauses ?? [];
  return (
    <div className="clause-review stack" aria-live="polite">
      {reading && <p className="muted">{readingLabel(sample)}</p>}
      {sample.status === "failed" &&
        (templateReady ? (
          <p className="muted">
            Template ready. Clause suggestions couldn&rsquo;t be read (optional):{" "}
            {sample.reasons.join(" ") || "an unexpected error"}
          </p>
        ) : (
          <p className="err" role="alert">
            We couldn&rsquo;t read this file: {sample.reasons.join(" ") || "an unexpected error"}
          </p>
        ))}
      {sample.status === "needs_human" && <p className="muted">{sample.reasons.join(" ")}</p>}
      {retryButton}
      {sample.status === "done" && clauses.length === 0 && (
        <p className="muted">No clauses could be taken from this file.</p>
      )}
      {clauses.length > 0 && (
        <ul className="clause-list">
          {clauses.map((c) => (
            <Clause key={c.id} clause={c} rule={rule} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}
