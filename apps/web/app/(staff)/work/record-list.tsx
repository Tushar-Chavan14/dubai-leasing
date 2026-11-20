import Link from "next/link";
import { stageLabel } from "../../../lib/stage-label";
import {
  BriefcaseIcon,
  HandPointingIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SparkleIcon,
  UserIcon,
} from "@phosphor-icons/react/dist/ssr";
import { buttonClass } from "../../../components/ui/button";
import { roleLabel } from "../../../lib/format";
import { type Owner, type RecordRow, type SavedView, STAGES } from "../../../lib/types";
import { SavedViews } from "./views";
import { type WorkQuery, workHref } from "./url";

const ownerLabel = (o: Owner, mine: boolean) =>
  mine ? "You" : o === "agent" ? "Agent" : o === "applicant" ? "Applicant" : o === "tenant" ? "Tenant" : roleLabel(o);

/** Who the record sits with now, as a small label: you (amber), the agent (blue), the applicant or tenant, or a team. */
function OwnerTag({ owner, mine }: { owner: Owner; mine: boolean }) {
  const [Icon, tone] = mine
    ? [HandPointingIcon, "bg-warning/12 text-warning"]
    : owner === "agent"
      ? [SparkleIcon, "bg-accent text-on-accent"]
      : owner === "applicant" || owner === "tenant"
        ? [UserIcon, "bg-success/12 text-success"]
        : [BriefcaseIcon, "bg-raised text-muted ring-1 ring-line"];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold leading-none ${tone}`}
    >
      <Icon size={11} weight="bold" aria-hidden />
      <span className="sr-only">With </span>
      {mine ? "Needs you" : ownerLabel(owner, false)}
    </span>
  );
}

const CHIP =
  "inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1.5 font-sans text-[12px] font-semibold no-underline ring-1 ring-line bg-page text-muted! hover:text-ink! aria-[current=true]:bg-ink aria-[current=true]:text-page! aria-[current=true]:ring-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const COUNT = "font-mono text-[11px] font-medium opacity-70";

/**
 * Left column: title and New application, search, then three chips (All, Needs me, With agent) over one list of
 * applications and leases grouped by stage.
 */
export function RecordList({
  rows,
  views,
  query,
  counts,
}: {
  rows: RecordRow[];
  views: SavedView[];
  query: WorkQuery;
  counts: { all: number; waiting: number; agent: number };
}) {
  const groups = STAGES.map((stage) => ({ stage, rows: rows.filter((r) => r.stage === stage) })).filter(
    (g) => g.rows.length > 0,
  );
  const mine = query.view === "waiting";
  // Only a search or stage filter is worth saving; the chips (All, Needs me, With agent) are already one click.
  const filtered = !!(query.q || query.stage) && !query.view;
  // Chips keep the open record and the search; they only change the view.
  const chip = (view: string | undefined) => workHref(query, { view, entry: undefined, new: undefined });
  return (
    <aside
      aria-label="Records"
      className="flex min-h-0 flex-col overflow-y-auto overscroll-contain border-line @[760px]:border-r @max-[759px]:group-data-[has=true]/wk:hidden"
    >
      <header className="grid gap-3 px-3.5 pb-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="m-0 font-sans text-xl whitespace-nowrap font-bold tracking-tight text-ink">Workspace</h1>
          <Link
            href={workHref(query, { new: true })}
            title="Start an application for a walk-in or phone enquiry"
            className={`${buttonClass("primary", "sm")} whitespace-nowrap`}
          >
            <PlusIcon size={14} weight="bold" aria-hidden />
            New
          </Link>
        </div>
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
            className="h-9 w-full rounded-full border border-line bg-page pl-9 pr-3 font-sans text-sm text-ink placeholder:text-muted focus:border-primary"
          />
          {query.stage && <input type="hidden" name="stage" value={query.stage} />}
          {query.view && <input type="hidden" name="view" value={query.view} />}
        </form>
        <nav aria-label="Show" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          <Link href={chip(undefined)} className={CHIP} aria-current={!query.view ? "true" : undefined}>
            All <span className={COUNT}>{counts.all}</span>
          </Link>
          <Link href={chip("waiting")} className={CHIP} aria-current={mine ? "true" : undefined}>
            {counts.waiting > 0 && <span aria-hidden className="size-1.5 rounded-full bg-warning" />}
            Needs me <span className={COUNT}>{counts.waiting}</span>
          </Link>
          <Link
            href={chip("agent")}
            className={CHIP}
            aria-current={query.view === "agent" ? "true" : undefined}
            title="Records the agent is moving forward on its own"
          >
            <SparkleIcon size={12} weight="fill" aria-hidden className="text-primary" />
            With agent <span className={COUNT}>{counts.agent}</span>
          </Link>
        </nav>
        <SavedViews
          views={views}
          activeView={query.view}
          filter={{ stage: query.stage ?? "", q: query.q ?? "", mine }}
          canSave={filtered}
          clearStageHref={workHref({ ...query, id: undefined, entry: undefined }, { stage: undefined })}
          stage={query.stage}
        />
      </header>

      <div className="px-2.5 pb-4">
        {groups.length === 0 ? (
          <p className="m-0 px-2 py-5 text-sm text-muted">
            {mine
              ? "Nothing waiting for you. Nice."
              : query.view === "agent"
                ? "The agent isn't handling anything on its own right now."
                : "No records match this view."}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.stage} aria-labelledby={`wk-g-${g.stage}`} className="mt-3 first:mt-1">
              <h2
                id={`wk-g-${g.stage}`}
                className="sticky top-0 z-10 m-0 -mx-2.5 flex items-center gap-2 bg-canvas/95 px-3 py-2 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-ink backdrop-blur"
              >
                <span>{stageLabel(g.stage)}</span>
                <span aria-hidden className="h-px flex-1 bg-line" />
                <span className="rounded-full bg-page px-2 py-0.5 font-mono text-[11px] font-semibold tracking-normal text-muted ring-1 ring-line">
                  {g.rows.length}
                  <span className="sr-only"> {g.rows.length === 1 ? "record" : "records"}</span>
                </span>
              </h2>
              <ul className="m-0 grid list-none gap-2 p-0">
                {g.rows.map((r) => {
                  const selected = query.kind === r.kind && query.id === r.id;
                  return (
                    <li key={`${r.kind}:${r.id}`}>
                      <Link
                        href={workHref(query, {
                          kind: r.kind,
                          id: r.id,
                          entry: undefined,
                          pane: undefined,
                          log: undefined,
                        })}
                        aria-current={selected ? "true" : undefined}
                        className="grid gap-1 rounded-xl border border-line bg-page px-3 py-2.5 text-ink no-underline shadow-[0_1px_2px_rgb(16_28_77/0.04)] transition-colors duration-150 hover:border-primary/40 aria-[current=true]:border-primary aria-[current=true]:bg-accent aria-[current=true]:ring-1 aria-[current=true]:ring-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[14px] font-semibold">{r.title}</span>
                          <OwnerTag owner={r.owner} mine={r.waitingForMe} />
                        </span>
                        <span className="flex items-center gap-1.5 text-[12px] text-muted">
                          <span className="min-w-0 truncate">{r.unitCode}</span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0 font-mono text-[11px]">{r.ref}</span>
                        </span>
                        <span className="line-clamp-2 text-[12.5px] text-muted">{r.nextStep}</span>
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
