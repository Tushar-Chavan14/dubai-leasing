import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon as IconPlus } from "@phosphor-icons/react/dist/ssr";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { SetPage } from "@platform/ui/settings";
import { get } from "../../../../lib/engine";
import type {
  CompanyClauseView,
  CompanyRow,
  CompanyTemplatePanel,
  ContractRuleRow,
  Me,
  SampleReview,
} from "../../../../lib/types";
import { CompanyTemplatePanelView } from "../contracts/company-template";
import { latestSampleTab, pickTemplateTab, type TemplateTab, templateTabs } from "./tabs";

export const metadata: Metadata = { title: "Contract templates" };

const TAB =
  "flex items-center gap-1.5 rounded-xl border border-line bg-page px-3 py-1.5 text-sm font-semibold text-ink! no-underline hover:border-ink aria-[current=true]:border-transparent aria-[current=true]:bg-accent aria-[current=true]:text-on-accent! focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

/** D69: one tab per named template, then "+ New template". Keeps the company in the URL. */
function TemplateTabs({ companyId, tabs, selected }: { companyId: string; tabs: TemplateTab[]; selected: string }) {
  const href = (id: string) =>
    `/settings/contract-templates?${new URLSearchParams({ company: companyId, template: id }).toString()}`;
  return (
    <nav aria-label="Templates" className="min-w-0">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {tabs.map((t) => (
          <li key={t.id} className="m-0 p-0">
            <Link href={href(t.id)} aria-current={t.id === selected ? "true" : undefined} className={TAB}>
              {t.name}
              <span className="text-xs font-normal opacity-80">
                {t.versions === 0 ? "reading" : t.approved ? "in use" : "not approved"}
              </span>
            </Link>
          </li>
        ))}
        <li className="m-0 p-0">
          <Link
            href={href("new")}
            aria-current={selected === "new" ? "true" : undefined}
            className={`${TAB} border-dashed`}
          >
            <IconPlus size={14} />
            New template
          </Link>
        </li>
      </ul>
    </nav>
  );
}

/**
 * D68/D69: a company's named contract templates, on their own page. Each has its own versions: upload a new version
 * of one (it replaces that template's version when approved) or start a new template; contract rules (Settings →
 * Contracts) pick an approved template.
 */
export default async function ContractTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; template?: string }>;
}) {
  const sp = await searchParams;
  const [companies, me] = await Promise.all([get<CompanyRow[]>("/api/companies"), get<Me>("/api/me")]);
  const isAdmin = me?.role === "admin";
  const company = pickCompany(companies ?? [], sp.company);
  const [panel, sample, rules, clauseList] = await Promise.all([
    company ? get<CompanyTemplatePanel>(`/api/companies/${company.id}/contract-template`) : null,
    company ? get<SampleReview>(`/api/companies/${company.id}/sample`) : null,
    company ? get<ContractRuleRow[]>(`/api/contract-rules?companyId=${company.id}`) : null,
    company ? get<{ clauses: CompanyClauseView[] }>(`/api/companies/${company.id}/clauses`) : null,
  ]);
  const counts: Record<string, number> = {};
  if (company && panel) counts[company.id] = panel.families.length;
  const tabs = panel ? templateTabs(panel) : [];
  const selected = panel ? pickTemplateTab(panel, sp.template) : "new";
  return (
    <SetPage
      title="Contract templates"
      lede="Each company's contract layouts, read from sample contracts. Give each template a name and the emirates it is for; a new version replaces only its own template. Contract rules then pick a template. Signed contracts never change."
    >
      <CompanySplit
        companies={companies ?? []}
        selected={company}
        base="/settings/contract-templates"
        counts={counts}
        countLabel="templates"
      >
        {company && panel && (
          <>
            <TemplateTabs companyId={company.id} tabs={tabs} selected={selected} />
            <CompanyTemplatePanelView
              key={`${company.id}:${selected}`}
              company={company}
              panel={panel}
              canEdit={isAdmin}
              rules={rules ?? []}
              sample={sample}
              clauses={clauseList?.clauses ?? []}
              selected={selected}
              latestTab={latestSampleTab(panel)}
              tabName={tabs.find((t) => t.id === selected)?.name ?? "New template"}
            />
          </>
        )}
        {!isAdmin && <p className="m-0 text-[13px] text-muted">Only admins can upload, rename or approve templates.</p>}
      </CompanySplit>
    </SetPage>
  );
}
