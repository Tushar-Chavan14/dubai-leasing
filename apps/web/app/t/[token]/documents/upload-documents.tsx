"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { IconCheck, IconTrash, IconUpload, IconWarning } from "../../../../lib/icons";
import { checkPhotoFile, preparePhoto } from "../../../../lib/images";
import { type PortalState, submitDocuments } from "../actions";

type Side = "front" | "back" | "page";
interface Slot {
  key: string;
  kind: string;
  side: Side;
  label: string;
  hint: string;
  required: boolean;
}

/** One field of the company's document form (D46), as the engine sends it. */
export interface FormFieldView {
  key: string;
  label: string;
  placeholder: string;
  help: string;
  type: "text" | "email" | "phone" | "date" | "number" | "select" | "document";
  required: boolean;
  appliesTo: "individual" | "company" | "both";
  options: string[];
  documentKind?: "emirates_id_front" | "emirates_id_back" | "passport" | "visa" | "trade_licence" | "custom" | "other";
}
export interface DocumentFormView {
  version: number;
  applicantKind: "individual" | "company";
  fields: FormFieldView[];
}

const DOC_KIND: Record<NonNullable<FormFieldView["documentKind"]>, { kind: string; side: Side } | null> = {
  emirates_id_front: { kind: "emirates_id", side: "front" },
  emirates_id_back: { kind: "emirates_id", side: "back" },
  passport: { kind: "passport", side: "page" },
  visa: { kind: "visa", side: "page" },
  trade_licence: { kind: "trade_licence", side: "page" },
  custom: null,
  other: null,
};

const INPUT_TYPE = { text: "text", email: "email", phone: "tel", date: "date", number: "number" } as const;

const keyOf = (s: { kind: string; side: string | null }) => `${s.kind}:${s.side}`;

interface Doc {
  id: string;
  kind: string;
  side: string | null;
  bytes: number | null;
}

