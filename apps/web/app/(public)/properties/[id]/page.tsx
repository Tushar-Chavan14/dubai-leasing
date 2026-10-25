import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Cover } from "../../../../components/public/cover";
import { type PublicUnitDetail, type Slot, factsList } from "../../../../lib/listings";
import { isUuid, publicEngine } from "../../../../lib/public";
import { EnquiryForm } from "./enquiry-form";

export async function generateMetadata({ params }: PageProps<"/properties/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Property" };
  const unit = await publicEngine<PublicUnitDetail>(`/public/units/${id}`);
  if (!unit.ok) return { title: "Property" };
  return { title: `${unit.data.building}, ${unit.data.community}` };
}

export default async function PropertyPage({ params }: PageProps<"/properties/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [unit, slots] = await Promise.all([
    publicEngine<PublicUnitDetail>(`/public/units/${id}`),
    publicEngine<Slot[]>(`/public/units/${id}/slots`),
  ]);
  if (unit.status === 404 || unit.status === 409) notFound();
  if (!unit.ok)
    return (
      <div className="pub-wrap">
        <p className="pub-empty" role="alert">
          We couldn&apos;t load this home just now. Refresh the page in a moment.
        </p>
      </div>
    );
  const u = unit.data;
  const facts = [
    ...factsList(u),
    u.floor === null ? null : `Floor ${u.floor}`,
    u.parkingSpaces ? `${u.parkingSpaces} parking` : null,
  ].filter((x): x is string => Boolean(x));
  const tour = u.virtualTourUrl && /^https:\/\//i.test(u.virtualTourUrl) ? u.virtualTourUrl : null;
  const photos = u.photoUrls.length ? u.photoUrls : [undefined];

  return (
    <div className="pub-wrap">
      <p className="pub-crumb">
        <Link href="/properties">All properties</Link>
      </p>
      <h1 className="pub-h">{u.building}</h1>
      <p className="pub-sub">{u.community}</p>

      <div className="pub-gallery" data-count={Math.min(photos.length, 3)}>
        {photos.slice(0, 5).map((p, i) => (
          <Cover key={p ?? "ph"} building={u.building} photo={p} alt={`${u.building}, photo ${i + 1}`} />
        ))}
      </div>

      <div className="pub-detail">
        <div className="pub-detail-main">
          <p className="pub-rent">
            {u.rent} <span>a year</span>
          </p>
          <ul className="pub-facts">
            {facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {u.description && (
            <p className="pub-desc" dir="auto">
              {u.description}
            </p>
          )}
          {tour && (
            <p>
              <a href={tour} target="_blank" rel="noopener noreferrer">
                Take the virtual tour
              </a>
            </p>
          )}
        </div>
        <section className="pub-enquire" aria-labelledby="enquire-h">
          <h2 id="enquire-h">Enquire</h2>
          <p className="muted">Pick a time to see it. We email your invitation straight away.</p>
          <EnquiryForm unitId={u.id} slots={slots.ok ? slots.data : []} />
        </section>
      </div>
    </div>
  );
}
