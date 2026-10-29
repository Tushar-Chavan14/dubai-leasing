import type { Metadata } from "next";
import { CategoryControl } from "../../../../components/settings-tabs";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import { categoryOf } from "../../../../lib/portfolio";
import type { CompanyRow, CompanyTemplatePanel, ContractRuleRow, Me, RuleReview } from "../../../../lib/types";
import { CompanyTemplatePanelView } from "./company-template";
import { ContractRules } from "./rule-form";

export const metadata: Metadata = { title: "Contract rules" };

export default async function ContractRulesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const category = categoryOf((await searchParams).category);
  const [rules, companies, me] = await Promise.all([
    get<ContractRuleRow[]>(`/api/contract-rules?category=${category}`),
    get<CompanyRow[]>("/api/companies"),
    get<Me>("/api/me"),
  ]);
  const isAdmin = me?.role === "admin";
  const reviews: Record<string, RuleReview> = {};
  await Promise.all(
    (rules ?? []).map(async (r) => {
      const v = await get<RuleReview>(`/api/contract-rules/${r.id}/clauses`);
      if (v) reviews[r.id] = v;
    }),
  );
  // Company templates (slice 4): one panel per active company that has a sample or a template.
  const panels: { company: CompanyRow; panel: CompanyTemplatePanel }[] = [];
  await Promise.all(
    (companies ?? [])
      .filter((c) => c.active)
      .map(async (company) => {
        const panel = await get<CompanyTemplatePanel>(`/api/companies/${company.id}/contract-template`);
        if (panel && (panel.templates.length > 0 || panel.extraction)) panels.push({ company, panel });
      }),
  );
  panels.sort((a, b) => a.company.name.localeCompare(b.company.name));
  // Approved templates a rule can point at, by company.
  const approvedTemplates: Record<string, { id: string; version: number }[]> = {};
  for (const { company, panel } of panels) {
    approvedTemplates[company.id] = panel.templates
      .filter((t) => t.status === "approved")
      .map((t) => ({ id: t.id, version: t.version }));
  }
  const templateReady: Record<string, boolean> = {};
  for (const r of rules ?? []) {
    const panel = panels.find((p) => p.company.id === r.companyId)?.panel;
    templateReady[r.id] =
      !!r.sampleDocumentId && !!panel?.templates.some((t) => t.sampleDocumentId === r.sampleDocumentId);
  }
  return (
    <>
      <PageHead
        title="Contracts"
        lede="Which tenures and how many cheques each company allows, by type. Offers and contracts follow the rule that fits the unit best."
      />
      <div className="settings-add">
        <CategoryControl value={category} base="/settings/contracts" />
      </div>
      <ContractRules
        key={category}
        rules={rules ?? []}
        reviews={reviews}
        companies={companies ?? []}
        templates={approvedTemplates}
        templateReady={templateReady}
        category={category}
        canEdit={isAdmin}
      />
      {panels.map(({ company, panel }) => (
        <CompanyTemplatePanelView key={company.id} company={company} panel={panel} canEdit={isAdmin} />
      ))}
      {!isAdmin && <p className="muted settings-note">Only admins can change rules.</p>}
    </>
  );
}
