import type { InputHTMLAttributes, ReactNode } from "react";
import { buttonClass } from "./button";

/**
 * Building blocks for the tenant and landlord share links (`/t/[token]/...`): one task per page. Phones get one
 * column with the primary action pinned to the bottom; from `md` the page sits in a card and actions sit inline. Plain Tailwind; colours come from the tokens.
 */

/** A page's column: grows so the pinned action sits at the bottom on short pages. */
export const PAGE = "flex flex-1 flex-col gap-4";
/** A form that is the page's column. */
export const FORM = "flex flex-1 flex-col gap-4";

/** 44px and 16px type: iOS Safari zooms the page for smaller fields. */
export const P_INPUT =
  "min-h-11 w-full rounded-input border border-line bg-page px-3 py-2 font-sans text-base text-ink placeholder:text-muted hover:border-ink focus:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

/** Button looks for the pinned bar and for inline actions (links and buttons). */
export const PRIMARY = `${buttonClass("primary")} min-h-12 w-full md:w-auto md:min-w-44 md:px-6`;
export const GHOST = `${buttonClass("ghost")} min-h-12 w-full md:w-auto md:min-w-44 md:px-6`;
export const QUIET = `${buttonClass("quiet")} min-h-11 w-full`;
export const SMALL_GHOST = `${buttonClass("ghost")} min-h-11 px-4`;

export function PortalTitle({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="m-0 text-[22px] font-semibold leading-tight tracking-tight text-ink md:text-[26px]">{title}</h1>
      {sub && <p className="m-0 mt-1.5 max-w-[60ch] text-[15px] leading-snug text-muted">{sub}</p>}
    </div>
  );
}

/** Two-up figure tiles (the mockup's rent, cheques, deposit, move-in grid). */
export function Tiles({
  items,
  label,
}: {
  items: { label: string; value: ReactNode; wide?: boolean }[];
  label?: string;
}) {
  return (
    <dl aria-label={label} className="m-0 grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className={`rounded-xl bg-raised px-3 py-2.5 ${t.wide ? "col-span-2" : ""}`}>
          <dt className="text-[11.5px] text-muted">{t.label}</dt>
          <dd className="m-0 mt-0.5 font-semibold tabular-nums text-ink">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Label and value rows in a bordered card, for details that read as a list (parties, property, statement). */
export function Rows({
  rows,
  label,
}: {
  rows: { label: string; value: ReactNode; strong?: boolean; key?: string | number }[];
  label?: string;
}) {
  return (
    <dl aria-label={label} className="m-0 divide-y divide-line rounded-card border border-line">
      {rows.map((r) => (
        <div key={r.key ?? r.label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-4 py-3 text-sm">
          <dt className="text-muted">{r.label}</dt>
          <dd className={`m-0 min-w-0 break-words text-right tabular-nums text-ink ${r.strong ? "font-semibold" : ""}`}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A bordered section card with an optional heading. */
export function Section({ title, children, tone }: { title?: ReactNode; children: ReactNode; tone?: "accent" }) {
  return (
    <section
      className={`grid gap-3 rounded-card border p-4 ${tone === "accent" ? "border-transparent bg-accent text-on-accent" : "border-line bg-raised text-ink"}`}
    >
      {title && <h2 className="m-0 text-base font-semibold tracking-tight">{title}</h2>}
      {children}
    </section>
  );
}

/** The pinned bar: the page's one primary action, with safe-area padding on phones. `inline` is for forms that sit inside a longer page. */
export function Cta({ children, inline }: { children: ReactNode; inline?: boolean }) {
  // From md the actions sit in a row at the end of the card, primary (first) on the right.
  const row = "md:flex md:flex-row-reverse md:flex-wrap md:justify-start md:gap-3";
  if (inline) return <div className={`grid gap-2 ${row}`}>{children}</div>;
  return (
    <div
      className={`sticky bottom-0 z-10 -mx-5 mt-auto grid gap-2 border-t border-line bg-page px-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:static md:mx-0 md:mt-8 md:border-0 md:bg-transparent md:p-0 ${row}`}
    >
      {children}
    </div>
  );
}

export function Note({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 text-[13px] leading-snug text-muted ${className}`}>{children}</p>;
}

/** A labelled field. The control inside is styled with P_INPUT. */
export function PField({
  label,
  optional,
  hint,
  children,
}: {
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-semibold text-muted">
        {label}
        {optional && <span className="font-normal"> (optional)</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function PFieldset({ legend, children }: { legend: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-semibold text-muted">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A radio or checkbox as a tappable card; the chosen one is filled. */
export function Choice({
  title,
  help,
  type = "radio",
  ...input
}: { title: ReactNode; help?: ReactNode; type?: "radio" | "checkbox" } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "title"
>) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-page px-3.5 py-3 has-[:checked]:border-transparent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
      <input type={type} className="mt-0.5 size-5 shrink-0 cursor-pointer accent-ink" {...input} />
      <span className="grid gap-0.5 text-[15px]">
        <span className="font-semibold">{title}</span>
        {help && <span className="text-[13px] opacity-80">{help}</span>}
      </span>
    </label>
  );
}

/** The finished state: a tick, a heading and what happens next. */
export function Done({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="my-auto grid justify-items-center gap-3 py-6 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-accent text-on-accent">
        <svg width="28" height="28" viewBox="0 0 256 256" fill="currentColor" aria-hidden>
          <path d="M229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69 218.34 66.34a8 8 0 0 1 11.32 11.32Z" />
        </svg>
      </span>
      <h1 className="m-0 text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
      {children && <div className="grid max-w-[34ch] gap-2 text-[15px] leading-snug text-muted">{children}</div>}
      {action}
    </div>
  );
}
