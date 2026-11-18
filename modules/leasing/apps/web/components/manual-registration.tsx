"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { CheckIcon as IconCheck, WarningIcon as IconWarning } from "@phosphor-icons/react";
import {
  type RegistrationActionState,
  recordRegistrationRejected,
} from "../app/(staff)/leases/[id]/registration-actions";
import { ActionForm } from "@platform/ui/action-form";
import { buttonClass } from "@platform/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";

interface CertificateCheck {
  field: string;
  label: string;
  onCertificate: string | null;
  onRecord: string | null;
  result: "match" | "differs" | "not_found";
}
type Reading =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "unreadable" }
  | { state: "done"; checks: CertificateCheck[]; modelFailed: boolean };

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

/** What reading the picked certificate found; the officer still checks and submits. */
function CertificateReading({ r }: { r: Reading }) {
  if (r.state === "idle") return null;
  if (r.state === "reading") return <p className="m-0 text-sm text-muted">Reading the certificate…</p>;
  if (r.state === "unreadable")
    return <p className="m-0 text-sm text-muted">We couldn&apos;t read this certificate; type the details.</p>;
  return (
    <div className="grid gap-1.5 text-sm">
      {r.modelFailed && (
        <p className="m-0 text-warning">We couldn&apos;t read the reference; type it from the certificate.</p>
      )}
      <p className="m-0 text-muted">Filled in from the certificate. Check the details below before recording.</p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {r.checks.map((c) => (
          <li
            key={c.field}
            className={`flex items-start gap-2 ${c.result === "differs" ? "text-warning" : "text-muted"}`}
          >
            {c.result === "differs" ? (
              <IconWarning size={16} className="mt-0.5 shrink-0" />
            ) : c.result === "match" ? (
              <IconCheck size={16} className="mt-0.5 shrink-0" />
            ) : (
              <span className="inline-block w-4 shrink-0 text-center">-</span>
            )}
            <span>
              {c.label}:{" "}
              {c.result === "match"
                ? "matches the record"
                : c.result === "differs"
                  ? `certificate says ${c.onCertificate}, record says ${c.onRecord}`
                  : "not found on the certificate"}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
  const [reference, setReference] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const feeDefault = feeFils === null ? "" : (feeFils / 100).toFixed(2);
  const [fee, setFee] = useState(feeDefault);
  /** Fields the last certificate read filled in (shown as "from the certificate" until edited). */
  const [filledFrom, setFilledFrom] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<Reading>({ state: "idle" });
  // Only the newest pick may fill the form: an older, slower read is ignored.
  const readId = useRef(0);

  /** Reads the picked certificate to prefill the form. Nothing is stored; the officer still submits. */
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    const id = ++readId.current;
    if (!file || file.size > 10 * 1024 * 1024) {
      setReading({ state: "idle" });
      return;
    }
    setReading({ state: "reading" });
    const data = new FormData();
    data.set("certificate", file);
    const res = await fetch(`/api/leases/${leaseId}/registration/read-certificate`, {
      method: "POST",
      body: data,
    }).catch(() => null);
    if (id !== readId.current) return;
    const body = (await res?.json().catch(() => null)) as {
      status?: string;
      reference?: string | null;
      issuedOn?: string | null;
      checks?: CertificateCheck[];
      modelFailed?: boolean;
      feePaidFils?: number | null;
    } | null;
    if (!res?.ok || body?.status !== "ok") {
      setReading({ state: "unreadable" });
      return;
    }
    const got = new Set<string>();
    if (body.reference) {
      setReference(body.reference);
      got.add("reference");
    }
    if (body.issuedOn) {
      setIssuedOn(body.issuedOn);
      got.add("issuedOn");
    }
    if (typeof body.feePaidFils === "number") {
      setFee((body.feePaidFils / 100).toFixed(2));
      got.add("fee");
    }
    setFilledFrom(got);
    setReading({ state: "done", checks: body.checks ?? [], modelFailed: body.modelFailed === true });
  }

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
    setReference("");
    setIssuedOn("");
    setFee(feeDefault);
    setFilledFrom(new Set());
    setReading({ state: "idle" });
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={onRecord} className="grid gap-3 rounded-xl border border-line p-3.5">
        <b className="text-sm font-semibold">Record registration</b>
        <input type="hidden" name="submissionId" value={submissionId} />
        <label className={`${FIELD} rounded-lg border border-dashed border-line p-3`}>
          <span className={LABEL}>Upload the certificate (PDF, up to 10 MB)</span>
          <span className="text-[13px] text-muted">
            We read it and fill in the reference, the issue date and the fee for you, then check it against the lease.
            You can still type the details yourself.
          </span>
          <input className={INPUT} type="file" name="certificate" accept="application/pdf,.pdf" onChange={onPick} />
        </label>
        <CertificateReading r={reading} />
        <label className={FIELD}>
          <span className={LABEL}>
            Reference from the portal
            {filledFrom.has("reference") && <span className="font-normal text-muted"> · from the certificate</span>}
          </span>
          <input
            className={INPUT}
            name="reference"
            required
            maxLength={60}
            value={reference}
            onChange={(e) => {
              setReference(e.target.value);
              setFilledFrom((f) => new Set([...f].filter((x) => x !== "reference")));
            }}
            placeholder={reg.pack.registration.referenceExample}
          />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>
            Issued on
            {filledFrom.has("issuedOn") && <span className="font-normal text-muted"> · from the certificate</span>}
          </span>
          <input
            className={INPUT}
            type="date"
            name="issuedOn"
            required
            max={today || undefined}
            value={issuedOn}
            onChange={(e) => {
              setIssuedOn(e.target.value);
              setFilledFrom((f) => new Set([...f].filter((x) => x !== "issuedOn")));
            }}
          />
        </label>
        <label className={FIELD}>
          <span className={LABEL}>
            Fee paid, AED (optional)
            {filledFrom.has("fee") && <span className="font-normal text-muted"> · from the certificate</span>}
          </span>
          <input
            className={INPUT}
            name="feePaidAed"
            inputMode="decimal"
            value={fee}
            onChange={(e) => {
              setFee(e.target.value);
              setFilledFrom((f) => new Set([...f].filter((x) => x !== "fee")));
            }}
          />
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
