"use client";

import { CheckCircleIcon } from "@phosphor-icons/react";
import { buttonClass } from "@platform/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { submitEnquiry } from "../../app/(site)/properties/[ref]/actions";
import type { EnquiryState } from "../../lib/enquiry-submit";
import { groupSlotsByDay, viewingTimeLabel } from "../../lib/viewing-slots";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Mode = "book" | "ask";

/**
 * The property page's enquiry form (S79), laid out like leasing's: tabs "Book a viewing" and "Ask a question", the times
 * grouped by day (Dubai time), name, email, phone, message and the consent tick. The action is a server action; nothing
 * here talks to the engine.
 */
export function EnquiryForm({
  homeRef,
  slots,
  action = submitEnquiry,
}: {
  homeRef: string;
  slots: readonly string[];
  action?: (prev: EnquiryState, form: FormData) => Promise<EnquiryState>;
}) {
  const [state, formAction, pending] = useActionState<EnquiryState, FormData>(action, {});
  const [mode, setMode] = useState<Mode>("book");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState({ name: "", email: "", phone: "", message: "", slot: "", consent: false });
  const router = useRouter();
  // The chosen time was taken or is gone: clear it and fetch the free times again.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.slotTaken) setValues((v) => ({ ...v, slot: "" }));
  }
  useEffect(() => {
    if (state.slotTaken) router.refresh();
  }, [state, router]);

  if (state.done)
    return (
      <div className="grid gap-1.5 rounded-xl bg-accent p-4 text-on-accent" role="status">
        <h3 className="m-0 flex items-center gap-2 text-lg leading-tight font-semibold">
          <CheckCircleIcon size={20} weight="fill" aria-hidden="true" />
          {state.done === "booked" ? "Viewing booked" : "Question sent"}
        </h3>
        <p className="m-0 text-sm">
          {state.done === "booked" && state.startsAt
            ? `${viewingTimeLabel(state.startsAt)}. We've emailed your confirmation, with a link to cancel.`
            : "The agent will reply to you by email."}
        </p>
      </div>
    );

  const days = groupSlotsByDay(slots);
  const set = (k: "name" | "email" | "phone" | "message") => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const local: Partial<Record<"name" | "email" | "slot" | "message" | "consent", string | undefined>> = {
    name: values.name.trim().length < 2 ? "Enter your name." : undefined,
    email: EMAIL.test(values.email.trim()) ? undefined : "Enter a valid email address.",
    slot: mode === "book" && !values.slot ? "Choose a viewing time." : undefined,
    message: mode === "ask" && !values.message.trim() ? "Write your question." : undefined,
    consent: values.consent ? undefined : "Tick the box so we may contact you about this home.",
  };
  const err = (k: keyof typeof local) => (touched[k] ? local[k] : undefined) ?? state.fields?.[k];
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));
  const bad = Object.values(local).some(Boolean);

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${m}`}
      aria-selected={mode === m}
      aria-controls="enquiry-panel"
      onClick={() => setMode(m)}
      className={`h-9 flex-1 cursor-pointer rounded-full border-0 px-3 font-sans text-sm font-semibold transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        mode === m ? "bg-accent text-on-accent" : "bg-transparent text-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="grid gap-4">
      <div
        role="tablist"
        aria-label="How can we help"
        className="flex gap-1 rounded-full border border-line bg-page p-1"
      >
        {tab("book", "Book a viewing")}
        {tab("ask", "Ask a question")}
      </div>
      <form
        id="enquiry-panel"
        role="tabpanel"
        aria-labelledby={`tab-${mode}`}
        action={formAction}
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          if (bad) {
            e.preventDefault();
            setTouched({ name: true, email: true, slot: true, message: true, consent: true });
          }
        }}
      >
        <input type="hidden" name="ref" value={homeRef} />
        <input type="hidden" name="mode" value={mode} />
        {mode === "book" &&
          (days.length ? (
            <fieldset className="m-0 grid gap-3 border-0 p-0" aria-describedby={err("slot") ? "e-slot" : undefined}>
              <legend className={`${LABEL} mb-1.5`}>Viewing time (Dubai)</legend>
              <div className="grid max-h-64 gap-3 overflow-y-auto pr-1">
                {days.map((d) => (
                  <div key={d.day} className="grid gap-1.5" role="group" aria-label={d.label}>
                    <span className="text-sm font-semibold text-ink">{d.label}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {d.times.map((t) => (
                        <label key={t.iso} className="relative">
                          <input
                            type="radio"
                            name="slot"
                            value={t.iso}
                            checked={values.slot === t.iso}
                            onChange={() => setValues((v) => ({ ...v, slot: t.iso }))}
                            onBlur={blur("slot")}
                            className="peer sr-only"
                          />
                          <span className="inline-flex h-9 min-w-[4.25rem] cursor-pointer items-center justify-center rounded-lg border border-line bg-page px-2.5 text-sm tabular-nums peer-checked:border-ink peer-checked:bg-ink peer-checked:text-page peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
                            {t.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {err("slot") && (
                <span className="text-xs text-danger" id="e-slot">
                  {err("slot")}
                </span>
              )}
            </fieldset>
          ) : (
            <p className="m-0 text-base text-muted">
              There are no free viewing times for this home right now. Ask a question and we&apos;ll arrange one.
            </p>
          ))}
        <label className={FIELD}>
          <span className={LABEL}>Name</span>
          <input
            className={INPUT}
            name="name"
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            value={values.name}
            onChange={set("name")}
            onBlur={blur("name")}
            aria-invalid={!!err("name")}
            aria-describedby={err("name") ? "e-name" : undefined}
          />
          {err("name") && (
            <span className="text-xs text-danger" id="e-name">
              {err("name")}
            </span>
          )}
        </label>
        <label className={FIELD}>
          <span className={LABEL}>Email</span>
          <input
            className={INPUT}
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            value={values.email}
            onChange={set("email")}
            onBlur={blur("email")}
            aria-invalid={!!err("email")}
            aria-describedby={err("email") ? "e-email" : undefined}
          />
          {err("email") && (
            <span className="text-xs text-danger" id="e-email">
              {err("email")}
            </span>
          )}
        </label>
        <label className={FIELD}>
          <span className={LABEL}>
            Phone <span className="font-normal">(optional)</span>
          </span>
          <input
            className={INPUT}
            name="phone"
            type="tel"
            inputMode="tel"
            maxLength={30}
            autoComplete="tel"
            value={values.phone}
            onChange={set("phone")}
            aria-invalid={!!state.fields?.phone}
          />
          {state.fields?.phone && <span className="text-xs text-danger">{state.fields.phone}</span>}
        </label>
        <label className={FIELD}>
          <span className={LABEL}>
            {mode === "ask" ? "Your question" : "Message"}
            {mode === "book" && <span className="font-normal"> (optional)</span>}
          </span>
          <textarea
            className={`${INPUT} min-h-24 py-2`}
            name="message"
            rows={3}
            maxLength={2000}
            value={values.message}
            onChange={set("message")}
            onBlur={blur("message")}
            aria-invalid={!!err("message")}
            aria-describedby={err("message") ? "e-message" : undefined}
          />
          {err("message") && (
            <span className="text-xs text-danger" id="e-message">
              {err("message")}
            </span>
          )}
        </label>
        <div className="grid gap-1">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="consent"
              checked={values.consent}
              onChange={(e) => setValues((v) => ({ ...v, consent: e.target.checked }))}
              onBlur={blur("consent")}
              aria-invalid={!!err("consent")}
              aria-describedby={err("consent") ? "e-consent" : undefined}
              className="mt-0.5 size-4 shrink-0"
            />
            <span>I agree to be contacted about this home by email or phone.</span>
          </label>
          {err("consent") && (
            <span className="text-xs text-danger" id="e-consent">
              {err("consent")}
            </span>
          )}
        </div>
        {state.error && !state.fields && (
          <Banner tone="bad" role="alert">
            {state.error}
          </Banner>
        )}
        <button
          type="submit"
          className={`${buttonClass("primary")} h-12 w-full`}
          disabled={pending || (mode === "book" && !days.length)}
        >
          {pending ? "Sending…" : mode === "book" ? "Book this viewing" : "Send your question"}
        </button>
      </form>
    </div>
  );
}
