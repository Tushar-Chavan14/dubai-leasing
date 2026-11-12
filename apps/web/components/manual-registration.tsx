"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import {
  type RegistrationActionState,
  recordRegistrationRejected,
} from "../app/(staff)/leases/[id]/registration-actions";
import { ActionForm } from "./ui/action-form";
import { buttonClass } from "./ui/button";
import { Banner, FIELD, INPUT, LABEL } from "./ui/form";

export interface ManualRegistration {
  mode: "online" | "manual";
  pack: {
    checklist: {
      key: string;
      label: string;
      status: "on_file" | "bring" | "not_asked";
      documentId?: string;
      attachments?: { documentId: string }[];
      answer?: string;
    }[];
    fee: { feeFils: number | null; paidBy: string };
    registration: { portalName: string; portalUrl: string | null; instructions: string; referenceExample: string };
  };
  submissions: { id: string; status: string }[];
}

function Result({ s }: { s: RegistrationActionState }) {
  if (!s.message) return null;
  return (
    <Banner tone={s.ok ? "good" : "bad"} role={s.ok ? "status" : "alert"}>
      {s.ok ? (
        <IconCheck size={16} className="mt-0.5 shrink-0" />
      ) : (
        <IconWarning size={16} className="mt-0.5 shrink-0" />
      )}
      {s.message}
    </Banner>
  );
}

/** What to do on the portal, what to bring, and the pack to print. */
export function ManualGuide({ leaseId, reg }: { leaseId: string; reg: ManualRegistration }) {
  const { portalName, portalUrl, instructions } = reg.pack.registration;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm">
        Register this tenancy by hand on{" "}
        {portalUrl ? (
          <a className="font-semibold underline" href={portalUrl} target="_blank" rel="noopener noreferrer">
            {portalName}
          </a>
        ) : (
          <span className="font-semibold">{portalName}</span>
        )}
        .
      </p>
      {instructions && <p className="m-0 whitespace-pre-line text-sm text-muted">{instructions}</p>}
      <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
        {reg.pack.checklist.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                c.status === "on_file" ? "border-line bg-accent text-on-accent" : "border-warning text-warning"
              }`}
            >
              {c.attachments?.length || c.answer !== undefined
                ? "In the pack"
                : c.status === "not_asked"
                  ? "Not asked by this company"
                  : c.status === "on_file"
                    ? "On file"
                    : "Bring yourself"}
            </span>
            {c.label}
          </li>
        ))}
      </ul>
      <div>
        <a
          className={buttonClass("ghost", "sm")}
          href={`/api/leases/${leaseId}/registration/pack`}
          target="_blank"
          rel="noreferrer"
        >
          Download registration pack (one PDF with the documents)
        </a>
      </div>
    </div>
  );
}

/** Record what the portal answered: the reference and certificate, or the rejection reasons. */
export function ManualRecordForms({
  leaseId,
  submissionId,
  reg,
  today,
}: {
  leaseId: string;
  submissionId: string;
  reg: ManualRegistration;
  today: string;
}) {
  const router = useRouter();
  const [rec, setRec] = useState<RegistrationActionState & { busy?: boolean }>({});
  const [rej, rejAction] = useActionState<RegistrationActionState, FormData>(recordRegistrationRejected, {});
  const feeFils = reg.pack.fee.feeFils;

  async function onRecord(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("certificate");
    if (file instanceof File && file.size === 0) data.delete("certificate");
    if (file instanceof File && file.size > 10 * 1024 * 1024) {
      setRec({ ok: false, message: "The certificate is larger than 10 MB." });
      return;
    }
    setRec({ busy: true });
    const res = await fetch(`/api/leases/${leaseId}/registration/record`, { method: "POST", body: data }).catch(
      () => null,
    );
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    if (!res || !res.ok) {
      setRec({ ok: false, message: body?.error ?? "The upload did not go through. Try again." });
      return;
    }
    setRec({ ok: true, message: "Registration recorded." });
    form.reset();
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={onRecord} className="grid gap-3 rounded-xl border border-line p-3.5">
        <b className="text-sm font-semibold">Record registration</b>
        <input type="hidden" name="submissionId" value={submissionId} />
        <label className={FIELD}>
          <span className={LABEL}>Reference from the portal</span>
          <input
            className={INPUT}
            name="reference"
            required
            maxLength={60}
            placeholder={reg.pack.registration.referenceExample}
          />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Issued on</span>
          <input className={INPUT} type="date" name="issuedOn" required max={today || undefined} />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Fee paid, AED (optional)</span>
          <input
            className={INPUT}
            name="feePaidAed"
            inputMode="decimal"
            defaultValue={feeFils === null ? "" : (feeFils / 100).toFixed(2)}
          />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Certificate, PDF up to 10 MB (optional)</span>
          <input className={INPUT} type="file" name="certificate" accept="application/pdf,.pdf" />
        </label>
        <div>
          <button type="submit" className={buttonClass("primary", "sm")} disabled={rec.busy}>
            {rec.busy ? "Recording…" : "Record registration"}
          </button>
        </div>
        <Result s={rec} />
      </form>
      <ActionForm
        state={{ error: rej.ok === false ? rej.message : undefined }}
        action={rejAction}
        className="grid gap-3 rounded-xl border border-line p-3.5"
      >
        <b className="text-sm font-semibold">Record rejection</b>
        <input type="hidden" name="leaseId" value={leaseId} />
        <input type="hidden" name="submissionId" value={submissionId} />
        <label className={FIELD}>
          <span className={LABEL}>Reasons the portal gave</span>
          <textarea className={INPUT} name="reasons" required maxLength={1000} rows={3} />
        </label>
        <div>
          <button type="submit" className={buttonClass("ghost", "sm")}>
            Record rejection
          </button>
        </div>
        <Result s={rej} />
      </ActionForm>
    </div>
  );
}
