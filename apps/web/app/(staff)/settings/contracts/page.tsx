import type { Metadata } from "next";
import { AskAi } from "../../../../components/ask-ai";
import { possessive } from "../../../../lib/format";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { CategoryControl } from "../../../../components/settings-tabs";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import { categoryOf } from "../../../../lib/portfolio";
import type {
  CompanyClauseView,
  CompanyRow,
  CompanyTemplatePanel,
  ContractRuleRow,
  Me,
  RuleReview,
} from "../../../../lib/types";
import { ClauseList } from "./clause-list";
import { CompanyTemplatePanelView } from "./company-template";
import { ContractRules } from "./rule-form";

export const metadata: Metadata = { title: "Contract rules" };

export default async function ContractRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; company?: string }>;
}) {
  const sp = await searchParams;
  const category = categoryOf(sp.category);
  const [allRules, companies, me] = await Promise.all([
    get<ContractRuleRow[]>(`/api/contract-rules?category=${category}`),
    get<CompanyRow[]>("/api/companies"),
    get<Me>("/api/me"),
  ]);
  const isAdmin = me?.role === "admin";
  const company = pickCompany(companies ?? [], sp.company);
  const counts: Record<string, number> = {};
  for (const r of allRules ?? []) counts[r.companyId] = (counts[r.companyId] ?? 0) + 1;
  const rules = (allRules ?? []).filter((r) => r.companyId === company?.id);
  const reviews: Record<string, RuleReview> = {};
  const [panel, clauseList] = await Promise.all([
    company ? get<CompanyTemplatePanel>(`/api/companies/${company.id}/contract-template`) : null,
    company ? get<{ clauses: CompanyClauseView[] }>(`/api/companies/${company.id}/clauses`) : null,
    ...rules.map(async (r) => {
      const v = await get<RuleReview>(`/api/contract-rules/${r.id}/clauses`);
      if (v) reviews[r.id] = v;
    }),
  ]);
  // Approved templates a rule can point at.
  const approvedTemplates = (panel?.templates ?? [])
    .filter((t) => t.status === "approved")
    .map((t) => ({ id: t.id, version: t.version }));
  const templateReady: Record<string, boolean> = {};
  for (const r of rules) {
    templateReady[r.id] =
      !!r.sampleDocumentId && !!panel?.templates.some((t) => t.sampleDocumentId === r.sampleDocumentId);
  }
  const showPanel = !!panel && (panel.templates.length > 0 || !!panel.extraction || !!panel.review);
  return (
    <>
      <PageHead
        title="Contracts"
        lede="Which tenures and how many cheques each company allows, by type. Offers and contracts follow the rule that fits the unit best."
      />
      <div className="settings-add">
        <CategoryControl value={category} base="/settings/contracts" />
      </div>
      <CompanySplit
        companies={companies ?? []}
        selected={company}
        base="/settings/contracts"
        params={{ category }}
        counts={counts}
      >
        {company && (
          <>
            <div className="co-body-head">
              <h2 className="section-title">{company.name}</h2>
              {isAdmin && (
                <div className="btn-row">
                  <AskAi
                    label="Ask AI to add a clause"
                    prompt={`Add a clause to ${possessive(company.name)} contract: `}
                  />
                  <AskAi
                    label="Ask AI to change a contract rule"
                    prompt={`Change ${possessive(company.name)} ${category} contract rule: `}
                  />
                </div>
              )}
            </div>
            <ContractRules
              key={`${category}:${company.id}`}
              rules={rules}
              reviews={reviews}
              company={company}
              templates={approvedTemplates}
              templateReady={templateReady}
              category={category}
              canEdit={isAdmin}
            />
            {showPanel && <CompanyTemplatePanelView company={company} panel={panel} canEdit={isAdmin} rules={rules} />}
            <ClauseList company={company} clauses={clauseList?.clauses ?? []} rules={rules} canEdit={isAdmin} />
          </>
        )}
        {!isAdmin && <p className="muted settings-note">Only admins can change rules.</p>}
      </CompanySplit>
    </>
  );
}
