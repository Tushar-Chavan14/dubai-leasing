import type { StaffRole } from "@leasing/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhotoManager } from "../../../../../components/photo-manager";
import { Banner } from "../../../../../components/ui/form";
import { PageTitle } from "../../../../../components/ui/page";
import { FormSection, UnitForm } from "../../../../../components/unit-form";
import { get } from "../../../../../lib/engine";
import { canSeeUnits } from "../../../../../lib/shell/nav";
import { NotAllowed } from "../../not-allowed";
import { WarningIcon as IconWarning } from "@phosphor-icons/react/dist/ssr";
import type { CompanyRow, Me, UnitDetail, UnitRow } from "../../../../../lib/types";

export const metadata: Metadata = { title: "Edit unit" };

const IDENTITY = ["code", "unitNo", "dldPropertyNo", "makaniNo", "plotNo", "category"];

export default async function EditUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photos?: string }>;
}) {
  const { id } = await params;
  const { photos: photoFlag } = await searchParams;
  const [unit, companies, me] = await Promise.all([
    get<UnitDetail>(`/api/units/${id}`),
    get<CompanyRow[]>("/api/companies"),
    get<Me>("/api/me"),
  ]);
  if (me && !canSeeUnits(me.role as StaffRole)) return <NotAllowed />;
  if (!unit) notFound();
  const hasLease = unit.leases.some((l) => l.state !== "CLOSED");
  const row: UnitRow = {
    ...unit,
    coverPhotoId: unit.photos[0]?.id ?? null,
    photoCount: unit.photos.length,
    lease: null,
  };

  return (
    <div className="grid gap-6">
      <PageTitle back={{ href: `/units/${id}`, label: unit.code }} title={`Edit ${unit.code}`} />
      {photoFlag === "failed" && (
        <Banner tone="warn" role="alert">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          The unit was created, but some photos didn&apos;t upload. Add them again below.
        </Banner>
      )}
      {hasLease && (
        <Banner tone="warn">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          This unit has a lease, so its code, category, unit number, DLD, Makani and plot numbers are fixed. They must
          keep matching the contract and the Ejari registration.
        </Banner>
      )}
      <div className="grid max-w-[980px]">
        <FormSection
          title="Photos"
          lede="The first photo is the cover on listings. Changes here are saved straight away."
        >
          <PhotoManager unitId={id} photos={unit.photos} />
        </FormSection>
        <UnitForm mode="edit" unit={row} companies={companies ?? []} lockedFields={hasLease ? IDENTITY : []} />
      </div>
    </div>
  );
}
