import type { StaffRole } from "@leasing/core";
import type { Metadata } from "next";
import { PageTitle } from "../../../../components/ui/page";
import { UnitForm } from "../../../../components/unit-form";
import { get } from "../../../../lib/engine";
import { canSeeUnits } from "../../../../lib/shell/nav";
import { NotAllowed } from "../not-allowed";
import type { CompanyRow, Me } from "../../../../lib/types";

export const metadata: Metadata = { title: "Add unit" };

export default async function NewUnitPage() {
  const [companiesRaw, me] = await Promise.all([get<CompanyRow[]>("/api/companies"), get<Me>("/api/me")]);
  if (me && !canSeeUnits(me.role as StaffRole)) return <NotAllowed />;
  const companies = companiesRaw ?? [];
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/units", label: "Units" }}
        title="Add a unit"
        lede="Starts in preparation. You can save with registration numbers missing and fill them in later; the unit can't be marked ready until they're complete."
      />
      <UnitForm mode="create" companies={companies} />
    </div>
  );
}
