"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { buttonClass } from "../../../../components/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "../../../../components/ui/form";
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
      <div className="grid gap-1.5 rounded-xl bg-accent p-4 text-on-accent" role="status">
        <h3 className="m-0 flex items-center gap-2 text-lg leading-tight font-semibold">
          <CheckCircleIcon size={20} weight="fill" aria-hidden="true" />
          Site visit booked
        </h3>
        <p className="m-0 text-sm">
          We&apos;ve emailed your invitation (ref <span className="font-mono">{state.ref}</span>).
        </p>
      </div>
    );

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const local: Partial<Record<keyof typeof values, string | undefined>> = {
    name: values.name.trim().length < 2 ? "Enter your name." : undefined,
    email: EMAIL.test(values.email.trim()) ? undefined : "Enter a valid email address.",
    slot: values.slot ? undefined : "Choose a site visit time.",
  };
  const err = (k: keyof typeof values) => (touched[k] ? local[k] : undefined) ?? state.fields?.[k];
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  if (!slots.length)
    return (
      <p className="text-base text-muted">
        There are no free site visit times for this home right now. Chat with us and we&apos;ll arrange one.
      </p>
    );

  return (
    <form
      action={action}
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        if (local.name || local.email || local.slot) {
          e.preventDefault();
          setTouched({ name: true, email: true, slot: true });
        }
      }}
    >
      <input type="hidden" name="unitId" value={unitId} />
      <label className={FIELD}>
        <span className={LABEL}>Name</span>
        <input
          className={INPUT}
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
          maxLength={254}
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
          maxLength={40}
          autoComplete="tel"
          value={values.phone}
          onChange={set("phone")}
          aria-invalid={!!state.fields?.phone}
        />
        {state.fields?.phone && <span className="text-xs text-danger">{state.fields.phone}</span>}
      </label>
      <label className={FIELD}>
        <span className={LABEL}>Site visit time (Dubai)</span>
        <select
          className={INPUT}
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
          <span className="text-xs text-danger" id="e-slot">
            {err("slot")}
          </span>
        )}
      </label>
      {state.error && !state.fields && (
        <Banner tone="bad" role="alert">
          {state.error}
        </Banner>
      )}
      <button type="submit" className={`${buttonClass("primary")} h-12 w-full`} disabled={pending}>
        {pending ? "Booking…" : "Book this site visit"}
      </button>
    </form>
  );
}
