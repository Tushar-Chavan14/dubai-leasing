"use client";

import { useActionState, useState } from "react";
import { openDispute, resolveDispute, type TenancyActionState } from "../app/(staff)/leases/[id]/tenancy-actions";
import { Result } from "./tenancy-panels";

/**
 * Step 11 (person-led): export the case pack, open or resolve a dispute (leasing manager), and
 * review a copilot case summary draft. Nothing here files anything with the RDC.
 */
export function CasePanel({
  leaseId,
  state,
  role,
  summary,
}: {
  leaseId: string;
  state: string;
  role: string;
  summary: { subject: string | null; body: string } | null;
}) {
  const leasing = role === "leasing_officer" || role === "leasing_manager";
  const manager = role === "leasing_manager";
  const [openState, open, opening] = useActionState<TenancyActionState, FormData>(openDispute, {});
  const [resState, resolve, resolving] = useActionState<TenancyActionState, FormData>(resolveDispute, {});
  const [text, setText] = useState(summary?.body ?? "");
  if (!leasing) return null;
  const canOpen = manager && ["ACTIVE", "RENEWAL", "MOVE_OUT"].includes(state);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "case-summary.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="panel" aria-labelledby="case-h" id="case">
      <div className="panel-head">
        <h2 id="case-h">Dispute case</h2>
        <span className="hint">Person-led; the product gathers the evidence</span>
      </div>
      <div className="panel-pad stack">
        <a className="btn small" style={{ width: "fit-content" }} href={`/api/leases/${leaseId}/case-pack`}>
          Export case pack (zip)
        </a>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Timeline with rules versions, documents, photos, emails with delivery evidence, payments and the tenant&apos;s
          submissions. ID images are listed by hash only. Each export is recorded.
        </p>
        {summary && (
          <div className="stack">
            <label className="field">
              <span className="field-label">{summary.subject ?? "Case summary"} (copilot draft: check every fact)</span>
              <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn small" onClick={() => void navigator.clipboard.writeText(text)}>
                Copy
              </button>
              <button type="button" className="btn small" onClick={download}>
                Download .txt
              </button>
            </div>
          </div>
        )}
        {canOpen && (
          <form action={open} className="stack">
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className="field">
              <span className="field-label">Open a dispute: what is it about?</span>
              <textarea name="reason" rows={2} minLength={5} maxLength={2000} required />
            </label>
            <button type="submit" className="btn small" disabled={opening} style={{ width: "fit-content" }}>
              Open dispute
            </button>
          </form>
        )}
        {manager && state === "DISPUTE" && (
          <form action={resolve} className="stack">
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className="field">
              <span className="field-label">Outcome</span>
              <select name="outcome" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                <option value="active">Tenancy continues</option>
                <option value="move_out">Tenant leaves (move-out)</option>
                <option value="closed">Closed (deposit settled, Ejari cancelled)</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Note (decision or settlement reference)</span>
              <textarea name="note" rows={2} minLength={5} maxLength={2000} required />
            </label>
            <button type="submit" className="btn small" disabled={resolving} style={{ width: "fit-content" }}>
              Resolve dispute
            </button>
          </form>
        )}
        <Result s={openState} />
        <Result s={resState} />
      </div>
    </section>
  );
}
