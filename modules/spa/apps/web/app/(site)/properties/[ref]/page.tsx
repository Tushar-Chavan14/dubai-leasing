import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PropertyView } from "../../../../components/public/property-view";
import { loadProperty, loadSlots } from "../../../../lib/public-catalogue";

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const r = await loadProperty((await params).ref);
  return { title: r.ok ? r.data.title : "Property" };
}

/** The public property page (S78, S17): safe fields only; a listing is taken down when its permit expires, a unit when it is no longer available. */
export default async function PropertyPage({ params }: { params: Promise<{ ref: string }> }) {
  const r = await loadProperty((await params).ref);
  if (!r.ok && r.status === 404) notFound();
  if (!r.ok)
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 md:px-8">
        <p className="py-8 text-base text-muted" role="alert">
          This home couldn&apos;t be loaded. Try again in a moment.
        </p>
      </div>
    );
  // The free viewing times (S79). A failed read shows the form with no times, never an error page.
  const slots = await loadSlots(r.data.ref);
  return <PropertyView p={r.data} slots={slots} />;
}
