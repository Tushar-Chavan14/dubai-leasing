import type { Metadata } from "next";
import Link from "next/link";
import { BuildingsIcon as IconBuilding } from "@phosphor-icons/react/dist/ssr";
import { AskAiMenu } from "../../../../components/ask-ai";
import { RowAction } from "../../../../components/row-action";
import { EmptyState } from "../../../../components/ui/empty-state";
import { Pill } from "../../../../components/ui/pill";
import { ROW_CARD, Sub } from "../../../../components/ui/record";
import { SetPage } from "../../../../components/ui/settings";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { get } from "../../../../lib/engine";
import { KIND_LABEL } from "../../../../lib/portfolio";
import type { CompanyRow, Me } from "../../../../lib/types";
import { setCompanyActive } from "./actions";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const [rows, me] = await Promise.all([get<CompanyRow[]>("/api/companies"), get<Me>("/api/me")]);
  const isAdmin = me?.role === "admin";
  const list = rows ?? [];
  return (
    <SetPage
      title="Companies"
      lede="Companies own units. Rent rules and contract rules are set per company, so each one can price and contract in its own way. A contract can't be prepared until the company's legal details are complete."
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Companies")} />}
    >
      {isAdmin && <CompanyForm />}
      {list.length === 0 ? (
        <EmptyState
          title="No companies yet"
          body={isAdmin ? "Add the first company, then give it rent rules." : "An admin adds companies here."}
        />
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Companies">
          {list.map((c) => (
            <li
              key={c.id}
              className={`${ROW_CARD} flex flex-wrap items-center gap-3 p-3 ${c.active ? "" : "opacity-70"}`}
            >
              <span aria-hidden className="grid size-10 flex-none place-items-center rounded-xl bg-raised text-ink">
                <IconBuilding size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[15px] font-semibold text-ink">{c.name}</b>
                <Sub>
                  {KIND_LABEL[c.kind] ?? c.kind} · {c.unitCount} {c.unitCount === 1 ? "unit" : "units"}
                  {c.active ? "" : " · Inactive"}
                </Sub>
              </div>
              <Link
                href={`/settings/companies/${c.id}`}
                className="text-ink! no-underline"
                aria-label={`Legal details for ${c.name}: ${c.legalComplete ? "complete" : "incomplete"}`}
              >
                <Pill tone={c.legalComplete ? "accent" : "waiting"}>
                  {c.legalComplete ? "Legal details complete" : "Incomplete: add legal details"}
                </Pill>
              </Link>
              {isAdmin && (
                <RowAction
                  action={setCompanyActive}
                  fields={{ id: c.id, active: String(!c.active) }}
                  label={c.active ? "Deactivate" : "Reactivate"}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {!isAdmin && <p className="m-0 text-[13px] text-muted">Only admins can add or change companies.</p>}
    </SetPage>
  );
}
