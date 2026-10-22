"use client";

import { useActionState, useState } from "react";
import { IconCheck, IconWarning } from "../../../lib/icons";
import { checkPhotoFile, preparePhoto } from "../../../lib/images";
import { moveInAck, paymentReply, type PortalState, reportIssue } from "./actions";

function Done({ state, what }: { state: PortalState; what: string }) {
  return (
    <div className="alert" data-tone="good" role="status">
      <IconCheck size={16} />
      <span>
        {state.duplicate ? `We already have your ${what}.` : `Thank you, we've received your ${what}.`} Your reference
        is <b className="ref">{state.ref}</b>.
      </span>
    </div>
  );
}

function ErrorLine({ text }: { text?: string | undefined }) {
  return text ? (
    <div className="alert" data-tone="bad" role="alert">
      <IconWarning size={16} />
      {text}
    </div>
  ) : null;
}

/** Photos for a portal form: resized and re-encoded in the browser, uploaded on the link, ids kept as hidden inputs. */
function Photos({ token, kind, max, label }: { token: string; kind: string; max: number; label: string }) {
  const [shots, setShots] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  async function add(file: File) {
    const problem = checkPhotoFile(file);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new File([await preparePhoto(file)], "photo.jpg", { type: "image/jpeg" }));
    const res = await fetch(`/t/${token}/files`, { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    setBusy(false);
    if (!res.ok || !body.id) return setError(body.error ?? "The upload didn't work. Try again.");
    setShots((s) => [...s, { id: body.id!, name: file.name }]);
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {shots.map((s) => (
        <input key={s.id} type="hidden" name="photoId" value={s.id} />
      ))}
      {shots.length > 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {shots.length} photo(s) added.
        </p>
      )}
      {shots.length < max && (
        <label className="btn small" style={{ width: "fit-content" }}>
          {busy ? "Uploading…" : "Add a photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void add(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
      <ErrorLine text={error} />
    </div>
  );
}

export function MoveInAckForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(moveInAck, {});
  const [choice, setChoice] = useState("");
  if (state.ref) return <Done state={state} what="confirmation" />;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      <fieldset className="choice-list">
        <legend className="field-label">Is the report right?</legend>
        <label>
          <input type="radio" name="agree" value="yes" onChange={() => setChoice("yes")} /> Yes, it matches what I found
        </label>
        <label>
          <input type="radio" name="agree" value="no" onChange={() => setChoice("no")} /> No, something is different or
          missing
        </label>
      </fieldset>
      <label className="field">
        <span className="field-label">{choice === "no" ? "What is different?" : "Anything to add? (optional)"}</span>
        <textarea name="comment" rows={3} maxLength={2000} dir="auto" />
      </label>
      <Photos token={token} kind="tenant_condition_photo" max={20} label="Your own photos (optional)" />
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

const PAY_CHOICES = [
  { value: "paid", label: "I have paid", help: "Add a photo of the receipt or transfer if you have one." },
  { value: "will_pay", label: "I will pay by a date", help: "Tell us when." },
  { value: "dispute", label: "I dispute this payment", help: "Tell us why; a manager will contact you." },
  { value: "need_time", label: "I need more time", help: "Tell us what's happening; a manager will contact you." },
] as const;

export function PaymentReplyForm({
  token,
  paymentId,
  maxDate,
  today,
}: {
  token: string;
  paymentId: string;
  maxDate: string;
  today: string;
}) {
  const [state, action, pending] = useActionState<PortalState, FormData>(paymentReply, {});
  const [choice, setChoice] = useState("");
  if (state.ref) return <Done state={state} what="reply" />;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <ErrorLine text={state.error} />
      <fieldset className="choice-list">
        <legend className="field-label">Where do things stand?</legend>
        {PAY_CHOICES.map((c) => (
          <label key={c.value}>
            <input type="radio" name="choice" value={c.value} onChange={() => setChoice(c.value)} /> {c.label}
            <span className="muted" style={{ display: "block", fontSize: 13, marginLeft: 24 }}>
              {c.help}
            </span>
          </label>
        ))}
      </fieldset>
      {choice === "will_pay" && (
        <label className="field">
          <span className="field-label">I will pay by</span>
          <input type="date" name="payBy" min={today} max={maxDate} required />
        </label>
      )}
      <label className="field">
        <span className="field-label">Comment (optional)</span>
        <textarea name="comment" rows={3} maxLength={2000} dir="auto" />
      </label>
      {choice === "paid" && <Photos token={token} kind="payment_proof" max={3} label="Proof of payment (optional)" />}
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}

export function ReportIssueForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(reportIssue, {});
  if (state.ref) return <Done state={state} what="report" />;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      <label className="field">
        <span className="field-label">What's the problem?</span>
        <textarea name="description" rows={4} maxLength={2000} required dir="auto" />
      </label>
      <label className="field">
        <span className="field-label">Which room? (optional)</span>
        <input name="room" maxLength={60} />
      </label>
      <label>
        <input type="checkbox" name="atRisk" /> <b>Someone is at risk</b> (fire, smoke, gas, sparks, flooding, someone
        hurt). We'll treat it as urgent. In an emergency, call 999 first.
      </label>
      <Photos token={token} kind="issue_photo" max={5} label="Photos (optional)" />
      <button type="submit" className="btn primary" disabled={pending}>
        {pending ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}
