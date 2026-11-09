"use client";

import { useActionState, useState } from "react";
import { openDispute, resolveDispute, type TenancyActionState } from "../app/(staff)/leases/[id]/tenancy-actions";
import { buttonClass } from "./ui/button";
import { FIELD, LABEL } from "./ui/form";
import { Section } from "./ui/record";
import { Result } from "./ui/result";
import { SET_SELECT, SET_TEXTAREA } from "./ui/settings";
import { FORM_ROW, NOTE } from "./ui/tenancy";

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
    <div id="case">
      <Section id="case-h" title="Dispute case" hint="Person-led; the product gathers the evidence">
        <div>
          <a className={buttonClass("ghost", "sm")} href={`/api/leases/${leaseId}/case-pack`}>
            Export case pack (zip)
          </a>
        </div>
        <p className={NOTE}>
          Timeline with rules versions, documents, photos, emails with delivery evidence, payments and the tenant&apos;s
          submissions. ID images are listed by hash only. Each export is recorded.
        </p>
        {summary && (
          <div className="grid gap-2">
            <label className={FIELD}>
              <span className={LABEL}>{summary.subject ?? "Case summary"} (copilot draft: check every fact)</span>
              <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className={SET_TEXTAREA} />
            </label>
            <div className={FORM_ROW}>
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() => void navigator.clipboard.writeText(text)}
              >
                Copy
              </button>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={download}>
                Download .txt
              </button>
            </div>
          </div>
        )}
        {canOpen && (
          <form action={open} className="grid gap-3 rounded-xl border border-line p-3.5">
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className={FIELD}>
              <span className={LABEL}>Open a dispute: what is it about?</span>
              <textarea name="reason" rows={2} minLength={5} maxLength={2000} required className={SET_TEXTAREA} />
            </label>
            <div>
              <button type="submit" className={buttonClass("ghost", "sm")} disabled={opening}>
                Open dispute
              </button>
            </div>
          </form>
        )}
        {manager && state === "DISPUTE" && (
          <form action={resolve} className="grid gap-3 rounded-xl border border-line p-3.5">
            <input type="hidden" name="leaseId" value={leaseId} />
            <label className={FIELD}>
              <span className={LABEL}>Outcome</span>
              <select name="outcome" required defaultValue="" className={SET_SELECT}>
                <option value="" disabled>
                  Choose…
                </option>
                <option value="active">Tenancy continues</option>
                <option value="move_out">Tenant leaves (move-out)</option>
                <option value="closed">Closed (deposit settled, Ejari cancelled)</option>
              </select>
            </label>
            <label className={FIELD}>
              <span className={LABEL}>Note (decision or settlement reference)</span>
              <textarea name="note" rows={2} minLength={5} maxLength={2000} required className={SET_TEXTAREA} />
            </label>
            <div>
              <button type="submit" className={buttonClass("ghost", "sm")} disabled={resolving}>
                Resolve dispute
              </button>
            </div>
          </form>
        )}
        <Result s={openState} />
        <Result s={resState} />
      </Section>
    </div>
  );
}
