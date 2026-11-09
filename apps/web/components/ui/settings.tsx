import type { ReactNode } from "react";
import { PageTitle } from "./page";
import { buttonClass } from "./button";
import { FIELD, HINT, INPUT as BASE_INPUT, LABEL } from "./form";

/**
 * Building blocks of the Settings pages: a page with a back link, a title and a plain explanation; a form on the left
 * with a preview on the right; labelled fields with help under them; a sticky save bar. Colours come from the tokens.
 */

export const SET_INPUT = `${BASE_INPUT} aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:opacity-60`;
export const SET_SELECT = `${SET_INPUT} cursor-pointer`;
export const SET_TEXTAREA = `${SET_INPUT} min-h-24 resize-y leading-normal`;

/** Native checkbox drawn as a switch: black track (green in dark), page-coloured knob. */
export const SWITCH =
  "relative h-[22px] w-[38px] shrink-0 cursor-pointer appearance-none rounded-full border-0 bg-line transition-colors duration-150 " +
  "after:absolute after:top-[3px] after:left-[3px] after:size-4 after:rounded-full after:bg-page after:transition-transform after:duration-150 " +
  "checked:bg-primary checked:after:translate-x-4 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none " +
  "motion-reduce:after:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Small buttons for the legacy-shaped forms: one 36px height. */
export const BTN = {
  primary: buttonClass("primary", "sm"),
  ghost: buttonClass("ghost", "sm"),
  danger: buttonClass("danger", "sm"),
} as const;

/** Alert box classes, same look as `Banner`, for markup that needs a plain div. */
const ALERT_BASE =
  "flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm [&_ul]:m-0 [&_ul]:mt-1 [&_ul]:pl-4 [&_svg]:mt-0.5 [&_svg]:shrink-0";
export const ALERT = {
  bad: `${ALERT_BASE} border-danger text-danger`,
  warn: `${ALERT_BASE} border-warning text-warning`,
  good: `${ALERT_BASE} border-line bg-accent text-on-accent`,
} as const;

/** A row of checkboxes with their labels beside them. */
export const CHECK_ROW =
  "flex flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 text-sm [&_label]:inline-flex [&_label]:cursor-pointer [&_label]:items-center [&_label]:gap-1.5 [&_input]:size-4 [&_input]:accent-primary";

export const TABLE = "w-full border-collapse text-sm";
export const TH = "whitespace-nowrap border-b border-line px-3.5 py-2.5 text-left text-xs font-semibold text-muted";
export const TD = "border-b border-line px-3.5 py-3 align-top group-last:border-b-0";

/** A settings page: back to Settings, title, a short plain explanation, and the page's actions (Ask AI) on the right. */
export function SetPage({
  title,
  lede,
  actions,
  back = { href: "/settings", label: "Settings" },
  max = "max-w-[1040px]",
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Tailwind max-width class; pass `max-w-none` for wide tables. */
  max?: string;
  children: ReactNode;
}) {
  return (
    <div className={`grid gap-6 ${max}`}>
      <PageTitle back={back} title={title} lede={lede} actions={actions} />
      {children}
    </div>
  );
}

/** Form on the left, preview or summary on the right when there is room; stacked (form first) when there is not. */
export function FormGrid({ children, preview }: { children: ReactNode; preview?: ReactNode }) {
  return (
    <div className={`grid items-start gap-6 ${preview ? "@3xl:grid-cols-[minmax(0,1fr)_320px] @3xl:gap-7" : ""}`}>
      <div className="grid min-w-0 gap-6">{children}</div>
      {preview}
    </div>
  );
}

/** The right-hand preview card. Sticks while the form scrolls. */
export function Preview({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children: ReactNode }) {
  return (
    <aside className="grid gap-3 self-start rounded-card bg-raised p-4 @3xl:sticky @3xl:top-4">
      <div>
        <h2 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {lede && <p className="m-0 mt-1 text-[13px] text-muted">{lede}</p>}
      </div>
      {children}
    </aside>
  );
}

/** A bordered white block on the page (a table, a list, a form). */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-card border border-line bg-page ${className}`}>{children}</section>;
}

/** A titled group inside a long form: a hairline above, a small heading, an optional grey line. */
export function Block({
  title,
  lede,
  id,
  action,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  id?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-3.5 border-t border-line pt-5 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {lede && <p className="m-0 mt-0.5 max-w-[62ch] text-[13px] text-muted">{lede}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Label over a control, help under it, an error under that. The control is the child. */
export function SField({
  label,
  help,
  error,
  children,
  className = "",
  as: Tag = "label",
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "label" | "div";
}) {
  return (
    <Tag className={`${FIELD} ${className}`}>
      <span className={LABEL}>{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : help ? (
        <span className={HINT}>{help}</span>
      ) : null}
    </Tag>
  );
}

/** Six-column field grid: full width when narrow, then 1 to 6 of 6 once the form is wide enough. */
export const GRID6 = "@container grid grid-cols-6 items-start gap-x-4 gap-y-4";
export const SPAN = {
  2: "col-span-6 @[520px]:col-span-2",
  3: "col-span-6 @[520px]:col-span-3",
  6: "col-span-6",
} as const;

/** An input with a unit on its left (AED, %). Pass the input as the child. */
export function Affix({ unit, children, className = "" }: { unit: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={`flex items-stretch overflow-hidden rounded-input border border-line bg-page focus-within:border-ink hover:border-ink has-[[aria-invalid=true]]:border-danger [&_input]:min-w-0 [&_input]:flex-1 [&_input]:border-0 [&_input]:bg-transparent [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:text-ink [&_input]:outline-none [&_input]:placeholder:text-muted ${className}`}
    >
      <b className="grid place-items-center border-r border-line bg-raised px-3 font-sans text-xs font-semibold text-muted">
        {unit}
      </b>
      {children}
    </span>
  );
}

/** The Save bar: sticks to the bottom of the screen while a long form scrolls. */
export function SaveBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-page px-4 py-3 shadow-[0_6px_24px_rgb(0_0_0/0.06)]">
      {note && <span className="min-w-0 flex-1 text-[13px] text-muted">{note}</span>}
      <span className={`flex flex-wrap items-center gap-2 ${note ? "" : "ml-auto"}`}>{children}</span>
    </div>
  );
}

/** One row of a list of settings: title and grey line on the left, the control on the right. */
export function SettingRow({
  title,
  sub,
  children,
  htmlFor,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-start gap-4 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
          {title}
        </label>
        {sub && <p className="m-0 mt-0.5 text-[13px] leading-snug text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** A small neutral note on a page. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13px] text-muted">{children}</p>;
}
