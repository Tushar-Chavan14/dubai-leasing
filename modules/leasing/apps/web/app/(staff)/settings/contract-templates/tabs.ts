import type { CompanyTemplatePanel } from "../../../../lib/types";

/** A template tab (D69): a named template, or the one a sample being read will start (no version yet). */
export interface TemplateTab {
  id: string;
  name: string;
  /** Versions so far (0 while the first sample is read). */
  versions: number;
  approved: boolean;
}

/** The id of the tab a sample uploaded before D69 (no named template yet) shows on. */
export const PENDING_TAB = "pending";

/** The family the company's latest sample belongs to (its review, reading and clauses show on that tab). */
export const latestSampleTab = (panel: CompanyTemplatePanel) =>
  panel.review ? (panel.review.familyId ?? PENDING_TAB) : null;

/** The company's named templates, oldest first, plus the one a sample being read will start. */
export function templateTabs(panel: CompanyTemplatePanel): TemplateTab[] {
  const tabs: TemplateTab[] = panel.families.map((f) => ({
    id: f.familyId,
    name: f.name,
    versions: f.templateIds.length,
    approved: panel.templates.some((t) => t.familyId === f.familyId && t.status === "approved"),
  }));
  const latest = latestSampleTab(panel);
  if (latest && !tabs.some((t) => t.id === latest))
    tabs.push({ id: latest, name: panel.review?.name ?? "New template", versions: 0, approved: false });
  return tabs;
}

/** The tab to show: the one in the URL, else the latest sample's while it is read or reviewed, else the first. */
export function pickTemplateTab(panel: CompanyTemplatePanel, raw: string | undefined): string {
  const tabs = templateTabs(panel);
  if (raw === "new") return "new";
  if (raw && tabs.some((t) => t.id === raw)) return raw;
  const latest = latestSampleTab(panel);
  const busy = panel.extraction?.status === "reading" || !!panel.review?.templateId;
  if (latest && busy) return latest;
  return tabs[0]?.id ?? "new";
}
