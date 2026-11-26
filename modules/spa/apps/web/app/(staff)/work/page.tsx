import { ALERT } from "@platform/ui/settings";
import { PageTitle } from "@platform/ui/page";
import { TabLinks } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { webEnv } from "../../../lib/env";
import { InboxList } from "../../../components/inbox";
import { LeadsTable } from "../../../components/leads-table";
import { ViewingsList } from "../../../components/viewings-list";
import { DealTable } from "../../../components/deal-table";
import { TaskList } from "../../../components/task-list";
import { WorkFilters } from "../../../components/work-filters";
import { engineGet } from "../../../lib/engine";
import {
  loadDeals,
  loadInbox,
  loadLeads,
  loadNoteDraft,
  loadSummary,
  loadTasks,
  loadViewings,
} from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";
import { railItems } from "@spa/core/roles";
import { parseWorkSearch, workHref } from "../../../lib/work";
import { decideApproval } from "../decide";
import { markTaskDone } from "./actions";

export const metadata: Metadata = { title: "Work" };

const SALES = ["sales_officer", "sales_manager", "sales_admin"];
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Work (design §4.2): the deals the role may read, by type and stage, and its tasks. Reads only; the filters are in the address. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, item } = await requireScreen("work");
  const raw = await searchParams;
  const search = parseWorkSearch(raw);
  const summary = await loadSummary(engineGet);
  const sales = SALES.includes(user.role);
  const counts = {
    deals: summary?.deals.open ?? 0,
    tasks: summary?.tasks.open ?? 0,
    inbox: summary?.inbox.open ?? 0,
    // M5 (S79): leads and viewings are for the sales roles; the numbers are new leads and today's viewings.
    ...(sales ? { leads: summary?.leads?.newLeads ?? 0, viewings: summary?.leads?.viewings ?? 0 } : {}),
  };
  const lede = item.readOnly
    ? "Everything open for your role. You can look; an admin changes settings."
    : "Everything open for your role.";
  const taskFailed = raw.error === "task";
  const rail = railItems(user.role, user.companyKind);
  const catalogue = {
    listings: rail.some((i) => i.screen === "listings"),
    inventory: rail.some((i) => i.screen === "inventory"),
  };

  if (sales && (search.tab === "leads" || search.tab === "viewings")) {
    // A manager starts on everyone's; an officer only ever sees their own (the engine enforces it).
    const scope =
      one(raw.scope) === "mine"
        ? "mine"
        : one(raw.scope) === "all"
          ? "all"
          : user.role === "sales_officer"
            ? "mine"
            : "all";
    const href = (tab: string, extra: Record<string, string | undefined>) => {
      const p = new URLSearchParams({ tab, scope });
      for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
      return `/work?${p.toString()}`;
    };
    if (search.tab === "leads") {
      const filters = {
        status: one(raw.status),
        source: one(raw.source),
        property: one(raw.property)?.trim().slice(0, 80),
      };
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
      if (scope === "mine") q.set("mine", "1");
      const leads = await loadLeads(engineGet, q.toString());
      if (!leads) notFound();
      return (
        <div className="grid gap-6">
          <PageTitle title="Work" lede={lede} />
          <WorkFilters search={search} counts={counts} catalogue={catalogue} />
          <LeadsTable
            data={leads}
            filters={filters}
            mineHref={href("leads", { ...filters, scope: undefined }).replace(/scope=\w+/, "scope=mine")}
            allHref={href("leads", { ...filters, scope: undefined }).replace(/scope=\w+/, "scope=all")}
          />
        </div>
      );
    }
    const when = ["today", "upcoming", "past"].includes(one(raw.when) ?? "") ? (one(raw.when) as string) : "today";
    const viewings = await loadViewings(
      engineGet,
      new URLSearchParams({ when, ...(scope === "mine" ? { mine: "1" } : {}) }).toString(),
    );
    if (!viewings) notFound();
    return (
      <div className="grid gap-6">
        <PageTitle title="Work" lede={lede} />
        <WorkFilters search={search} counts={counts} catalogue={catalogue} />
        <ViewingsList
          data={viewings}
          base={(patch) =>
            href("viewings", { when: patch.when ?? when }).replace(/scope=\w+/, `scope=${patch.scope ?? scope}`)
          }
        />
      </div>
    );
  }

  if (search.tab === "inbox") {
    const inbox = await loadInbox(engineGet, search.cursor);
    if (!inbox) notFound();
    const draft = await loadNoteDraft(engineGet, typeof raw.draft === "string" ? raw.draft : undefined);
    return (
      <div className="grid gap-6">
        <PageTitle title="Work" lede={lede} />
        <WorkFilters search={search} counts={counts} catalogue={catalogue} />
        <div id="inbox" className="scroll-mt-4">
          <InboxList
            items={inbox.items}
            viewer={user.role}
            decideAction={decideApproval}
            demo={webEnv().SPA_DEMO_MODE}
            from="work"
            draft={draft}
            error={typeof raw.error === "string" ? raw.error : undefined}
            next={inbox.nextCursor ? { href: workHref(search, { cursor: inbox.nextCursor }) } : null}
          />
        </div>
      </div>
    );
  }

  if (search.tab === "tasks") {
    const tasks = await loadTasks(engineGet, search);
    if (!tasks) notFound();
    const manager = user.role === "sales_manager";
    return (
      <div className="grid gap-6">
        <PageTitle title="Work" lede={lede} />
        <WorkFilters search={search} counts={counts} catalogue={catalogue} />
        <TabLinks
          label="Task list"
          items={[
            { href: workHref(search, { done: false }), label: "Open", current: !search.done },
            { href: workHref(search, { done: true }), label: "Done", current: search.done },
            ...(manager
              ? [
                  { href: workHref(search, { scope: "mine" }), label: "Mine", current: search.scope === "mine" },
                  { href: workHref(search, { scope: "all" }), label: "Everyone's", current: search.scope === "all" },
                ]
              : []),
          ]}
        />
        {taskFailed && (
          <p role="alert" className={ALERT.bad}>
            That task could not be finished. It may already be done, or it is not for your role.
          </p>
        )}
        <TaskList
          tasks={tasks.items}
          viewer={user.role}
          doneAction={markTaskDone}
          emptyTitle={search.done ? "No finished tasks." : "No open tasks."}
        />
      </div>
    );
  }

  const deals = await loadDeals(engineGet, search);
  if (!deals) notFound();
  return (
    <div className="grid gap-6">
      <PageTitle title="Work" lede={lede} />
      <WorkFilters search={search} counts={counts} catalogue={catalogue} />
      <DealTable
        deals={deals.items}
        viewer={user.role}
        next={deals.nextCursor ? { href: workHref(search, { cursor: deals.nextCursor }) } : null}
      />
    </div>
  );
}
