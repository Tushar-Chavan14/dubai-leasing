import type { Metadata } from "next";
import { PageHead } from "../../../../components/ui";
import { UnitForm } from "../../../../components/unit-form";
import { get } from "../../../../lib/engine";
import type { CompanyRow } from "../../../../lib/types";

export const metadata: Metadata = { title: "Add unit" };

export default async function NewUnitPage() {
  const companies = (await get<CompanyRow[]>("/api/companies")) ?? [];
  return (
    <>
      <PageHead
        back={{ href: "/units", label: "Units" }}
        title="Add a unit"
        lede="Starts in preparation. You can save with registration numbers missing and fill them in later; the unit can't be marked ready until they're complete."
      />
      <UnitForm mode="create" companies={companies} />
    </>
  );
}
