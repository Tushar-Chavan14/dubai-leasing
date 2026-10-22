"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { IconCheck, IconTrash, IconUpload, IconWarning } from "../../../../lib/icons";
import { checkPhotoFile, preparePhoto } from "../../../../lib/images";
import { type PortalState, submitDocuments } from "../actions";

type Kind = "emirates_id" | "passport" | "visa" | "trade_licence";
type Side = "front" | "back" | "page";
interface Slot {
  kind: Kind;
  side: Side;
  label: string;
  hint: string;
}
const SETS: { key: string; label: string; slots: Slot[] }[] = [
  {
    key: "eid",
    label: "Emirates ID",
    slots: [
      { kind: "emirates_id", side: "front", label: "Emirates ID, front", hint: "The side with your photo" },
      { kind: "emirates_id", side: "back", label: "Emirates ID, back", hint: "The side with the card number" },
    ],
  },
  {
    key: "passport",
    label: "Passport and visa",
    slots: [
      {
        kind: "passport",
        side: "page",
        label: "Passport data page",
        hint: "Include the two lines of letters at the bottom",
      },
      { kind: "visa", side: "page", label: "Residence visa", hint: "The visa page or e-visa" },
    ],
  },
  {
    key: "company",
    label: "Company",
    slots: [
      { kind: "trade_licence", side: "page", label: "Trade licence", hint: "The current licence page" },
      { kind: "emirates_id", side: "front", label: "Signatory's Emirates ID, front", hint: "The person signing" },
      { kind: "emirates_id", side: "back", label: "Signatory's Emirates ID, back", hint: "" },
    ],
  },
];

const keyOf = (s: { kind: string; side: string | null }) => `${s.kind}:${s.side}`;

interface Doc {
  id: string;
  kind: string;
  side: string | null;
  bytes: number | null;
}

export function UploadDocuments({ token, initial }: { token: string; initial: Doc[] }) {
  const router = useRouter();
  const [set, setSet] = useState(
    initial.some((d) => d.kind === "trade_licence")
      ? "company"
      : initial.some((d) => d.kind === "passport")
        ? "passport"
        : "eid",
  );
  const [docs, setDocs] = useState<Doc[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, submit, sending] = useActionState<PortalState, FormData>(submitDocuments, {});
  const slots = SETS.find((s) => s.key === set)!.slots;
  const docFor = (s: Slot) => docs.find((d) => keyOf(d) === keyOf(s));
  const complete = slots.every((s) => docFor(s));

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
      <fieldset className="segmented" aria-label="Which documents do you have?">
        {SETS.map((s) => (
          <label key={s.key}>
            <input type="radio" name="set" value={s.key} checked={set === s.key} onChange={() => setSet(s.key)} />
            <span>{s.label}</span>
          </label>
        ))}
      </fieldset>

      <ul className="doc-slots">
        {slots.map((slot) => {
          const k = keyOf(slot);
          const d = docFor(slot);
          return (
            <li key={k} className="panel panel-pad" data-done={!!d}>
              <div className="doc-slot-head">
                <div>
                  <b>{slot.label}</b>
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
        {docs.map((d) => (
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
            Upload every photo above to continue.
          </p>
        )}
      </form>
    </div>
  );
}
