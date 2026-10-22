import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PhotoManager } from "../../../../../components/photo-manager";
import { PageHead } from "../../../../../components/ui";
import { UnitForm } from "../../../../../components/unit-form";
import { get } from "../../../../../lib/engine";
import { IconWarning } from "../../../../../lib/icons";
import type { CompanyPolicyView, UnitDetail, UnitRow } from "../../../../../lib/types";

export const metadata: Metadata = { title: "Edit unit" };

const IDENTITY = ["code", "unitNo", "dldPropertyNo", "makaniNo", "plotNo"];

export default async function EditUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photos?: string }>;
}) {
  const { id } = await params;
  const { photos: photoFlag } = await searchParams;
  const [unit, policy] = await Promise.all([
    get<UnitDetail>(`/api/units/${id}`),
    get<CompanyPolicyView>("/api/policy"),
  ]);
  if (!unit) notFound();
  const hasLease = unit.leases.some((l) => l.state !== "CLOSED");
  const row: UnitRow = {
    ...unit,
    coverPhotoId: unit.photos[0]?.id ?? null,
    photoCount: unit.photos.length,
    lease: null,
  };

  return (
    <>
      <PageHead back={{ href: `/units/${id}`, label: unit.code }} title={`Edit ${unit.code}`} />
      {photoFlag === "failed" && (
        <div className="alert" data-tone="warn" role="alert" style={{ marginBottom: 20 }}>
          <IconWarning size={16} />
          The unit was created, but some photos didn&apos;t upload. Add them again below.
        </div>
      )}
      {hasLease && (
        <div className="alert" style={{ marginBottom: 20 }}>
          <IconWarning size={16} />
          This unit has a lease, so its code, unit number, DLD, Makani and plot numbers are fixed. They must keep
          matching the contract and the Ejari registration.
        </div>
      )}
      <section className="form-section" style={{ borderTop: 0, paddingTop: 0 }}>
        <header>
          <h2>Photos</h2>
          <p>The first photo is the cover on listings. Changes here are saved straight away.</p>
        </header>
        <PhotoManager unitId={id} photos={unit.photos} />
      </section>
      <div className="divider" />
      <UnitForm
        mode="edit"
        unit={row}
        ranges={policy?.askingRentRangeFils ?? {}}
        lockedFields={hasLease ? IDENTITY : []}
      />
    </>
  );
}