export function UploadDocuments({ token, initial, form }: { token: string; initial: Doc[]; form: DocumentFormView }) {
  const router = useRouter();
  // Who is renting decides which fields apply ("Shown to" on the company's form); the applicant can change it.
  const [applicantKind, setApplicantKind] = useState<"individual" | "company">(form.applicantKind);
  const fields = form.fields.filter((f) => f.appliesTo === "both" || f.appliesTo === applicantKind);
  const slots: Slot[] = fields
    .filter((f) => f.type === "document" && f.documentKind)
    .map((f) => {
      const known = DOC_KIND[f.documentKind!];
      return {
        key: f.key,
        kind: known?.kind ?? `other:${f.key}`,
        side: known?.side ?? "page",
        label: f.label,
        hint: f.help,
        required: f.required,
      };
    });
  const answerFields = fields.filter((f) => f.type !== "document");
  const [docs, setDocs] = useState<Doc[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, submit, sending] = useActionState<PortalState, FormData>(submitDocuments, {});
  const docFor = (s: Slot) => docs.find((d) => keyOf(d) === keyOf(s));
  // At least one ID document (an `other:` upload alone can't be checked).
  const complete =
    slots.every((s) => !s.required || docFor(s)) && slots.some((s) => !s.kind.startsWith("other:") && docFor(s));

  async function upload(slot: Slot, file: File) {
    const k = keyOf(slot);
    const problem = checkPhotoFile(file);
    if (problem) return setErrors((e) => ({ ...e, [k]: problem }));
    setBusy(k);
    setErrors((e) => ({ ...e, [k]: "" }));
    try {
      const old = docFor(slot);
      const blob = await preparePhoto(file);
      const form = new FormData();
      form.set("file", new File([blob], `${slot.kind}-${slot.side}.jpg`, { type: "image/jpeg" }));
      form.set("kind", slot.kind);
      form.set("side", slot.side);
      const res = await fetch(`/t/${token}/documents/upload`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as Doc & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Upload failed (${res.status})`);
      if (old && old.id !== body.id) await fetch(`/t/${token}/documents/upload?doc=${old.id}`, { method: "DELETE" });
      setDocs((d) => [
        ...d.filter((x) => keyOf(x) !== k),
        { id: body.id, kind: slot.kind, side: slot.side, bytes: body.bytes },
      ]);
    } catch (e) {
      setErrors((x) => ({ ...x, [k]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(slot: Slot) {
    const d = docFor(slot);
    if (!d) return;
    const res = await fetch(`/t/${token}/documents/upload?doc=${d.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) setDocs((x) => x.filter((y) => y.id !== d.id));
  }

  if (state.ref) {
    return (
      <section className="panel panel-pad stack" role="status">
        <p className="row-done" style={{ margin: 0 }}>
          <IconCheck size={16} /> Thank you, your documents are being checked. Reference{" "}
          <span className="ref">{state.ref}</span>.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          We&apos;ll email you as soon as the check is done.
        </p>
        <button
          type="button"
          className="btn small"
          onClick={() => router.push(`/t/${token}`)}
          style={{ alignSelf: "start" }}
        >
          View your application
        </button>
      </section>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <fieldset className="panel panel-pad renting-as">
        <legend className="field-label">You are renting as</legend>
        <label className="check-row">
          <input
            type="radio"
            name="renting-as"
            checked={applicantKind === "individual"}
            onChange={() => setApplicantKind("individual")}
          />
          Myself (an individual)
        </label>
        <label className="check-row">
          <input
            type="radio"
            name="renting-as"
            checked={applicantKind === "company"}
            onChange={() => setApplicantKind("company")}
          />
          A company (I sign for it)
        </label>
      </fieldset>
      <ul className="doc-slots">
        {slots.map((slot) => {
          const k = keyOf(slot);
          const d = docFor(slot);
          return (
            <li key={k} className="panel panel-pad" data-done={!!d}>
              <div className="doc-slot-head">
                <div>
                  <b>
                    {slot.label}
                    {!slot.required && <em className="muted"> (optional)</em>}
                  </b>
                  {slot.hint && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      {slot.hint}
                    </div>
                  )}
                </div>
                {d && (
                  <span className="row-done" style={{ fontSize: 13 }}>
                    <IconCheck size={14} /> Uploaded{d.bytes ? `, ${Math.round(d.bytes / 1024)} KB` : ""}
                  </span>
                )}
              </div>
              <div className="btn-row">
                <label className={`btn small ${d ? "" : "primary"}`} aria-disabled={busy === k}>
                  <IconUpload size={15} />
                  {busy === k ? "Uploading…" : d ? "Replace photo" : "Take or choose photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="sr-only"
                    disabled={busy !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void upload(slot, f);
                    }}
                  />
                </label>
                {d && (
                  <button
                    type="button"
                    className="btn small ghost"
                    onClick={() => void remove(slot)}
                    disabled={busy !== null}
                  >
                    <IconTrash size={15} /> Remove
                  </button>
                )}
              </div>
              {errors[k] && (
                <p className="alert" data-tone="bad" role="alert" style={{ marginTop: 10 }}>
                  <IconWarning size={15} /> {errors[k]}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <form action={submit} className="stack">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="formVersion" value={form.version} />
        <input type="hidden" name="applicantKind" value={applicantKind} />
        {answerFields.length > 0 && (
          <div className="panel panel-pad grid-fields">
            {answerFields.map((f) => (
              <label key={f.key} className="field span-6">
                <span className="field-label">
                  {f.label}
                  {!f.required && <em> (optional)</em>}
                </span>
                {f.type === "select" ? (
                  <select name={`answer:${f.key}`} required={f.required} defaultValue="">
                    <option value="" disabled>
                      {f.placeholder || "Choose…"}
                    </option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    name={`answer:${f.key}`}
                    type={f.type === "document" ? "text" : INPUT_TYPE[f.type]}
                    placeholder={f.placeholder}
                    required={f.required}
                    maxLength={500}
                  />
                )}
                {f.help && <span className="hint">{f.help}</span>}
              </label>
            ))}
          </div>
        )}
        {/* Only uploads for fields that apply to who is renting (a switch hides the others). */}
        {docs
          .filter((d) => slots.some((s) => keyOf(s) === keyOf(d)))
          .map((d) => (
            <input key={d.id} type="hidden" name="documentId" value={d.id} />
          ))}
        {state.error && (
          <p className="alert" data-tone="bad" role="alert">
            <IconWarning size={15} /> {state.error}
          </p>
        )}
        <div>
          <button type="submit" className="btn primary" disabled={!complete || sending || busy !== null}>
            {sending ? "Sending…" : "Send for checking"}
          </button>
        </div>
        {!complete && (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Upload the required photos above (at least one document) to continue.
          </p>
        )}
      </form>
    </div>
  );
}
