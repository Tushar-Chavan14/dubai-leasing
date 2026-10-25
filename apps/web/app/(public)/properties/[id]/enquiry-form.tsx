"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { type EnquiryState, submitEnquiry } from "./actions";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EnquiryForm({ unitId, slots }: { unitId: string; slots: { at: string; label: string }[] }) {
  const [state, action, pending] = useActionState<EnquiryState, FormData>(submitEnquiry, {});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState({ name: "", email: "", phone: "", slot: "" });
  const router = useRouter();
  // The chosen time was taken or is gone: clear it and refetch the free times.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.slotTaken) {
      setValues((v) => ({ ...v, slot: "" }));
      setTouched((t) => ({ ...t, slot: false }));
    }
  }
  useEffect(() => {
    if (state.slotTaken) router.refresh();
  }, [state, router]);

  if (state.ref)
    return (
      <div className="pub-success" role="status">
        <h3>Viewing booked</h3>
        <p>
          Viewing booked — we&apos;ve emailed your invitation (ref <span className="ref">{state.ref}</span>).
        </p>
      </div>
    );

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const local: Partial<Record<keyof typeof values, string | undefined>> = {
    name: values.name.trim().length < 2 ? "Enter your name." : undefined,
    email: EMAIL.test(values.email.trim()) ? undefined : "Enter a valid email address.",
    slot: values.slot ? undefined : "Choose a viewing time.",
  };
  const err = (k: keyof typeof values) => (touched[k] ? local[k] : undefined) ?? state.fields?.[k];
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  if (!slots.length)
    return (
      <p className="pub-empty">
        There are no free viewing times for this home right now. Chat with us and we&apos;ll arrange one.
      </p>
    );

  return (
    <form
      action={action}
      className="pub-form"
      noValidate
      onSubmit={(e) => {
        if (local.name || local.email || local.slot) {
          e.preventDefault();
          setTouched({ name: true, email: true, slot: true });
        }
      }}
    >
      <input type="hidden" name="unitId" value={unitId} />
      <label className="field">
        <span className="field-label">Name</span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          autoComplete="name"
          value={values.name}
          onChange={set("name")}
          onBlur={blur("name")}
          aria-invalid={!!err("name")}
          aria-describedby={err("name") ? "e-name" : undefined}
        />
        {err("name") && (
          <span className="hint" data-tone="bad" id="e-name">
            {err("name")}
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">Email</span>
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          value={values.email}
          onChange={set("email")}
          onBlur={blur("email")}
          aria-invalid={!!err("email")}
          aria-describedby={err("email") ? "e-email" : undefined}
        />
        {err("email") && (
          <span className="hint" data-tone="bad" id="e-email">
            {err("email")}
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">
          Phone <em>(optional)</em>
        </span>
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          maxLength={40}
          autoComplete="tel"
          value={values.phone}
          onChange={set("phone")}
          aria-invalid={!!state.fields?.phone}
        />
        {state.fields?.phone && (
          <span className="hint" data-tone="bad">
            {state.fields.phone}
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">Viewing time (Dubai)</span>
        <select
          name="slot"
          required
          value={values.slot}
          onChange={set("slot")}
          onBlur={blur("slot")}
          aria-invalid={!!err("slot")}
          aria-describedby={err("slot") ? "e-slot" : undefined}
        >
          <option value="">Choose a time</option>
          {slots.map((s) => (
            <option key={s.at} value={s.at}>
              {s.label}
            </option>
          ))}
        </select>
        {err("slot") && (
          <span className="hint" data-tone="bad" id="e-slot">
            {err("slot")}
          </span>
        )}
      </label>
      {state.error && !state.fields && (
        <div className="alert" data-tone="bad" role="alert">
          {state.error}
        </div>
      )}
      <button type="submit" className="btn primary pub-submit" disabled={pending}>
        {pending ? "Booking…" : "Book this viewing"}
      </button>
    </form>
  );
}
