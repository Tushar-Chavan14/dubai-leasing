import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@platform/ui/button";
import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import { get, publicGet } from "../../../../lib/engine";
import { aedShort, bedroomsLabel } from "../../../../lib/format";
import type { UnitRow } from "../../../../lib/types";
import { NewApplicationForm } from "./new-application-form";

export const metadata: Metadata = { title: "New application" };

export default async function NewApplicationPage({ searchParams }: { searchParams: Promise<{ unit?: string }> }) {
  const { unit } = await searchParams;
  const [allUnits, health] = await Promise.all([get<UnitRow[]>("/api/units"), publicGet<{ today: string }>("/health")]);
  const units = (allUnits ?? []).filter((u) => u.state === "LISTED" && u.askingRentFils);
  return (
    <div className="grid gap-5">
      <PageTitle
        back={{ href: "/work", label: "Workspace" }}
        title="New application"
        lede="Enter the applicant's contact details and book a site visit. They get an invitation with the time, the address and a page to view the property online. Once you record that they came, they get a one-time link to upload their ID documents; the names and numbers on the contract will come from those documents, not from this form."
      />
      {units.length === 0 ? (
        <EmptyState
          title="No listed units"
          body="An application needs a listed unit with an approved asking rent."
          action={
            <Link href="/units" className={buttonClass("primary", "sm")}>
              Go to units
            </Link>
          }
        />
      ) : (
        <NewApplicationForm
          defaultUnit={units.some((u) => u.id === unit) ? unit! : units[0]!.id}
          today={health?.today ?? ""}
          units={units.map((u) => ({
            id: u.id,
            label: `${u.code}, ${u.building} · ${bedroomsLabel(u.bedrooms)} · ${aedShort(u.askingRentFils)} a year`,
          }))}
        />
      )}
    </div>
  );
}
