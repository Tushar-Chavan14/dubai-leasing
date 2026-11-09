"use client";

import { ActionForm } from "../../../../components/ui/action-form";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { RuleResult } from "../../../../lib/portfolio";
import { readingLabel } from "../../../../lib/status-labels";
import type { ContractRuleRow, RuleReview } from "../../../../lib/types";
import { retrySample } from "./actions";
import { BTN } from "../../../../components/ui/settings";

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
      <button
        type="button"
        className={`${BTN.ghost} !border-dashed`}
        disabled={state.busy}
        onClick={() => input.current?.click()}
      >
        {state.busy ? "Uploading…" : label}
      </button>
      {state.error && (
        <span className="mt-1 block text-xs text-danger" role="alert">
          {state.error}
        </span>
      )}
    </div>
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
    <ActionForm state={retryState} action={retry}>
      <input type="hidden" name="ruleId" value={rule.id} />
      <button type="submit" className={BTN.ghost} disabled={retrying}>
        {templateReady ? "Read clauses again" : "Try again"}
      </button>
      {retryState.error && (
        <span className="block text-xs text-danger" role="alert">
          {retryState.error}
        </span>
      )}
    </ActionForm>
  );
  const clauses = review?.clauses ?? [];
  return (
    <div className="grid gap-3 pb-2" aria-live="polite">
      {reading && <p className="m-0 text-muted">{readingLabel(sample)}</p>}
      {sample.status === "failed" &&
        (templateReady ? (
          <p className="m-0 text-muted">
            Template ready. Clause suggestions couldn&rsquo;t be read (optional):{" "}
            {sample.reasons.join(" ") || "an unexpected error"}
          </p>
        ) : (
          <p className="text-xs text-danger" role="alert">
            We couldn&rsquo;t read this file: {sample.reasons.join(" ") || "an unexpected error"}
          </p>
        ))}
      {sample.status === "needs_human" && <p className="m-0 text-muted">{sample.reasons.join(" ")}</p>}
      {retryButton}
      {sample.status === "done" && clauses.length === 0 && (
        <p className="m-0 text-muted">No clauses could be taken from this file.</p>
      )}
      {clauses.some((c) => c.status === "proposed") && (
        <p className="m-0 text-muted">
          {clauses.filter((c) => c.status === "proposed").length} clauses read from this sample are waiting in{" "}
          <a className="text-ink! underline" href="#sample-review">
            Review the sample
          </a>{" "}
          below.
        </p>
      )}
    </div>
  );
}
