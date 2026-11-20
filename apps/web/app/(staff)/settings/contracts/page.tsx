import { type ChangePolicy, ChangePolicyForm } from "./change-policy-form";
import type { Metadata } from "next";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { EmirateTabs, pickEmirateTab } from "../../../../components/emirate-tabs";
import { EMIRATE_LABELS } from "@leasing/core";
import { CategoryControl } from "../../../../components/settings-tabs";
import { FormGrid, SetPage } from "../../../../components/ui/settings";
import { get } from "../../../../lib/engine";
import { categoryFor, offeredCategories } from "../../../../lib/portfolio";
import type { CompanyClauseView, CompanyRow, CompanyTemplatePanel, ContractRuleRow, Me } from "../../../../lib/types";
import { ClauseList } from "./clause-list";
import { ContractRules } from "./rule-form";
import { TemplatePreviewCard } from "./template-preview-card";

export const metadata: Metadata = { title: "Contract rules" };

export default async function ContractRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; company?: string; emirate?: string }>;
}) {
  const sp = await searchParams;
  const [companies, me, policy] = await Promise.all([
    get<CompanyRow[]>("/api/companies"),
    get<Me>("/api/me"),
    get<{ contractChanges?: ChangePolicy }>("/api/policy"),
  ]);
  const isAdmin = me?.role === "admin";
  const company = pickCompany(companies ?? [], sp.company);
  // Only the types the company offers; a type it doesn't offer falls back to its first one.
  const category = categoryFor(sp.category, company);
  const allRules = await get<ContractRuleRow[]>(`/api/contract-rules?category=${category}`);
  const counts: Record<string, number> = {};
  for (const r of allRules ?? []) counts[r.companyId] = (counts[r.companyId] ?? 0) + 1;
  const operated = company?.emirates ?? [];
  const tab = pickEmirateTab(operated, sp.emirate);
  const rules = (allRules ?? []).filter((r) => r.companyId === company?.id && (r.emirate ?? "any") === tab);
  const [panel, clauseList] = await Promise.all([
    company ? get<CompanyTemplatePanel>(`/api/companies/${company.id}/contract-template`) : null,
    company ? get<{ clauses: CompanyClauseView[] }>(`/api/companies/${company.id}/clauses`) : null,
  ]);
  // D68: approved templates from the company's library; each rule picks one valid in its emirate.
  const approvedTemplates = (panel?.templates ?? [])
    .filter((t) => t.status === "approved")
    .map((t) => ({ id: t.id, name: t.name, version: t.version, emirates: t.emirates }));
  return (
    <SetPage
      title="Contracts"
      lede="Which tenures and how many cheques each company allows, by type, and the clauses its contracts carry. Offers and contracts follow the rule that fits the unit best. Signed contracts never change."
    >
      {policy?.contractChanges && (
        <ChangePolicyForm
          key={JSON.stringify(policy.contractChanges)}
          value={policy.contractChanges}
          canEdit={isAdmin}
        />
      )}
      <CategoryControl
        value={category}
        base="/settings/contracts"
        offered={offeredCategories(company)}
        params={{ ...(company ? { company: company.id } : {}), emirate: tab }}
      />
      <CompanySplit
        companies={companies ?? []}
        selected={company}
        base="/settings/contracts"
        params={{ category }}
        counts={counts}
      >
        {company && (
          <>
            <EmirateTabs
              emirates={operated}
              selected={tab}
              base="/settings/contracts"
              params={{ category, company: company.id }}
            />
            {tab !== "any" && (
              <p className="m-0 text-[13px] text-muted">
                Rules for All emirates also apply here when no rule for {EMIRATE_LABELS[tab]} matches.
              </p>
            )}
            <FormGrid preview={<TemplatePreviewCard company={company} panel={panel} tab={tab} />}>
              <ContractRules
                key={`${category}:${company.id}:${tab}`}
                rules={rules}
                company={company}
                templates={approvedTemplates}
                category={category}
                emirate={tab}
                canEdit={isAdmin}
              />
              {/* D69: clauses read from a template are on Contract templates; here only Additional terms clauses. */}
              <ClauseList
                company={company}
                clauses={(clauseList?.clauses ?? []).filter((c) => !c.templateId)}
                rules={rules}
                canEdit={isAdmin}
              />
            </FormGrid>
          </>
        )}
        {!isAdmin && <p className="m-0 text-[13px] text-muted">Only admins can change rules.</p>}
      </CompanySplit>
    </SetPage>
  );
}
