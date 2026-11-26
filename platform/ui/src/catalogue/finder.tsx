"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { type CSSProperties, type SubmitEvent, useId } from "react";
import { finderValues } from "./finder-values";

const SELECT =
  "w-full cursor-pointer appearance-none border-0 bg-transparent p-0 pr-5 font-sans text-sm font-medium text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink";

export interface FinderField {
  /** The form field name; also the key in `onSearch`'s values. */
  name: string;
  label: string;
  anyLabel: string;
  /** The applied value ("" for any). */
  value: string;
  options: { value: string; label: string }[];
}

/**
 * The finder bar on a catalogue: selects in one rounded strip, and Search. It stays a client component: the module
 * builds the href from the values (so its URL keys stay its own) and this pushes it. Remount it with a `key` that
 * changes with the applied filters, so the selects always show what is applied.
 */
export function Finder({
  fields,
  searchLabel,
  onSearch,
  ariaLabel = "Find a home",
}: {
  fields: FinderField[];
  searchLabel: string;
  /** Maps the chosen values to the page href to go to (no scroll). */
  onSearch: (values: Record<string, string>) => string;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const id = useId();
  const names = fields.map((f) => f.name);
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    router.push(onSearch(finderValues(new FormData(e.currentTarget), names)), { scroll: false });
  };
  const cell = "relative grid gap-0.5 px-4 py-2.5 text-xs text-muted sm:border-r sm:border-line";
  const caret = (
    <CaretDownIcon
      size={14}
      aria-hidden="true"
      className="pointer-events-none absolute right-4 bottom-3.5 text-muted sm:right-3.5"
    />
  );
  const cols = `${fields.map(() => "1fr").join(" ")} auto`;
  return (
    <form
      onSubmit={submit}
      aria-label={ariaLabel}
      style={{ "--finder-cols": cols } as CSSProperties}
      className="mt-6 grid w-full overflow-hidden rounded-[18px] border border-line bg-page sm:grid-cols-(--finder-cols)"
    >
      {fields.map((f) => (
        <label key={f.name} className={`${cell} border-b border-line sm:border-b-0`} htmlFor={`${id}-${f.name}`}>
          {f.label}
          <select id={`${id}-${f.name}`} name={f.name} defaultValue={f.value} className={SELECT}>
            <option value="">{f.anyLabel}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {caret}
        </label>
      ))}
      <button
        type="submit"
        className="min-h-12 cursor-pointer border-0 bg-cta px-7 font-sans text-sm font-semibold text-on-cta focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"
      >
        {searchLabel}
      </button>
    </form>
  );
}
