import type { z } from "zod";
import {
  AlertSettingsView,
  CompanyView,
  DemoClockView,
  IntegrationsView,
  ModelsView,
  PlansView,
  RulebookView,
  SigningView,
  UsersView,
  AlertsView,
  AmlPolicyView,
  CopilotDraftView,
  KycDetail,
  KycIndex,
  TemplateList,
  TemplateRecord,
  TemplateVersionView,
  CasesPage,
  CaseView,
  type CaseTab,
  DealsPage,
  ExportLogView,
  ReportList,
  RetentionList,
  HelperSettings,
  EventsPage,
  InboxPage,
  ListingRecord,
  ListingsPage,
  ProjectRecord,
  ProjectsList,
  type RecordSections,
  RecordView,
  readSections,
  Summary,
  TasksPage,
} from "./contracts";
import type { WaitingGate } from "../components/home-view";
import { dealsQuery, type WorkSearch } from "./work";

/**
 * Reads one engine route and parses it, or null when the engine says "not found" or "not for you". The pages pass the
 * signed-in client's fetch; tests pass the real app. Only C29's read routes are used (S58).
 */
export type Get = <S extends z.ZodType>(path: string, schema: S) => Promise<z.infer<S> | null>;

export const loadDeals = (get: Get, search: WorkSearch) => get(`/api/deals?${dealsQuery(search)}`, DealsPage);

export const loadTasks = (get: Get, search: WorkSearch) =>
  get(`/api/tasks?scope=${search.scope}&status=${search.done ? "done" : "open"}&limit=50`, TasksPage);

/** The inbox (C31, S63): the gates the signed-in role decides, oldest first. The engine filters by role. */
export const loadInbox = (get: Get, cursor: string | undefined) =>
  get(`/api/approvals?scope=inbox&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, InboxPage);

/** A note the copilot drafted (`?draft=<id>`), for the approval's note box. Not found, not yours or not an id: null. */
export const loadNoteDraft = async (get: Get, id: string | undefined) => {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const d = await get(`/api/copilot/drafts/${id}`, CopilotDraftView);
  return d && d.kind === "approval_note" ? { dealId: d.dealId, body: d.body } : null;
};

export const loadSummary = (get: Get) => get("/api/summary", Summary);

/** The record and the first (or the asked-for) page of its activity. */
export async function loadRecordPage(
  get: Get,
  dealId: string,
  eventsCursor: string | undefined,
): Promise<{ record: Omit<RecordView, "sections"> & { sections: RecordSections }; events: EventsPage } | null> {
  const [record, events] = await Promise.all([
    get(`/api/deals/${dealId}`, RecordView),
    get(
      `/api/deals/${dealId}/events?limit=30${eventsCursor ? `&cursor=${encodeURIComponent(eventsCursor)}` : ""}`,
      EventsPage,
    ),
  ]);
  if (!record || !events) return null;
  return { record: { ...record, sections: readSections(record.sections) }, events };
}
type EventsPage = z.infer<typeof EventsPage>;

/** Home: the counts, the role's five oldest open tasks and gates it decides. */
export async function loadHome(get: Get) {
  const summary = await loadSummary(get);
  if (!summary) return null;
  const [tasks, inbox] = await Promise.all([
    get("/api/tasks?scope=mine&status=open&limit=5", TasksPage),
    get("/api/approvals?scope=inbox&limit=5", InboxPage),
  ]);
  const gates: WaitingGate[] = (inbox?.items ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    gateLabel: a.gateLabel ?? a.title,
    createdAt: a.createdAt ?? "",
    entityRef: a.entityRef ?? null,
    entityId: a.entity.kind === "deal" ? a.entity.id : null,
  }));
  return { summary, tasks: tasks?.items ?? [], gates };
}

/** Settings → AI helpers (S59): null for a role the engine refuses (only an admin or a sales manager reads it). */
export const loadHelperSettings = (get: Get) => get("/api/settings/helpers", HelperSettings);

/** The signed-in user's alerts (C23, S62). */
export const loadAlerts = (get: Get) => get("/api/alerts", AlertsView);

/** Compliance records (C23, S62): null for every role the engine refuses, so the page is not there for them. */
export const loadRetention = (get: Get) => get("/api/compliance/retention", RetentionList);
export const loadReports = (get: Get) => get("/api/compliance/reports", ReportList);
export const loadExports = (get: Get) => get("/api/compliance/exports", ExportLogView);

/**
 * Inventory and Listings (C32, S64): null for a role or a company kind the engine refuses (403), so the page is not
 * there for them, and for an unknown id (404).
 */
export const loadProjects = (get: Get) => get("/api/projects", ProjectsList);
export const loadProject = (get: Get, id: string) => get(`/api/projects/${id}`, ProjectRecord);
export const loadListings = (get: Get, scope: "mine" | "all", cursor: string | undefined) =>
  get(`/api/listings?scope=${scope}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, ListingsPage);
export const loadListing = (get: Get, id: string) => get(`/api/listings/${id}`, ListingRecord);

/** Compliance cases (C33, S65): null for every role the engine refuses (403) and for an unknown case (404). */
export const loadCases = (get: Get, tab: CaseTab, cursor: string | undefined) =>
  get(
    `/api/compliance/cases?status=${tab}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    CasesPage,
  );
export const loadCase = (get: Get, id: string) => get(`/api/compliance/cases/${id}`, CaseView);

/**
 * Settings screens (C34, S66). Each is null for a role the engine refuses (403) and for an unknown id (404), so the page
 * is not there for them.
 */
export const loadTemplates = (get: Get) => get("/api/templates", TemplateList);
export const loadTemplate = (get: Get, id: string) => get(`/api/templates/${id}`, TemplateRecord);
export const loadTemplateVersion = (get: Get, id: string) => get(`/api/template-versions/${id}`, TemplateVersionView);
export const loadKycIndex = (get: Get) => get("/api/settings/kyc", KycIndex);
export const loadKycForm = (get: Get, role: string, dealType: string | null) =>
  get(`/api/settings/kyc?role=${role}${dealType ? `&dealType=${dealType}` : ""}`, KycDetail);
export const loadAlertSettings = (get: Get) => get("/api/settings/alerts", AlertSettingsView);
export const loadAmlPolicy = (get: Get) => get("/api/compliance/policy", AmlPolicyView);
export const loadCompany = (get: Get) => get("/api/settings/company", CompanyView);
export const loadPlans = (get: Get) => get("/api/settings/policy/plans", PlansView);
export const loadSigning = (get: Get) => get("/api/settings/policy/signing", SigningView);
export const loadRulebook = (get: Get) => get("/api/settings/rulebook", RulebookView);
export const loadUsers = (get: Get) => get("/api/settings/users", UsersView);
export const loadModels = (get: Get) => get("/api/settings/models", ModelsView);
export const loadIntegrations = (get: Get) => get("/api/settings/integrations", IntegrationsView);
export const loadDemoClock = (get: Get) => get("/api/demo/clock", DemoClockView);
