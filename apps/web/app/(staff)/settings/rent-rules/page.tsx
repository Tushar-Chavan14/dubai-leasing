import type { Metadata } from "next";
import { CategoryControl } from "../../../../components/settings-tabs";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import { categoryOf } from "../../../../lib/portfolio";
import type { CompanyRow, Me, RentRuleRow } from "../../../../lib/types";
import { RentRules } from "./rule-form";

export const metadata: Metadata = { title: "Rent rules" };

export default async function RentRulesPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const category = categoryOf((await searchParams).category);
  const [rules, companies, me] = await Promise.all([
    get<RentRuleRow[]>(`/api/rent-rules?category=${category}`),
    get<CompanyRow[]>("/api/companies"),
    get<Me>("/api/me"),
  ]);
  const isAdmin = me?.role === "admin";
  return (
    <>
      <PageHead
        title="Rent rules"
        lede="How far above or below the Smart Rental Index a company may ask, with optional AED limits. A unit's allowed price range comes from the rule that fits its company, type and area best."
      />
      <div className="settings-add">
        <CategoryControl value={category} base="/settings/rent-rules" />
      </div>
      <RentRules key={category} rules={rules ?? []} companies={companies ?? []} category={category} canEdit={isAdmin} />
      {!isAdmin && <p className="muted settings-note">Only admins can change rules.</p>}
    </>
  );
}
