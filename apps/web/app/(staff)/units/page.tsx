import type { StaffRole } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { AskAiMenu } from "../../../components/ask-ai";
import { buttonClass } from "../../../components/ui/button";
import { PageTitle } from "../../../components/ui/page";
import { get } from "../../../lib/engine";
import { askPrompts } from "../../../lib/ask-ai/prompts";
import { PlusIcon as IconPlus, UploadSimpleIcon as IconUpload } from "@phosphor-icons/react/dist/ssr";
import { canSeeUnits } from "../../../lib/shell/nav";
import { NotAllowed } from "./not-allowed";
import { UnitsBrowser } from "./units-browser";
import { CATEGORIES } from "../../../lib/portfolio";
import type { CompanyRow, Me, UnitRow } from "../../../lib/types";

export const metadata: Metadata = { title: "Units" };

const STATES = ["all", "PREP", "READY", "LISTED", "OCCUPIED"] as const;
const EDITORS = ["admin", "leasing_manager", "leasing_officer"];
const IMPORTERS = ["admin", "leasing_manager"];

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; company?: string; category?: string }>;
}) {
  const { state: raw, company: companyRaw, category: categoryRaw } = await searchParams;
  const state = STATES.find((s) => s === raw) ?? "all";
  const [units, me, companies] = await Promise.all([
    get<UnitRow[]>("/api/units"),
    get<Me>("/api/me"),
    get<CompanyRow[]>("/api/companies"),
  ]);
  const companyId = (companies ?? []).find((c) => c.id === companyRaw)?.id ?? "";
  const category = CATEGORIES.find((c) => c.value === categoryRaw)?.value ?? "";
  if (me && !canSeeUnits(me.role as StaffRole)) return <NotAllowed />;
  const canEdit = !!me && EDITORS.includes(me.role);
  const canImport = !!me && IMPORTERS.includes(me.role);

  return (
    <div className="grid gap-6">
      <PageTitle
        title="Units"
        lede="Every unit in the portfolio, from preparation to occupied. A unit can be listed once its checklist is complete and its price is settled."
        actions={
          <>
            <AskAiMenu label="Ask AI" prompts={askPrompts.unitsList()} />
            {canEdit && canImport && (
              <Link href="/settings/import?kind=units" className={buttonClass("ghost", "sm")}>
                <IconUpload size={16} />
                Import units
              </Link>
            )}
            {canEdit && (
              <Link href="/units/new" className={buttonClass("primary", "sm")}>
                <IconPlus size={16} />
                Add unit
              </Link>
            )}
          </>
        }
      />
      <UnitsBrowser
        units={units ?? []}
        companies={companies ?? []}
        initialState={state}
        initialCompany={companyId}
        initialCategory={category}
        {...(canEdit ? { addHref: "/units/new" } : {})}
      />
    </div>
  );
}
