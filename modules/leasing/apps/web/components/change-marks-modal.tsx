"use client";

import { type ChangeMark, type DiffPart, wordDiff } from "@leasing/core";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveMarks,
  declineChange,
  reissueChange,
  type LeaseActionState,
  writeMarkWording,
} from "../app/(staff)/leases/[id]/actions";
import {
  canApprove,
  defaultDecisions,
  diffSides,
  type MarkDecisions,
  markStatus,
  needsManager,
  OWN_CHANGE_HINT,
  STATUS_PILL,
  termRows,
} from "../lib/change-marks";
import { buttonClass } from "@platform/ui/button";
import { FIELD, INPUT, LABEL } from "@platform/ui/form";
import { Modal } from "@platform/ui/modal";
import { NOTE_TEXT } from "@platform/ui/record";
import { TENANT_TEXT } from "./ui/tenant-text";

function Side({ title, parts, tone }: { title: string; parts: DiffPart[]; tone: "now" | "ai" }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 text-sm ${tone === "now" ? "bg-danger/5" : "bg-primary/5"}`}>
      <div className={`${LABEL} mb-1`}>{title}</div>
      <p className="m-0 whitespace-pre-wrap leading-relaxed">
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
      </p>
    </div>
  );
}

function MarkCard({
  mark,
  leaseId,
  requestId,
  decision,
  keepReason,
  legacyDiff,
  onDecide,
  onKeepReason,
  onRewritten,
}: {
  mark: ChangeMark;
  leaseId: string;
  requestId: string;
  decision: "apply" | "keep" | undefined;
  keepReason: string;
  legacyDiff: DiffPart[] | null;
  onDecide: (d: "apply" | "keep" | undefined) => void;
  onKeepReason: (s: string) => void;
  onRewritten: (m: ChangeMark) => void;
}) {
  const status = markStatus(mark);
  const [own, setOwn] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const parts =
    mark.rewrite && mark.rewrite.target !== "terms"
      ? (legacyDiff ?? wordDiff(mark.rewrite.before, mark.rewrite.after))
      : null;
  const sides = parts ? diffSides(parts) : null;
  const terms = termRows(mark.rewrite);
  const managerNeeded = needsManager(mark.rewrite);

  const submitOwn = () =>
    start(async () => {
      setErr(null);
      const r = await writeMarkWording(leaseId, requestId, mark.n, text);
      if ("error" in r) {
        setErr([r.error, ...r.reasons].join(" "));
        return;
      }
      onRewritten({ ...mark, rewrite: r.rewrite, problems: r.problems, decision: null });
      onDecide(r.rewrite && r.problems.length === 0 ? "apply" : undefined);
      if (r.rewrite && r.problems.length === 0) setOwn(false);
    });

  return (
    <section
      aria-label={`Mark ${mark.n}`}
      className={`grid gap-2.5 rounded-xl border p-3.5 ${status === "broken" ? "border-danger/60" : "border-line"}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <b className="font-semibold">
          {mark.n} · {mark.anchor.kind === "unknown" ? "Unknown place" : mark.anchor.label}
        </b>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status === "passed" ? "bg-primary/10 text-ink" : "bg-danger/10 text-danger"}`}
        >
          {STATUS_PILL[status]}
        </span>
      </header>
      {mark.quote && (
        <blockquote className="m-0 border-l-2 border-line pl-3 text-sm text-muted">{mark.quote}</blockquote>
      )}
      <div>
        <span className={NOTE_TEXT}>Tenant wrote:</span>
        <p className={`${TENANT_TEXT} mt-0.5`}>{mark.note}</p>
      </div>
      {terms.length > 0 && (
        <div className="grid gap-1.5">
          <table className="w-full border-collapse text-sm" aria-label={`Lease terms changed by mark ${mark.n}`}>
            <tbody>
              {terms.map((r) => (
                <tr key={r.label} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1 pr-3 text-left font-semibold">
                    {r.label}
                  </th>
                  <td className="py-1 pr-2 text-muted">{r.from}</td>
                  <td className="py-1 pr-2" aria-hidden="true">
                    →
                  </td>
                  <td className="py-1 font-semibold">{r.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {managerNeeded && (
            <>
              <span className="w-fit rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
                Needs manager approval
              </span>
              <ul className="m-0 grid list-disc gap-1 py-1 pl-6 text-sm">
                {mark.rewrite!.terms!.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {sides && terms.length === 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Side title="Now" parts={sides.now} tone="now" />
          <Side title="Contract AI" parts={sides.ai} tone="ai" />
        </div>
      )}
      {mark.rewrite && mark.rewrite.summary && <p className={NOTE_TEXT}>{mark.rewrite.summary}</p>}
      {mark.problems.length > 0 && (
        <ul className="m-0 grid list-disc gap-1 rounded-lg bg-danger/5 py-2 pl-7 pr-3 text-sm">
          {mark.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {status === "passed" && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Decision for mark ${mark.n}`}>
          <button
            type="button"
            className={buttonClass(decision === "apply" ? "primary" : "ghost", "sm")}
            aria-pressed={decision === "apply"}
            onClick={() => onDecide("apply")}
          >
            Use this change
          </button>
          <button
            type="button"
            className={buttonClass(decision === "keep" ? "primary" : "ghost", "sm")}
            aria-pressed={decision === "keep"}
            onClick={() => onDecide("keep")}
          >
            Keep as it is
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} aria-expanded={own} onClick={() => setOwn(!own)}>
            Write my own change
          </button>
        </div>
      )}
      {status === "broken" && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Decision for mark ${mark.n}`}>
          <button
            type="button"
            className={buttonClass(decision === "keep" ? "primary" : "ghost", "sm")}
            aria-pressed={decision === "keep"}
            onClick={() => {
              onDecide("keep");
              setOwn(false);
            }}
          >
            Keep as it is
          </button>
          <button type="button" className={buttonClass("ghost", "sm")} aria-expanded={own} onClick={() => setOwn(!own)}>
            Write my own change
          </button>
        </div>
      )}
      {decision === "keep" && (
        <label className={FIELD}>
          <span className={LABEL}>Why it stays as it is (the tenant is told)</span>
          <textarea
            className={INPUT}
            rows={2}
            maxLength={500}
            value={keepReason}
            onChange={(e) => onKeepReason(e.target.value)}
          />
        </label>
      )}
      {own && (
        <div className="grid gap-2">
          <label className={FIELD}>
            <span className={LABEL}>What should the clause say? The contract AI words it and code checks it.</span>
            <span className={NOTE_TEXT}>{OWN_CHANGE_HINT}</span>
            <textarea
              className={INPUT}
              rows={3}
              minLength={3}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {err && (
            <p role="alert" className="m-0 text-sm text-danger">
              {err}
            </p>
          )}
          <div>
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={pending || text.trim().length < 3}
              onClick={submitOwn}
            >
              {pending ? "Checking…" : "Check my change"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Officer review of a change request: one card per mark, then Preview, Approve changes or Decline all.
 * A request stored before marks arrives as one mark (`legacy`) and is approved through the D67 reissue route.
 */
export function ChangeMarksButton({
  leaseId,
  requestId,
  refCode,
  marks: initial,
  legacy,
  legacyDiff,
  count,
}: {
  leaseId: string;
  requestId: string;
  refCode: string;
  marks: ChangeMark[];
  legacy: boolean;
  legacyDiff: DiffPart[] | null;
  count?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState(initial);
  const [decisions, setDecisions] = useState<MarkDecisions>(() => ({}));
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<LeaseActionState | null>(null);
  const [pending, start] = useTransition();
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  void count;

  const ready = canApprove(marks, decisions);
  const doneOk = !!result?.ok;

  const decide = (n: number, d: "apply" | "keep" | undefined) => setDecisions((p) => ({ ...p, [n]: d }));
  const finish = (r: LeaseActionState) => {
    setResult(r);
    if (r.ok) router.refresh();
  };

  const preview = async () => {
    setPreviewErr(null);
    const win = window.open("", "_blank");
    const res = await fetch(
      `/documents/leases/${encodeURIComponent(leaseId)}/change-preview/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisions }),
      },
    );
    if (!res.ok) {
      win?.close();
      const b = (await res.json().catch(() => null)) as { error?: string; reasons?: string[] } | null;
      setPreviewErr([b?.error ?? `Preview failed (${res.status})`, ...(b?.reasons ?? [])].join(" "));
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url;
    else window.open(url, "_blank");
  };

  const approve = () =>
    start(async () => {
      if (legacy) {
        const fd = new FormData();
        fd.set("leaseId", leaseId);
        fd.set("requestId", requestId);
        if (marks.some((m) => decisions[m.n] === "apply")) {
          finish(await reissueChange({}, fd));
          return;
        }
        // "Keep as it is": the contract stays, so the request is declined (D67) with the reason as the note.
        const why = marks
          .map((m) => reasons[m.n]?.trim())
          .filter(Boolean)
          .join(" ");
        fd.set("note", `We kept the contract as it is. ${why}`.trim().slice(0, 1000));
        finish(await declineChange({}, fd));
        return;
      }
      finish(await approveMarks(leaseId, requestId, decisions as Record<number, "apply" | "keep">, reasons));
    });

  const decline = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("leaseId", leaseId);
      fd.set("requestId", requestId);
      fd.set("note", note);
      finish(await declineChange({}, fd));
    });

  return (
    <>
      <button
        type="button"
        className={buttonClass("primary", "sm")}
        onClick={() => {
          setOpen(true);
          if (Object.keys(decisions).length === 0) setDecisions(defaultDecisions(marks));
        }}
      >
        Review changes
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Change request ${refCode}`}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="grid gap-0.5">
            <b className="text-base font-semibold">Change request · {refCode}</b>
            <span className={NOTE_TEXT}>
              {marks.length} {marks.length === 1 ? "mark" : "marks"} · signing is paused
            </span>
          </div>
          <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        <div className="grid gap-3 overflow-y-auto px-5 py-4">
          {marks.map((m) => (
            <MarkCard
              key={m.n}
              mark={m}
              leaseId={leaseId}
              requestId={requestId}
              decision={decisions[m.n]}
              keepReason={reasons[m.n] ?? ""}
              legacyDiff={legacy ? legacyDiff : null}
              onDecide={(d) => decide(m.n, d)}
              onKeepReason={(s) => setReasons((p) => ({ ...p, [m.n]: s }))}
              onRewritten={(nm) => setMarks((p) => p.map((x) => (x.n === nm.n ? nm : x)))}
            />
          ))}
        </div>
        <div className="grid gap-2.5 border-t border-line px-5 py-4">
          {result?.ok && (
            <p role="status" className="m-0 text-sm font-semibold">
              {result.ok}
            </p>
          )}
          {(result?.error || previewErr) && (
            <div role="alert" className="text-sm text-danger">
              <strong>{result?.error ?? previewErr}</strong>
              {result?.reasons?.length ? (
                <ul className="m-0 mt-1 list-disc pl-5">
                  {result.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {declining && !doneOk && (
            <label className={FIELD}>
              <span className={LABEL}>Note to the tenant (emailed with a fresh signing link)</span>
              <textarea
                className={INPUT}
                rows={3}
                minLength={5}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          {!doneOk && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {declining ? (
                <button
                  type="button"
                  className={buttonClass("danger", "sm")}
                  disabled={pending || note.trim().length < 5}
                  onClick={decline}
                >
                  {pending ? "Declining…" : "Decline all"}
                </button>
              ) : (
                <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setDeclining(true)}>
                  Decline all
                </button>
              )}
              {!legacy && (
                <button type="button" className={buttonClass("ghost", "sm")} disabled={!ready} onClick={preview}>
                  Preview
                </button>
              )}
              <button
                type="button"
                className={buttonClass("primary", "sm")}
                disabled={!ready || pending}
                onClick={approve}
              >
                {pending ? "Working…" : "Approve changes"}
              </button>
            </div>
          )}
          <p className={`${NOTE_TEXT} text-right`}>
            The new version still goes to the final contract approval before signing links go out.
          </p>
        </div>
      </Modal>
    </>
  );
}
