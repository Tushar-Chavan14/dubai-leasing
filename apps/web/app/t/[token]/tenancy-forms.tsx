"use client";

import { ActionForm } from "../../../components/ui/action-form";
import { useActionState, useState } from "react";
import {
  CheckCircleIcon as IconCheck,
  TrashIcon as IconTrash,
  UploadSimpleIcon as IconUpload,
  WarningIcon as IconWarning,
} from "@phosphor-icons/react";
import { Banner } from "../../../components/ui/form";
import {
  Choice,
  Cta,
  Done as DonePanel,
  FORM,
  Note,
  P_INPUT,
  PField,
  PFieldset,
  PRIMARY,
} from "../../../components/ui/portal";
import { checkPhotoFile, preparePhoto } from "../../../lib/images";
import {
  bookInspection,
  depositResponse,
  giveNotice,
  moveInAck,
  paymentReply,
  type PortalState,
  reportIssue,
} from "./actions";

function Done({ state, what }: { state: PortalState; what: string }) {
  return (
    <DonePanel title={state.duplicate ? `We already have your ${what}` : `Thank you, we've received your ${what}`}>
      <p className="m-0">
        Your reference is <b className="font-mono text-[13px]">{state.ref}</b>.
      </p>
    </DonePanel>
  );
}

function ErrorLine({ text }: { text?: string | undefined }) {
  return text ? (
    <Banner tone="bad" role="alert">
      <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </Banner>
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
    <div className="grid gap-2">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      {shots.map((s) => (
        <input key={s.id} type="hidden" name="photoId" value={s.id} />
      ))}
      {shots.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Added photos">
          {shots.map((s, n) => (
            <li
              key={s.id}
              className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-transparent bg-accent px-3.5 py-2 text-[15px] text-on-accent"
            >
              <span className="flex min-w-0 items-center gap-2">
                <IconCheck size={20} weight="fill" className="shrink-0" aria-hidden />
                <span className="truncate">
                  Photo {n + 1} added<span className="sr-only">: {s.name}</span>
                </span>
              </span>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                aria-label={`Remove photo ${n + 1}`}
                onClick={() => setShots((x) => x.filter((y) => y.id !== s.id))}
              >
                <IconTrash size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {shots.length < max && (
        <label
          aria-disabled={busy}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 text-[15px] font-semibold text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          <IconUpload size={18} aria-hidden />
          {busy ? "Uploading…" : shots.length ? "Add another photo" : "Add a photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="sr-only"
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
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      <PFieldset legend="Is the report right?">
        <Choice name="agree" value="yes" title="Yes, it matches what I found" onChange={() => setChoice("yes")} />
        <Choice
          name="agree"
          value="no"
          title="No, something is different or missing"
          onChange={() => setChoice("no")}
        />
      </PFieldset>
      <PField label={choice === "no" ? "What is different?" : "Anything to add?"} optional={choice !== "no"}>
        <textarea name="comment" rows={3} maxLength={2000} dir="auto" className={`${P_INPUT} resize-y`} />
      </PField>
      <Photos token={token} kind="tenant_condition_photo" max={20} label="Your own photos (optional)" />
      <Cta>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </button>
      </Cta>
    </ActionForm>
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
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <ErrorLine text={state.error} />
      <PFieldset legend="Where do things stand?">
        {PAY_CHOICES.map((c) => (
          <Choice
            key={c.value}
            name="choice"
            value={c.value}
            title={c.label}
            help={c.help}
            onChange={() => setChoice(c.value)}
          />
        ))}
      </PFieldset>
      {choice === "will_pay" && (
        <PField label="I will pay by">
          <input type="date" name="payBy" min={today} max={maxDate} required className={P_INPUT} />
        </PField>
      )}
      <PField label="Comment" optional>
        <textarea name="comment" rows={3} maxLength={2000} dir="auto" className={`${P_INPUT} resize-y`} />
      </PField>
      {choice === "paid" && <Photos token={token} kind="payment_proof" max={3} label="Proof of payment (optional)" />}
      <Cta>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </button>
      </Cta>
    </ActionForm>
  );
}

export function ReportIssueForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(reportIssue, {});
  if (state.ref) return <Done state={state} what="report" />;
  return (
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      <PField label="What's the problem?">
        <textarea name="description" rows={4} maxLength={2000} required dir="auto" className={`${P_INPUT} resize-y`} />
      </PField>
      <PField label="Which room?" optional>
        <input name="room" type="text" autoComplete="off" maxLength={60} className={P_INPUT} />
      </PField>
      <Choice
        type="checkbox"
        name="atRisk"
        title="Someone is at risk"
        help="Fire, smoke, gas, sparks, flooding, someone hurt. We'll treat it as urgent. In an emergency, call 999 first."
      />
      <Photos token={token} kind="issue_photo" max={5} label="Photos (optional)" />
      <Cta>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Sending…" : "Send report"}
        </button>
      </Cta>
    </ActionForm>
  );
}

const dubaiTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** Step 10: notice to vacate. Only the lease end is offered; another date goes to a manager as a request. */
export function VacateNoticeForm({ token, leaseEndOn }: { token: string; leaseEndOn: string }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(giveNotice, {});
  if (state.ref) return <Done state={state} what="notice" />;
  return (
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="moveOutOn" value={leaseEndOn} />
      <ErrorLine text={state.error} />
      <div className="grid gap-2 rounded-card border border-transparent bg-accent p-4 text-on-accent">
        <p className="m-0 text-[15px]">
          You will move out when your lease ends, on <b>{leaseEndOn}</b>.
        </p>
        <p className="m-0 text-[13px] opacity-80">
          To leave earlier, say so in the comment: a person will contact you about the terms.
        </p>
      </div>
      <PField label="Comment" optional>
        <textarea name="comment" rows={3} maxLength={2000} dir="auto" className={`${P_INPUT} resize-y`} />
      </PField>
      <Choice
        type="checkbox"
        name="confirm"
        value="yes"
        required
        title="I am giving notice that I will move out and not renew."
      />
      <Cta>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Sending…" : "Give notice"}
        </button>
      </Cta>
    </ActionForm>
  );
}

export function InspectionBookingForm({
  token,
  slots,
  current,
}: {
  token: string;
  slots: string[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState<PortalState, FormData>(bookInspection, {});
  if (state.ref) return <Done state={state} what="booking" />;
  if (!slots.length) return <Note>No times are open right now. The leasing team will contact you.</Note>;
  return (
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <ErrorLine text={state.error} />
      {current && (
        <Banner tone="good">
          <IconCheck size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Booked: <b>{dubaiTime(current)}</b> (Dubai time). Pick another time to move it.
          </span>
        </Banner>
      )}
      <PFieldset legend="Choose a time (Dubai time, about one hour)">
        {slots.map((s) => (
          <Choice key={s} name="slotAt" value={s} required defaultChecked={s === current} title={dubaiTime(s)} />
        ))}
      </PFieldset>
      <Cta>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? "Booking…" : "Book"}
        </button>
      </Cta>
    </ActionForm>
  );
}

export function DepositResponseForm({ token, revision }: { token: string; revision: number }) {
  const [state, action, pending] = useActionState<PortalState, FormData>(depositResponse, {});
  const [choice, setChoice] = useState("");
  if (state.ref) return <Done state={state} what="answer" />;
  return (
    <ActionForm state={state} action={action} className={FORM}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="revision" value={revision} />
      <ErrorLine text={state.error} />
      <PFieldset legend="Your answer">
        <Choice name="choice" value="accept" title="I accept the statement" onChange={() => setChoice("accept")} />
        <Choice name="choice" value="dispute" title="I dispute it" onChange={() => setChoice("dispute")} />
      </PFieldset>
      {choice === "accept" && (
        <>
          <PField label="Account holder name">
            <input name="accountName" type="text" maxLength={120} required autoComplete="name" className={P_INPUT} />
          </PField>
          <PField label="IBAN">
            <input
              name="iban"
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              required
              placeholder="AE07 0331 2345 6789 0123 456"
              className={P_INPUT}
            />
          </PField>
        </>
      )}
      {choice === "dispute" && (
        <PField
          label="What do you disagree with?"
          hint="A person reviews every dispute. You can also contact the Rental Disputes Centre."
        >
          <textarea name="reason" rows={4} maxLength={2000} dir="auto" required className={`${P_INPUT} resize-y`} />
        </PField>
      )}
      <Cta>
        <button type="submit" className={PRIMARY} disabled={pending || !choice}>
          {pending ? "Sending…" : "Send"}
        </button>
      </Cta>
    </ActionForm>
  );
}
