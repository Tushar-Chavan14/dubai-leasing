import { SectionToggle } from "./section-toggle";
import type { ReactNode } from "react";

/**
 * Section of the record view: a small heading with an optional grey sub line under it, an action on the right. No box of its own;
 * inside a `.record-cards` container the outermost sections become cards (globals.css), and `highlight` marks the
 * one that holds the next thing to do.
 */
export function Section({
  id,
  title,
  hint,
  action,
  children,
  className = "",
  highlight = false,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      data-section=""
      {...(highlight ? { "data-highlight": "" } : {})}
      className={`grid gap-3 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="grid min-w-0 gap-0.5">
          <h2 id={id} className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {/* The hint is a sub line under the title, not beside it. */}
          {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
        </div>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {action}
          <SectionToggle headingId={id} />
        </span>
      </div>
      {children}
    </section>
  );
}

/** A grid of facts (label over value), as many across as fit. Plain on cards; boxed only on the tinted gate panel. */
export function FactGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <dl className={`m-0 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-6 gap-y-4 ${className}`}>
      {children}
    </dl>
  );
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
    <div className={`min-w-0 ${tone === "tinted" ? "rounded-xl bg-white/15 px-3.5 py-2.5 ring-1 ring-white/20" : ""}`}>
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
