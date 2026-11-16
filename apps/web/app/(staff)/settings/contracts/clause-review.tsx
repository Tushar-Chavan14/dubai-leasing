"use client";

import { ActionForm } from "../../../../components/ui/action-form";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import type { RuleResult } from "../../../../lib/portfolio";
import { readingLabel } from "../../../../lib/status-labels";
import type { CompanyRow, SampleReview } from "../../../../lib/types";
import { retrySample } from "./actions";
import { BTN, CHECK_ROW } from "../../../../components/ui/settings";
import { type Emirate, EMIRATE_LABELS } from "@leasing/core";

/**
 * Upload a sample contract (D68, D69). `new`: a new named template (the name is asked here) for the emirates ticked
 * (none = any emirate); it never retires another template. `version`: a new version of one named template, which
 * replaces that template's approved version when approved. Rules then pick an approved template.
 */
export function UploadSample({
  company,
  target,
}: {
  company: CompanyRow;
  target: { kind: "new" } | { kind: "version"; familyId: string; emirates: Emirate[]; replaces: number | null };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const isNew = target.kind === "new";
  const [picked, setPicked] = useState<Emirate[]>(
    target.kind === "version" ? [...target.emirates] : company.emirates.length === 1 ? [...company.emirates] : [],
  );
  const [name, setName] = useState("");
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ busy: true });
    const q = new URLSearchParams();
    if (picked.length) q.set("emirates", picked.join(","));
    if (target.kind === "version") q.set("familyId", target.familyId);
    else q.set("name", name.trim());
    const res = await fetch(`/api/companies/${company.id}/sample?${q.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: file,
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string; familyId?: string | null } | undefined;
    if (!res || !res.ok) {
      setState({ error: body?.error ?? "The upload did not go through. Try again." });
    } else {
      setState({});
      const family = target.kind === "version" ? target.familyId : body?.familyId;
      if (family) router.push(`/settings/contract-templates?company=${company.id}&template=${family}`);
      router.refresh();
    }
    if (input.current) input.current.value = "";
  }
  const toggle = (e: Emirate, on: boolean) => setPicked((p) => (on ? [...p, e] : p.filter((x) => x !== e)));
  const nameMissing = isNew && name.trim() === "";
  return (
    <div className="grid gap-3">
      {isNew && (
        <label className="grid max-w-md gap-1 text-[13px] text-muted">
          Template name
          <input
            type="text"
            value={name}
            maxLength={80}
            placeholder="For example: Commercial lease"
            onChange={(e) => setName(e.target.value)}
            className="h-9 rounded-md border border-line bg-page px-2.5 text-sm text-ink"
          />
        </label>
      )}
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="p-0 text-[13px] text-muted">
          {picked.length ? "For these emirates:" : "For any emirate (tick to limit it):"}
        </legend>
        <div className={CHECK_ROW}>
          {company.emirates.map((e) => (
            <label key={e}>
              <input type="checkbox" checked={picked.includes(e)} onChange={(ev) => toggle(e, ev.target.checked)} />
              {EMIRATE_LABELS[e]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className={isNew ? BTN.primary : `${BTN.ghost} !border-dashed`}
          disabled={state.busy || nameMissing}
          onClick={() => input.current?.click()}
        >
          {state.busy ? "Uploading…" : isNew ? "Choose sample PDF and create" : "Upload new version"}
        </button>
        <span className="text-[12.5px] text-muted">
          {isNew
            ? "A sample contract (PDF, up to 10 MB). Other templates are not changed."
            : target.replaces !== null
              ? `When you approve it, it replaces version ${target.replaces} of this template; its rules move to it.`
              : "When you approve it, rules can use it."}
        </span>
        {state.error && (
          <span className="mt-1 block text-xs text-danger" role="alert">
            {state.error}
          </span>
        )}
      </div>
    </div>
  );
}

/** What happened to the company's latest uploaded sample, and the clauses proposed from it. */
export function ClauseReview({
  companyId,
  review,
  canEdit,
  templateReady = false,
}: {
  companyId: string;
  review: SampleReview | null | undefined;
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
      <input type="hidden" name="companyId" value={companyId} />
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
            Review the new version
          </a>{" "}
          below.
        </p>
      )}
    </div>
  );
}
