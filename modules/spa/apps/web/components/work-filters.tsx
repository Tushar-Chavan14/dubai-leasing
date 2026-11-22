import { buttonClass } from "@platform/ui/button";
import { TabLinks } from "@platform/ui/page";
import { SET_INPUT, SET_SELECT } from "@platform/ui/settings";
import { DEAL_STATES, DealType, stageLabel, type StageKey } from "@spa/core";
import { type WorkSearch, workHref } from "../lib/work";

const TYPES: { value: DealType; label: string }[] = [
  { value: "primary_offplan", label: "Primary off-plan" },
  { value: "resale_ready", label: "Ready resale" },
  { value: "resale_offplan", label: "Off-plan resale" },
];
/** The stages a sales role may filter by: the hold is "On hold", never by its internal name (S57). */
const STAGES: StageKey[] = ["ON_HOLD", ...DEAL_STATES.filter((s) => s !== "AML_HOLD")];

/** Tabs, then on Deals the type, "mine / on hold / in default", the stage and the search (design §4.2). Plain links and one GET form. */
export function WorkFilters({
  search,
  counts,
  catalogue,
}: {
  search: WorkSearch;
  counts: { deals: number; tasks: number; inbox?: number };
  /** The screens the role has for this company kind (C32, S64): each is a tab that opens its own page. */
  catalogue?: { listings: boolean; inventory: boolean };
}) {
  const tabs = [
    ...(counts.inbox === undefined
      ? []
      : [{ href: "/work?tab=inbox", label: "Inbox", count: counts.inbox, current: search.tab === "inbox" }]),
    { href: "/work", label: "Deals", count: counts.deals, current: search.tab === "deals" },
    ...(catalogue?.listings ? [{ href: "/listings", label: "Listings", current: false }] : []),
    ...(catalogue?.inventory ? [{ href: "/inventory", label: "Inventory", current: false }] : []),
    { href: "/work?tab=tasks", label: "Tasks", count: counts.tasks, current: search.tab === "tasks" },
  ];
  return (
    <div className="grid gap-3">
      <TabLinks label="Work" items={tabs} />
      {search.tab === "deals" && (
        <>
          <TabLinks
            label="Deal type"
            items={[
              {
                href: workHref(search, { type: undefined, stage: undefined }),
                label: "All types",
                current: !search.type,
              },
              ...TYPES.map((t) => ({
                href: workHref(search, { type: t.value }),
                label: t.label,
                current: search.type === t.value,
              })),
            ]}
          />
          <TabLinks
            label="Show only"
            items={[
              {
                href: workHref(search, { mine: search.mine ? undefined : true }),
                label: "Mine",
                current: !!search.mine,
              },
              {
                href: workHref(search, { hold: search.hold ? undefined : true }),
                label: "On hold",
                current: !!search.hold,
              },
              {
                href: workHref(search, { default: search.default ? undefined : true }),
                label: "In default",
                current: !!search.default,
              },
            ]}
          />
          <form action="/work" method="get" role="search" className="flex flex-wrap items-end gap-2">
            {search.type && <input type="hidden" name="type" value={search.type} />}
            {search.mine && <input type="hidden" name="mine" value="1" />}
            {search.hold && <input type="hidden" name="hold" value="1" />}
            {search.default && <input type="hidden" name="default" value="1" />}
            <label className="grid gap-1 text-xs text-muted">
              Search
              <input
                type="search"
                name="q"
                defaultValue={search.q ?? ""}
                maxLength={100}
                placeholder="Ref, party or unit"
                className={`${SET_INPUT} w-64`}
              />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Stage
              <select name="stage" defaultValue={search.stage ?? ""} className={`${SET_SELECT} w-56`}>
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {stageLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClass("ghost", "sm")}>
              Apply
            </button>
          </form>
        </>
      )}
    </div>
  );
}
