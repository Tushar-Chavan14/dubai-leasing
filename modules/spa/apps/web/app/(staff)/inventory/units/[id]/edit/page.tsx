import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MediaManager } from "../../../../../../components/inventory-photos";
import { FormSection, UnitForm } from "../../../../../../components/unit-form";
import { engineGet } from "../../../../../../lib/engine";
import { loadUnit } from "../../../../../../lib/loaders";
import { requireScreen } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Edit unit" };

/** Edit a unit's details and photos (admin only). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireScreen("inventory");
  if (user.role !== "admin") notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const unit = await loadUnit(engineGet, id.data);
  if (!unit) notFound();
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/inventory", label: "Inventory" },
          { href: `/inventory/units/${unit.id}`, label: unit.code },
        ]}
        title={`Edit ${unit.code}`}
      />
      <div className="grid max-w-[980px]">
        <FormSection title="Photos" lede="The first photo is the cover. Changes here are saved straight away.">
          <MediaManager kind="unit" ownerId={unit.id} photos={unit.media} />
        </FormSection>
        <UnitForm mode="edit" unit={unit} projects={[]} />
      </div>
    </div>
  );
}
