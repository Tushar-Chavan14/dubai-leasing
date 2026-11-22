import { EmptyState } from "@platform/ui/empty-state";
import { ROW_CARD, Sub } from "@platform/ui/record";
import { Section } from "@platform/ui/record";
import { stageLabel, type StageKey } from "@spa/core";
import Link from "next/link";
import type { Summary, TaskItem } from "../lib/contracts";
import { shortDate } from "../lib/format";

export interface WaitingGate {
  id: string;
  title: string;
  gateLabel: string;
  createdAt: string;
  entityRef: string | null;
  entityId: string | null;
}

const hrefFor = (stage: string) => (stage === "ON_HOLD" ? "/work?hold=1" : `/work?stage=${stage}`);

/** Home (design §4.1): what waits for the role, oldest first, then the open deals by stage as links into Work. Read only. */
export function HomeView({
  summary,
  tasks,
  gates,
  canWork = true,
  inboxHref,
  catalogue,
}: {
  summary: Summary;
  tasks: TaskItem[];
  gates: WaitingGate[];
  /** A role with no Work screen sees the counts without links. */
  canWork?: boolean;
  /** Where a waiting gate is decided (C31): Work's inbox by default, or the screen a role without Work uses. */
  inboxHref?: string | undefined;
  /** The screens the role has for this company kind (C32, S64). */
  catalogue?: { listings: boolean; inventory: boolean } | undefined;
}) {
  const decideAt = inboxHref ?? (canWork ? "/work?tab=inbox" : null);
  const stages = Object.entries(summary.deals.byStage).toSorted(([a], [b]) => a.localeCompare(b));
  const waiting = gates.length + tasks.length;
  return (
    <div className="grid gap-8">
      <Section
        id="waiting"
        title="Waiting for you"
        hint={`${summary.inbox.open} to decide · ${summary.tasks.open} tasks`}
      >
        {waiting ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {gates.map((g) => (
              <li key={g.id} className={`${ROW_CARD} m-0 flex flex-wrap items-center gap-x-4 gap-y-1`}>
                <div className="min-w-0 flex-1">
                  <b className="block font-semibold">{g.gateLabel}</b>
                  <Sub>{[g.entityRef, g.title, `since ${shortDate(g.createdAt)}`].filter(Boolean).join(" · ")}</Sub>
                </div>
                {decideAt && (
                  <Link href={decideAt} className="text-[13px] text-ink underline underline-offset-2">
                    Decide<span className="sr-only">: {g.gateLabel}</span>
                  </Link>
                )}
                {canWork && g.entityId && (
                  <Link
                    href={`/work/deals/${g.entityId}`}
                    className="text-[13px] text-ink underline underline-offset-2"
                  >
                    Open deal
                  </Link>
                )}
              </li>
            ))}
            {tasks.map((t) => (
              <li key={t.id} className={`${ROW_CARD} m-0 flex flex-wrap items-center gap-x-4 gap-y-1`}>
                <div className="min-w-0 flex-1">
                  <b className="block font-semibold">{t.title}</b>
                  <Sub>Task · opened {shortDate(t.createdAt)}</Sub>
                </div>
                {canWork && t.dealId && (
                  <Link href={`/work/deals/${t.dealId}`} className="text-[13px] text-ink underline underline-offset-2">
                    Open deal
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nothing is waiting for you."
            body="Approvals and tasks for your role will appear here, oldest first."
          />
        )}
      </Section>
      {(catalogue?.inventory || catalogue?.listings) && (
        <Section id="browse" title="Browse">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {catalogue.inventory && (
              <li className="m-0">
                <Link
                  href="/inventory"
                  className="inline-flex rounded-full border border-line px-3 py-1.5 text-[13px] text-ink! no-underline hover:border-ink"
                >
                  Inventory
                </Link>
              </li>
            )}
            {catalogue.listings && (
              <li className="m-0">
                <Link
                  href="/listings"
                  className="inline-flex rounded-full border border-line px-3 py-1.5 text-[13px] text-ink! no-underline hover:border-ink"
                >
                  Listings
                </Link>
              </li>
            )}
          </ul>
        </Section>
      )}
      {stages.length > 0 && (
        <Section
          id="glance"
          title="Open deals by stage"
          hint={`${summary.deals.open} open · ${summary.deals.mine} yours`}
        >
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {stages.map(([stage, n]) => (
              <li key={stage} className="m-0">
                {canWork ? (
                  <Link
                    href={hrefFor(stage)}
                    className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink! no-underline hover:border-ink"
                  >
                    {stageLabel(stage as StageKey)}
                    <span className="font-mono text-xs text-muted">{n}</span>
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px]">
                    {stageLabel(stage as StageKey)}
                    <span className="font-mono text-xs text-muted">{n}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
