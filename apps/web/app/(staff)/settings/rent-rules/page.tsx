import type { Metadata } from "next";
import { AskAi, AskAiMenu } from "../../../../components/ask-ai";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { CategoryControl } from "../../../../components/settings-tabs";
import { SetPage } from "../../../../components/ui/settings";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { get } from "../../../../lib/engine";
import { possessive } from "../../../../lib/format";
import { categoryOf } from "../../../../lib/portfolio";
import type { CompanyRow, Me, RentRuleRow } from "../../../../lib/types";
import { RentRules } from "./rule-form";

export const metadata: Metadata = { title: "Rent rules" };

export default async function RentRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; company?: string }>;
}) {
  const sp = await searchParams;
  const category = categoryOf(sp.category);
  const [rules, companies, me] = await Promise.all([
    get<RentRuleRow[]>(`/api/rent-rules?category=${category}`),
    get<CompanyRow[]>("/api/companies"),
    get<Me>("/api/me"),
  ]);
  const isAdmin = me?.role === "admin";
  const company = pickCompany(companies ?? [], sp.company);
  const counts: Record<string, number> = {};
  for (const r of rules ?? []) counts[r.companyId] = (counts[r.companyId] ?? 0) + 1;
  return (
    <SetPage
      title="Rent rules"
      lede="How far above or below the Smart Rental Index a company may ask, with optional AED limits. A unit's allowed price range comes from the rule that fits its company, type and area best. Anything outside it needs a manager."
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Rent rules")} />}
    >
      <CategoryControl value={category} base="/settings/rent-rules" />
      <CompanySplit
        companies={companies ?? []}
        selected={company}
        base="/settings/rent-rules"
        params={{ category }}
        counts={counts}
      >
        {company && (
          <RentRules
            key={`${category}:${company.id}`}
            rules={(rules ?? []).filter((r) => r.companyId === company.id)}
            company={company}
            category={category}
            canEdit={isAdmin}
            askAi={
              isAdmin ? (
                <AskAi
                  label="Ask AI to set a rent band"
                  prompt={`Set ${possessive(company.name)} ${category} rent band to `}
                />
              ) : null
            }
          />
        )}
        {!isAdmin && <p className="m-0 text-[13px] text-muted">Only admins can change rules.</p>}
      </CompanySplit>
    </SetPage>
  );
}
