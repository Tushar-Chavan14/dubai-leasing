import type { ReactNode } from "react";
import { dateTime, eventLabel } from "../../../../lib/format";
import { fieldLabel, type RulebookDetail, show } from "./labels";

/** Read-only pieces of the rulebook views (server and client). */
export function FactRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {children}
        <div className="row-sub">{hint}</div>
      </dd>
    </>
  );
}

export function ReferenceNotes({ notes }: { notes: RulebookDetail["referenceRules"] }) {
  return (
    <section className="panel panel-pad" aria-labelledby="notes-h">
      <h2 id="notes-h" className="section-title">
        Reference notes
      </h2>
      {notes.length === 0 ? (
        <p className="muted">No reference notes in this version.</p>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {notes.map((n) => (
            <div key={n.id}>
              <b>{n.title}</b>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{n.text}</p>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
        Written by the company for staff and the copilot. Not law, and the engine does not enforce them.
      </p>
    </section>
  );
}

export function Sources({ sources }: { sources: string[] }) {
  return (
    <section className="panel panel-pad" aria-labelledby="sources-h">
      <h2 id="sources-h" className="section-title">
        Sources
      </h2>
      {sources.length === 0 ? (
        <p className="muted">None listed.</p>
      ) : (
        <ul className="stack" style={{ gap: 6, fontSize: 14, paddingLeft: 18, listStyle: "disc" }}>
          {sources.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ChangesList({ title, changes }: { title: string; changes: RulebookDetail["changesVsActive"] }) {
  return (
    <section className="panel panel-pad" aria-labelledby="changes-h">
      <h2 id="changes-h" className="section-title">
        {title}
      </h2>
      {changes.length === 0 ? (
        <p className="muted">No differences.</p>
      ) : (
        <ul className="stack" style={{ gap: 8, fontSize: 14 }}>
          {changes.map((c) => (
            <li key={c.field}>
              <b>{fieldLabel(c.field)}</b>
              <div className="row-sub">
                {show(c.from)} → {show(c.to)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function History({ events }: { events: RulebookDetail["events"] }) {
  return (
    <section className="panel" aria-labelledby="hist-h">
      <div className="panel-head">
        <h2 id="hist-h">History</h2>
        <span className="hint">append-only audit trail</span>
      </div>
      <ul className="feed">
        {events.toReversed().map((e) => (
          <li key={e.id}>
            <span className="dot" {...(e.type === "RULEBOOK_PUBLISHED" ? { "data-tone": "good" } : {})} />
            <span className="what">
              <b>{eventLabel(e.type)}</b>
              <span>, {e.actorName ?? e.actor}</span>
              {e.type === "RULEBOOK_PUBLISHED" && e.payload.legalReviewConfirmed === true && (
                <span>, legal review confirmed</span>
              )}
            </span>
            <time dateTime={e.at}>{dateTime(e.at)}</time>
          </li>
        ))}
        {events.length === 0 && (
          <li>
            <span className="what muted">Stored from the code base version.</span>
          </li>
        )}
      </ul>
    </section>
  );
}
