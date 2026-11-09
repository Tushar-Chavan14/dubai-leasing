import type { ReactNode } from "react";

/** Plain section of the record view: a small heading, an optional grey hint, an action on the right. No box. */
export function Section({
  id,
  title,
  hint,
  action,
  children,
  className = "",
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`grid gap-3 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 id={id} className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
        {action && <span className="ml-auto flex flex-wrap items-center gap-2">{action}</span>}
      </div>
      {children}
    </section>
  );
}

/** A grid of fact cells (label over value), two across when there is room. */
export function FactGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`m-0 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 ${className}`}>{children}</dl>;
}

export function Fact({
  label,
  children,
  tone = "raised",
  mono = false,
}: {
  label: ReactNode;
  children: ReactNode;
  /** `tinted` sits on the tinted gate panel. */
  tone?: "raised" | "tinted";
  mono?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-xl px-3.5 py-2.5 ${tone === "tinted" ? "bg-black/[0.06]" : "bg-raised"}`}>
      <dt className={`text-xs ${tone === "tinted" ? "text-on-accent/70" : "text-muted"}`}>{label}</dt>
      <dd
        className={`m-0 mt-0.5 min-w-0 text-sm font-semibold [overflow-wrap:anywhere] ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {children}
      </dd>
    </div>
  );
}

/** Label and value rows for a longer list of facts (key left, value right), no cells. */
export function FactList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <dl className={`m-0 grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-5 gap-y-2 text-sm ${className}`}>
      {children}
    </dl>
  );
}
export const FactKey = ({ children }: { children: ReactNode }) => <dt className="text-muted">{children}</dt>;
export const FactVal = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <dd className={`m-0 min-w-0 [overflow-wrap:anywhere] ${className}`}>{children}</dd>
);

/** The grey second line of a row. */
export const Sub = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <span className={`block text-[12.5px] text-muted ${className}`}>{children}</span>
);

/** A bordered row card, as in the mockup lists. */
export const ROW_CARD = "rounded-xl border border-line bg-page px-3.5 py-2.5";

export const NOTE_TEXT = "m-0 text-[12.5px] text-muted";

/** Quoted words written by a tenant or applicant: untrusted, shown quietly. */
export const TENANT_TEXT =
  "m-0 whitespace-pre-line rounded-r-lg border-l-[3px] border-line bg-raised px-3 py-2 text-sm text-ink";
