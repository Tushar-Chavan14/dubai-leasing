import Link from "next/link";
import { stageLabel } from "../../../lib/stage-label";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { AskAiMenu } from "../../../components/ask-ai";
import { Pill } from "../../../components/ui/pill";
import { buttonClass } from "../../../components/ui/button";
import { askPrompts } from "../../../lib/ask-ai/prompts";
import { roleLabel } from "../../../lib/format";
import { type Owner, type RecordRow, type SavedView, STAGES } from "../../../lib/types";
import { SavedViews } from "./views";
import { type WorkQuery, workHref } from "./url";

const ownerLabel = (o: Owner, mine: boolean) =>
  mine ? "You" : o === "agent" ? "Agent" : o === "applicant" ? "Applicant" : o === "tenant" ? "Tenant" : roleLabel(o);

const SEG =
  "flex-1 rounded-full px-2 py-1.5 text-center font-sans text-[12.5px] text-muted no-underline aria-[current=true]:bg-page aria-[current=true]:font-semibold aria-[current=true]:text-ink! aria-[current=true]:shadow-[0_1px_2px_rgb(0_0_0/0.08)] focus-visible:outline-2 focus-visible:outline-ink";
const KIND =
  "rounded-full border border-line px-2.5 py-1 font-sans text-xs text-ink no-underline hover:border-ink aria-[current=page]:border-transparent aria-[current=page]:bg-primary aria-[current=page]:text-on-primary! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Left column: title and New application, the Waiting/Everything switch, search, Applications/Leases, and the records by stage. */
export function RecordList({
  rows,
  views,
  query,
  mine,
  tab,
  counts,
}: {
  /** Which kind of record the list shows (the Workspace tab). */
  tab: "application" | "lease";
  rows: RecordRow[];
  views: SavedView[];
  query: WorkQuery;
  /** The list is filtered to records waiting for the user (the "waiting" view or a saved one). */
  mine: boolean;
  counts: { application: number; lease: number };
}) {
  const groups = STAGES.map((stage) => ({ stage, rows: rows.filter((r) => r.stage === stage) })).filter(
    (g) => g.rows.length > 0,
  );
  const filtered = !!(query.q || query.stage || query.view === "waiting");
  const kindHref = (kind: "application" | "lease") =>
    workHref(query, { kind, id: undefined, entry: undefined, pane: undefined, new: undefined, stage: undefined });
  const listAsk = askPrompts.workList(tab === "lease" ? "leases" : "applications");
  const everything = !query.view;
  return (
    <aside
      aria-label="Records"
      className="flex min-h-0 flex-col overflow-y-auto overscroll-contain border-line @[760px]:border-r @max-[759px]:group-data-[has=true]/wk:hidden"
    >
      <header className="grid gap-2.5 px-3.5 pb-2.5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="m-0 font-sans text-xl whitespace-nowrap font-semibold tracking-tight text-ink">Workspace</h1>
          <Link
            href={workHref(query, { new: true })}
            title="Start an application for a walk-in or phone enquiry"
            className={`${buttonClass("primary", "sm")} whitespace-nowrap`}
          >
            <PlusIcon size={14} weight="bold" aria-hidden />
            New application
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AskAiMenu label="Ask AI" prompts={listAsk} />
          <Link
            href={tab === "lease" ? "/leases" : "/applications"}
            className="text-[12.5px] text-muted! underline-offset-2 hover:underline"
          >
            Table view
          </Link>
        </div>
        <nav aria-label="Views" className="flex rounded-full bg-raised p-[3px]">
          <Link
            href={`/work?view=waiting&kind=${tab}`}
            className={SEG}
            aria-current={query.view === "waiting" ? "true" : undefined}
          >
            Waiting for me
          </Link>
          <Link
            href={`/work?kind=${tab}`}
            className={SEG}
            aria-current={everything && !query.stage ? "true" : undefined}
          >
            Everything
          </Link>
        </nav>
        <form action="/work" role="search" className="relative">
          <label htmlFor="wk-q" className="sr-only">
            Search records
          </label>
          <MagnifyingGlassIcon
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="wk-q"
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder="Search name, unit or ref"
            className="h-9 w-full rounded-full border border-line bg-page pl-9 pr-3 font-sans text-sm text-ink placeholder:text-muted focus:border-ink"
          />
          <input type="hidden" name="kind" value={tab} />
          {query.stage && <input type="hidden" name="stage" value={query.stage} />}
          {query.view && <input type="hidden" name="view" value={query.view} />}
        </form>
        <nav aria-label="Kind of record" className="flex flex-wrap gap-1.5">
          {(
            [
              ["application", "Applications"],
              ["lease", "Leases"],
            ] as const
          ).map(([kind, label]) => (
            <Link key={kind} href={kindHref(kind)} className={KIND} aria-current={tab === kind ? "page" : undefined}>
              {label} <span className="font-mono opacity-70">{counts[kind]}</span>
            </Link>
          ))}
        </nav>
        <SavedViews
          views={views}
          activeView={query.view}
          filter={{ stage: query.stage ?? "", q: query.q ?? "", mine }}
          canSave={filtered}
          kind={tab}
          clearStageHref={workHref({ ...query, kind: tab, id: undefined, entry: undefined }, { stage: undefined })}
          stage={query.stage}
        />
      </header>

      <div className="px-2 pb-3">
        {groups.length === 0 ? (
          <p className="m-0 px-2 py-5 text-sm text-muted">
            {mine ? "Nothing waiting for you. Nice." : "No records match this view."}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.stage} aria-labelledby={`wk-g-${g.stage}`}>
              <h2
                id={`wk-g-${g.stage}`}
                className="m-0 flex justify-between px-2 pb-1.5 pt-3 font-sans text-xs font-normal text-muted"
              >
                <span>{stageLabel(g.stage)}</span>
                <span className="font-mono">{g.rows.length}</span>
              </h2>
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {g.rows.map((r) => {
                  const selected = query.kind === r.kind && query.id === r.id;
                  return (
                    <li key={`${r.kind}:${r.id}`}>
                      <Link
                        href={workHref(query, { kind: r.kind, id: r.id, entry: undefined, pane: undefined })}
                        aria-current={selected ? "true" : undefined}
                        className="group/row grid gap-0.5 rounded-xl p-2.5 text-ink no-underline hover:bg-raised aria-[current=true]:bg-accent aria-[current=true]:text-on-accent! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
                      >
                        <span className="flex items-center justify-between gap-2 font-medium">
                          <span className="min-w-0 truncate">{r.title}</span>
                          {r.waitingForMe ? (
                            <Pill
                              tone="waiting"
                              className="shrink-0 text-[11px] group-aria-[current=true]/row:bg-black/10 group-aria-[current=true]/row:text-on-accent"
                            >
                              Needs you
                            </Pill>
                          ) : (
                            <span className="shrink-0 text-xs font-normal opacity-70">
                              {ownerLabel(r.owner, false)}
                            </span>
                          )}
                        </span>
                        <span className="flex justify-between gap-2 text-[12.5px] opacity-75">
                          <span className="min-w-0 truncate">{r.unitCode}</span>
                          <span className="shrink-0 font-mono text-[11px]">{r.ref}</span>
                        </span>
                        <span className="line-clamp-2 text-[12.5px] opacity-75">{r.nextStep}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
