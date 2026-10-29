import Link from "next/link";
import { roleLabel } from "../../../lib/format";
import { type Owner, type RecordRow, type SavedView, STAGES } from "../../../lib/types";
import { SavedViews } from "./views";
import { type WorkQuery, workHref } from "./url";

const ownerLabel = (o: Owner, mine: boolean) =>
  mine ? "You" : o === "agent" ? "Agent" : o === "applicant" ? "Applicant" : o === "tenant" ? "Tenant" : roleLabel(o);

/** Left pane: search, saved views, and the records grouped by stage. */
export function RecordList({
  rows,
  views,
  query,
  mine,
}: {
  rows: RecordRow[];
  views: SavedView[];
  query: WorkQuery;
  /** The list is filtered to records waiting for the user (the "waiting" view or a saved one). */
  mine: boolean;
}) {
  const groups = STAGES.map((stage) => ({ stage, rows: rows.filter((r) => r.stage === stage) })).filter(
    (g) => g.rows.length > 0,
  );
  const filtered = !!(query.q || query.stage || query.view === "waiting");
  return (
    <aside className="wk-list" aria-label="Records">
      <form action="/work" role="search" className="wk-search">
        <label htmlFor="wk-q" className="sr-only">
          Search records
        </label>
        <input id="wk-q" type="search" name="q" defaultValue={query.q ?? ""} placeholder="Search name, unit or ref" />
        {query.stage && <input type="hidden" name="stage" value={query.stage} />}
        {query.view && <input type="hidden" name="view" value={query.view} />}
      </form>

      <SavedViews
        views={views}
        activeView={query.view}
        filter={{ stage: query.stage ?? "", q: query.q ?? "", mine }}
        canSave={filtered}
        clearHref="/work"
        clearStageHref={workHref({ ...query, kind: undefined, id: undefined, entry: undefined }, { stage: undefined })}
        stage={query.stage}
      />

      {groups.length === 0 ? (
        <p className="wk-empty">No records match this view.</p>
      ) : (
        groups.map((g) => (
          <section key={g.stage} aria-labelledby={`wk-g-${g.stage}`}>
            <h2 id={`wk-g-${g.stage}`} className="wk-group">
              {g.stage} <span className="num">{g.rows.length}</span>
            </h2>
            <ul className="wk-rows">
              {g.rows.map((r) => {
                const selected = query.kind === r.kind && query.id === r.id;
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <Link
                      href={workHref(query, { kind: r.kind, id: r.id, entry: undefined, pane: undefined })}
                      className="wk-row"
                      aria-current={selected ? "true" : undefined}
                      data-waiting={r.waitingForMe ? "true" : undefined}
                    >
                      <span className="wk-row-top">
                        <span className="ref">{r.ref}</span>
                        <span className="wk-owner">{ownerLabel(r.owner, r.waitingForMe)}</span>
                      </span>
                      <span className="wk-row-name">{r.title}</span>
                      <span className="wk-row-unit">{r.unitCode}</span>
                      <span className="wk-row-next">{r.nextStep}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </aside>
  );
}
