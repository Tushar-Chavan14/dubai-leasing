import type { ReactNode } from "react";
import { Panel } from "../../../../components/ui/settings";
import { FactKey, FactVal, Sub } from "../../../../components/ui/record";
import { dateTime, eventLabel } from "../../../../lib/format";
import { fieldLabel, type RulebookDetail, show } from "./labels";

/** Read-only pieces of the rulebook views (server and client). */
export function FactRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <>
      <FactKey>{label}</FactKey>
      <FactVal>
        {children}
        <Sub>{hint}</Sub>
      </FactVal>
    </>
  );
}

const H2 = "m-0 font-sans text-[15px] font-semibold tracking-tight text-ink";

export function ReferenceNotes({ notes }: { notes: RulebookDetail["referenceRules"] }) {
  return (
    <Panel className="grid gap-3 p-5">
      <h2 id="notes-h" className={H2}>
        Reference notes
      </h2>
      {notes.length === 0 ? (
        <p className="m-0 text-sm text-muted">No reference notes in this version.</p>
      ) : (
        <div className="grid gap-3">
          {notes.map((n) => (
            <div key={n.id}>
              <b className="text-sm">{n.title}</b>
              <p className="m-0 mt-1 whitespace-pre-wrap text-sm">{n.text}</p>
            </div>
          ))}
        </div>
      )}
      <p className="m-0 text-[13px] text-muted">
        Written by the company for staff and the copilot. Not law, and the engine does not enforce them.
      </p>
    </Panel>
  );
}

export function Sources({ sources }: { sources: string[] }) {
  return (
    <Panel className="grid gap-3 p-5">
      <h2 id="sources-h" className={H2}>
        Sources
      </h2>
      {sources.length === 0 ? (
        <p className="m-0 text-sm text-muted">None listed.</p>
      ) : (
        <ul className="m-0 grid list-disc gap-1.5 pl-[18px] text-sm">
          {sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ChangesList({ title, changes }: { title: string; changes: RulebookDetail["changesVsActive"] }) {
  return (
    <Panel className="grid gap-3 p-5">
      <h2 id="changes-h" className={H2}>
        {title}
      </h2>
      {changes.length === 0 ? (
        <p className="m-0 text-sm text-muted">No differences.</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0 text-sm">
          {changes.map((c) => (
            <li key={c.field}>
              <b>{fieldLabel(c.field)}</b>
              <Sub>
                {show(c.from)} → {show(c.to)}
              </Sub>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function History({ events }: { events: RulebookDetail["events"] }) {
  return (
    <Panel className="grid gap-3 p-5">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="hist-h" className={H2}>
          History
        </h2>
        <span className="text-xs text-muted">append-only audit trail</span>
      </div>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {events.toReversed().map((e) => (
          <li key={e.id} className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 text-sm">
            <time dateTime={e.at} className="pt-px font-mono text-xs text-muted">
              {dateTime(e.at)}
            </time>
            <span>
              <b>{eventLabel(e.type)}</b>
              <span>, {e.actorName ?? e.actor}</span>
              {e.type === "RULEBOOK_PUBLISHED" && e.payload.legalReviewConfirmed === true && (
                <span>, legal review confirmed</span>
              )}
            </span>
          </li>
        ))}
        {events.length === 0 && <li className="text-sm text-muted">Stored from the code base version.</li>}
      </ul>
    </Panel>
  );
}
