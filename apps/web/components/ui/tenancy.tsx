import type { ReactNode } from "react";
import { ROW_CARD } from "./record";

/** Shared pieces of the tenancy panels (move-in, payments, issues, renewal, move-out, dispute). Tokens only. */
export const LIST = "m-0 grid list-none gap-2 p-0 text-sm";
export const META = "flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted";
export const LINK = "font-medium text-ink! underline underline-offset-2 hover:no-underline";
export const SUB_HEAD = "m-0 font-sans text-[13px] font-semibold text-ink";
export const FORM_ROW = "flex flex-wrap items-center gap-2";
export const NOTE = "m-0 text-[12.5px] text-muted";

/** A bordered row: bold title, grey meta line, status and actions on the right, optional extra content below. */
export function ItemRow({
  title,
  meta,
  side,
  children,
  dir,
}: {
  title: ReactNode;
  meta?: ReactNode;
  side?: ReactNode;
  children?: ReactNode;
  dir?: "auto";
}) {
  return (
    <li className={`${ROW_CARD} grid gap-2`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="grid min-w-0 gap-0.5">
          <div className="text-sm font-semibold [overflow-wrap:anywhere]" dir={dir}>
            {title}
          </div>
          {meta && <div className={META}>{meta}</div>}
        </div>
        {side && <div className="flex shrink-0 flex-wrap items-center gap-2">{side}</div>}
      </div>
      {children}
    </li>
  );
}

/** One line of a checklist: a done or waiting mark, the label, and an optional control on the right. */
export function CheckLine({ done, children, action }: { done: boolean; children: ReactNode; action?: ReactNode }) {
  return (
    <li className={`${ROW_CARD} flex items-center justify-between gap-3`} data-done={done ? "" : undefined}>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? "bg-primary text-on-primary" : "border border-line text-muted"}`}
        >
          {done ? "✓" : ""}
        </span>
        <span className={done ? "text-muted" : ""}>{children}</span>
      </span>
      {action}
    </li>
  );
}
