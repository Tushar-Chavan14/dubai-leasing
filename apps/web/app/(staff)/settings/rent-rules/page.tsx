import type { Metadata } from "next";
import { AskAi } from "../../../../components/ask-ai";
import { possessive } from "../../../../lib/format";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { CategoryControl } from "../../../../components/settings-tabs";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
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
    <>
      <PageHead
        title="Rent rules"
        lede="How far above or below the Smart Rental Index a company may ask, with optional AED limits. A unit's allowed price range comes from the rule that fits its company, type and area best."
      />
      <div className="settings-add">
        <CategoryControl value={category} base="/settings/rent-rules" />
      </div>
      <CompanySplit
        companies={companies ?? []}
        selected={company}
        base="/settings/rent-rules"
        params={{ category }}
        counts={counts}
      >
        {company && (
          <>
            <div className="co-body-head">
              <h2 className="section-title">{company.name}</h2>
              {isAdmin && (
                <AskAi
                  label="Ask AI to set a rent band"
                  prompt={`Set ${possessive(company.name)} ${category} rent band to `}
                />
              )}
            </div>
            <RentRules
              key={`${category}:${company.id}`}
              rules={(rules ?? []).filter((r) => r.companyId === company.id)}
              company={company}
              category={category}
              canEdit={isAdmin}
            />
          </>
        )}
        {!isAdmin && <p className="muted settings-note">Only admins can change rules.</p>}
      </CompanySplit>
    </>
  );
}
