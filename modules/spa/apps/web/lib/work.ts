import { DEAL_STATES, DealType, SPA_ROLE_LABELS, type SpaRole, type StageKey } from "@spa/core";
import { shortDate } from "./format";

/** The Work list's search params, parsed (C30, S58). Anything that isn't one of ours is dropped, never passed on. */
export interface WorkSearch {
  tab: "deals" | "tasks" | "inbox" | "leads" | "viewings";
  type?: DealType;
  stage?: string;
  q?: string;
  mine?: boolean;
  hold?: boolean;
  default?: boolean;
  cursor?: string;
  /** Tasks tab: a sales manager can read everyone's. */
  scope: "mine" | "all";
  /** Tasks tab: finished tasks instead of open ones. */
  done: boolean;
}
/** The stages the list may filter by: the hold is "ON_HOLD", never its internal name (S57). */
const FILTER_STAGES: ReadonlySet<string> = new Set(["ON_HOLD", ...DEAL_STATES.filter((s) => s !== "AML_HOLD")]);
const WORK_TABS: ReadonlySet<string> = new Set(["tasks", "inbox", "leads", "viewings"]);
type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string | undefined => (typeof v === "string" ? v : undefined);

export function parseWorkSearch(raw: Raw): WorkSearch {
  const out: WorkSearch = {
    tab: WORK_TABS.has(one(raw.tab) ?? "") ? (one(raw.tab) as WorkSearch["tab"]) : "deals",
    scope: one(raw.scope) === "all" ? "all" : "mine",
    done: one(raw.done) === "1",
  };
  const type = DealType.safeParse(one(raw.type));
  if (type.success) out.type = type.data;
  const stage = one(raw.stage);
  if (stage && FILTER_STAGES.has(stage)) out.stage = stage;
  const q = one(raw.q)?.trim().slice(0, 100);
  if (q) out.q = q;
  if (one(raw.mine) === "1") out.mine = true;
  if (one(raw.hold) === "1") out.hold = true;
  if (one(raw.default) === "1") out.default = true;
  const cursor = one(raw.cursor);
  if (cursor && /^[\w-]{1,200}$/.test(cursor)) out.cursor = cursor;
  return out;
}

/** The engine's `GET /api/deals` query string for this search. */
export function dealsQuery(s: WorkSearch): string {
  const p = new URLSearchParams({ limit: "25" });
  if (s.type) p.set("type", s.type);
  if (s.stage) p.set("stage", s.stage);
  if (s.q) p.set("q", s.q);
  if (s.mine) p.set("mine", "true");
  if (s.hold) p.set("hold", "true");
  if (s.default) p.set("default", "true");
  if (s.cursor) p.set("cursor", s.cursor);
  return p.toString();
}

type Patch = { [K in keyof WorkSearch]?: WorkSearch[K] | undefined };
/** A link to the Work list with this search plus the changes; a change of filter drops the page cursor. */
export function workHref(s: WorkSearch, patch: Patch): string {
  const { cursor: _dropped, ...rest } = s;
  const m: WorkSearch = { ...rest };
  for (const [k, v] of Object.entries(patch)) (m as unknown as Record<string, unknown>)[k] = v;
  const p = new URLSearchParams();
  if (m.tab !== "deals") p.set("tab", m.tab);
  if (m.tab === "inbox" || m.tab === "leads" || m.tab === "viewings") {
    // the inbox has no filters: only its page
  } else if (m.tab === "tasks") {
    if (m.scope === "all") p.set("scope", "all");
    if (m.done) p.set("done", "1");
  } else {
    if (m.type) p.set("type", m.type);
    if (m.stage) p.set("stage", m.stage);
    if (m.q) p.set("q", m.q);
    if (m.mine) p.set("mine", "1");
    if (m.hold) p.set("hold", "1");
    if (m.default) p.set("default", "1");
  }
  if ("cursor" in patch && patch.cursor) p.set("cursor", patch.cursor);
  const qs = p.toString();
  return qs ? `/work?${qs}` : "/work";
}

/** Pill tone for a stage (design §6.1): done is accent, a hold is a warning, everything else neutral. */
export function stageTone(stage: StageKey): "accent" | "warning" | "neutral" {
  if (stage === "ON_HOLD" || stage === "AML_HOLD") return "warning";
  if (stage === "COMPLETED" || stage === "HANDED_OVER") return "accent";
  return "neutral";
}

/** The engine's label for a compliance review (the same words); a non-compliance viewer is given this and no role. */
export const COMPLIANCE_LABEL = "Compliance review";

export interface WaitingView {
  role: SpaRole | null;
  label: string;
  since: string;
  waitedDays: number;
}
/** What the banner and the list say: the step, the role (never a gate's detail), the date and whether it is the viewer's. */
export function waitingParts(w: WaitingView | null, viewer: SpaRole) {
  if (!w) return null;
  return {
    headline: w.label,
    who: w.role ? SPA_ROLE_LABELS[w.role] : null,
    since: shortDate(w.since),
    mine: w.role === viewer,
    days: w.waitedDays,
  };
}

/** The engine lets a task's own role, or a sales manager, finish it (S55); the button follows the same rule. */
export const canFinishTask = (task: { role: SpaRole; status: string }, viewer: SpaRole): boolean =>
  task.status === "open" && (task.role === viewer || viewer === "sales_manager");

/** The rail badge for Work: what waits for this role (open gates it decides, plus its tasks). Nothing when zero. */
export const waitingCount = (
  s: {
    inbox: { open: number };
    tasks: { open: number };
    leads?: { viewings: number; newLeads: number } | undefined;
  } | null,
): number => (s ? s.inbox.open + s.tasks.open + (s.leads ? s.leads.viewings + s.leads.newLeads : 0) : 0);
