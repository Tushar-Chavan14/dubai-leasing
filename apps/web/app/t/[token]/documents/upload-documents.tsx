"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import {
  CheckCircleIcon as IconCheck,
  FileArrowUpIcon as IconFile,
  TrashIcon as IconTrash,
  UploadSimpleIcon as IconUpload,
  WarningIcon as IconWarning,
} from "@phosphor-icons/react";
import { Banner } from "../../../../components/ui/form";
import {
  Choice,
  Cta,
  Done,
  FORM,
  Note,
  P_INPUT,
  PAGE,
  PField,
  PFieldset,
  PRIMARY,
  SMALL_GHOST,
} from "../../../../components/ui/portal";
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
      <Done
        title="Thank you, your documents are being checked"
        action={
          <button type="button" className={SMALL_GHOST} onClick={() => router.push(`/t/${token}`)}>
            View your application
          </button>
        }
      >
        <p className="m-0">
          Reference <span className="font-mono text-[13px]">{state.ref}</span>.
        </p>
        <p className="m-0">We&apos;ll email you as soon as the check is done.</p>
      </Done>
    );
  }

  return (
    <div className={PAGE}>
      <PFieldset legend="You are renting as">
        <div className="grid grid-cols-2 gap-2">
          <Choice
            name="renting-as"
            title="Myself (an individual)"
            checked={applicantKind === "individual"}
            onChange={() => setApplicantKind("individual")}
          />
          <Choice
            name="renting-as"
            title="A company (I sign for it)"
            checked={applicantKind === "company"}
            onChange={() => setApplicantKind("company")}
          />
        </div>
      </PFieldset>
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Documents">
        {slots.map((slot) => {
          const k = keyOf(slot);
          const d = docFor(slot);
          return (
            <li key={k} data-done={!!d} className="grid gap-2">
              <div
                className={`grid gap-3 rounded-xl border px-3.5 py-3 ${d ? "border-transparent bg-accent text-on-accent" : "border-line bg-page text-ink"}`}
              >
                <div className="flex items-start gap-3">
                  {d ? (
                    <IconCheck size={22} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
                  ) : (
                    <IconFile size={22} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  )}
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <b className="text-[15px] font-semibold">
                      {slot.label}
                      {!slot.required && <span className="font-normal opacity-70"> (optional)</span>}
                    </b>
                    {slot.hint && <span className="text-[13px] opacity-75">{slot.hint}</span>}
                    <span className="text-[13px] font-medium">
                      {d
                        ? `Uploaded${d.bytes ? `, ${Math.round(d.bytes / 1024)} KB` : ""}`
                        : busy === k
                          ? "Uploading…"
                          : slot.required
                            ? "Needed"
                            : "Not added"}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <label
                    aria-disabled={busy !== null}
                    className={`${d ? "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-current px-4 text-sm font-semibold" : "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary"} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
                  >
                    <IconUpload size={16} aria-hidden />
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
                      className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-transparent bg-transparent px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
                      onClick={() => void remove(slot)}
                      disabled={busy !== null}
                    >
                      <IconTrash size={16} aria-hidden /> Remove
                    </button>
                  )}
                </div>
              </div>
              {errors[k] && (
                <Banner tone="bad" role="alert">
                  <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{errors[k]}</span>
                </Banner>
              )}
            </li>
          );
        })}
      </ul>

      <form action={submit} className={FORM}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="formVersion" value={form.version} />
        <input type="hidden" name="applicantKind" value={applicantKind} />
        {answerFields.length > 0 && (
          <div className="grid gap-3.5 rounded-card border border-line bg-raised p-4">
            {answerFields.map((f) => (
              <PField key={f.key} label={f.label} optional={!f.required} hint={f.help}>
                {f.type === "select" ? (
                  <select name={`answer:${f.key}`} required={f.required} defaultValue="" className={P_INPUT}>
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
                    autoComplete={f.type === "email" ? "email" : f.type === "phone" ? "tel" : "off"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    placeholder={f.placeholder}
                    required={f.required}
                    maxLength={500}
                    className={P_INPUT}
                  />
                )}
              </PField>
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
          <Banner tone="bad" role="alert">
            <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </Banner>
        )}
        {!complete && <Note>Upload the required photos above (at least one document) to continue.</Note>}
        <Cta>
          <button type="submit" className={PRIMARY} disabled={!complete || sending || busy !== null}>
            {sending ? "Sending…" : "Send for checking"}
          </button>
        </Cta>
      </form>
    </div>
  );
}
