import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { aedShort, dateTime, longDate } from "../lib/format";
import type { LogDetail, LogEntry } from "../lib/types";

function detailValue(d: LogDetail): string {
  if (d.format === "date") return longDate(d.value);
  if (d.format === "datetime") return dateTime(d.value);
  if (d.format === "fils") return aedShort(Number(d.value));
  return d.value;
}

/** The divided list the rows sit in. `boxed` draws its own card (Home); inside a record card it stays plain. */
export function ActivityList({
  children,
  boxed = false,
  className = "",
}: {
  children: ReactNode;
  boxed?: boolean;
  className?: string;
}) {
  return (
    <ul
      className={`m-0 grid list-none divide-y divide-line p-0 ${boxed ? "rounded-card border border-line bg-page shadow-card" : "-mx-5"} ${className}`}
    >
      {children}
    </ul>
  );
}

/**
 * One activity row (Home and the Workspace record): a mono stamp, the sentence, a quiet note on the right and a
 * chevron. It opens (native <details>, works without JavaScript) to who, when and the labelled facts behind the
 * entry, plus `footer` (a link). `below` stays visible under a closed row: a waiting entry's buttons.
 */
export function ActivityItem({
  entry: e,
  stamp,
  stampTitle,
  note,
  footer,
  below,
  strong = false,
}: {
  entry: LogEntry;
  stamp: string;
  stampTitle?: string;
  note?: ReactNode;
  footer?: ReactNode;
  below?: ReactNode;
  /** Bold sentence: the entry waits on someone. */
  strong?: boolean;
}) {
  return (
    <li className="m-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-[13px] text-ink transition-colors duration-150 hover:bg-raised group-open:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          <time
            dateTime={e.at}
            title={stampTitle}
            className="w-[96px] flex-none whitespace-nowrap font-mono text-[12px] text-muted"
          >
            {stamp}
          </time>
          <span className={`min-w-0 flex-1 ${strong ? "font-semibold" : ""}`}>{e.text}</span>
          {note && <span className="hidden flex-none text-xs text-muted sm:inline">{note}</span>}
          <CaretRightIcon
            size={14}
            weight="bold"
            aria-hidden
            className="flex-none text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
          />
        </summary>
        <div className="grid gap-3 border-t border-line bg-raised px-5 pt-3 pb-4 pl-[128px] max-sm:pl-5">
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 text-[13px]">
            <dt className="text-muted">Who</dt>
            <dd className="m-0 text-ink">{e.actor.name}</dd>
            <dt className="text-muted">When</dt>
            <dd className="m-0 text-ink">{dateTime(e.at)}</dd>
            {(e.details ?? [])
              .filter((d) => d.label !== "Done by" || d.value !== e.actor.name)
              .map((d) => (
                <div key={d.label} className="contents">
                  <dt className="text-muted">{d.label}</dt>
                  <dd
                    className={`m-0 break-words ${d.format === "code" ? "font-mono text-[12px] text-muted" : d.label === "Error" ? "text-danger" : "text-ink"}`}
                  >
                    {detailValue(d)}
                  </dd>
                </div>
              ))}
          </dl>
          {footer}
        </div>
      </details>
      {below && <div className="px-5 pb-3 pl-[128px] max-sm:pl-5">{below}</div>}
    </li>
  );
}
