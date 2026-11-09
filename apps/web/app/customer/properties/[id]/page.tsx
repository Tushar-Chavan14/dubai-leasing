import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "../../../../components/ui/button";
import { Cover } from "../../../../components/public/cover";
import { type PublicUnitDetail, type Slot, factsList, rentShort, typeLabel } from "../../../../lib/listings";
import { isUuid, publicEngine } from "../../../../lib/public";
import { EnquiryForm } from "./enquiry-form";

export async function generateMetadata({ params }: PageProps<"/customer/properties/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Property" };
  const unit = await publicEngine<PublicUnitDetail>(`/public/units/${id}`);
  if (!unit.ok) return { title: "Property" };
  return { title: `${unit.data.building}, ${unit.data.community}` };
}

export default async function PropertyPage({ params }: PageProps<"/customer/properties/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const unit = await publicEngine<PublicUnitDetail>(`/public/units/${id}`);
  if (unit.status === 404 || unit.status === 409) notFound();
  if (!unit.ok)
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 md:px-8">
        <p className="py-8 text-base text-muted" role="alert">
          We couldn&apos;t load this home just now. Refresh the page in a moment.
        </p>
      </div>
    );
  const u = unit.data;
  // The viewing form is for homes. Commercial and retail units are booked through the chat.
  const residential = u.category === "residential";
  const slots = residential ? await publicEngine<Slot[]>(`/public/units/${id}/slots`) : null;
  const facts = [
    ...factsList(u),
    u.floor === null ? null : `Floor ${u.floor}`,
    u.parkingSpaces ? `${u.parkingSpaces} parking` : null,
  ].filter((x): x is string => Boolean(x));
  const tour = u.virtualTourUrl && /^https:\/\//i.test(u.virtualTourUrl) ? u.virtualTourUrl : null;
  const photos = u.photoUrls.length ? u.photoUrls : [undefined];

  const wrap = "mx-auto w-full max-w-[1240px] px-4 md:px-8";
  const shown = photos.slice(0, 5);
  return (
    <div className={wrap}>
      <div className="mt-6 mb-4 text-sm md:mt-8">
        <Link href="/customer/properties" className="inline-flex items-center gap-1 text-muted! hover:text-ink!">
          <ArrowLeftIcon size={14} aria-hidden="true" />
          All properties
        </Link>
      </div>
      <h1 className="m-0 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-[44px]">
        {u.building}
      </h1>
      <p className="mt-2! mb-6! text-[17px] text-muted">
        {u.community}
        {typeLabel(u) ? ` · ${typeLabel(u)}` : ""}
      </p>

      <div
        className={
          shown.length === 1
            ? "grid grid-cols-1 gap-2.5 [&>*]:aspect-[4/3] md:[&>*]:aspect-[3/1]"
            : "grid grid-cols-1 gap-2.5 md:grid-cols-4 [&>*]:aspect-[4/3] md:[&>:first-child]:col-span-2 md:[&>:first-child]:row-span-2 md:[&>:first-child]:aspect-auto"
        }
      >
        {shown.map((p, i) => (
          <div key={p ?? "ph"} className="overflow-hidden rounded-[18px] bg-raised">
            <Cover building={u.building} photo={p} alt={`${u.building}, photo ${i + 1}`} />
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-8 pb-4 md:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)] md:items-start md:gap-14">
        <div className="grid justify-items-start gap-5">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {facts.map((f) => (
              <li key={f} className="rounded-full border border-line px-3.5 py-1.5 text-sm">
                {f}
              </li>
            ))}
          </ul>
          {u.description && (
            <p className="m-0 max-w-[62ch] text-base leading-relaxed whitespace-pre-line text-muted" dir="auto">
              {u.description}
            </p>
          )}
          {tour && (
            <a href={tour} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>
              Take the virtual tour
            </a>
          )}
        </div>
        <section
          className="grid gap-4 rounded-[22px] border border-line bg-page p-6 md:[position:sticky] md:top-24"
          aria-labelledby="enquire-h"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="m-0 text-3xl font-semibold tracking-tight tabular-nums">{rentShort(u.rent)}</p>
            <span className="text-sm text-muted">a year</span>
          </div>
          <div className="grid gap-1 border-t border-line pt-4">
            <h2 id="enquire-h" className="m-0 text-xl leading-tight font-semibold tracking-tight">
              {residential ? "Enquire or book a site visit" : "Enquire"}
            </h2>
            {residential ? (
              <p className="m-0 text-sm text-muted">Pick a time to see it. We email your invitation straight away.</p>
            ) : (
              <p className="m-0 text-sm text-muted">
                Book a site visit in the chat. Tell it you are interested in {u.code} and it will find you a time.
              </p>
            )}
          </div>
          {residential ? (
            <EnquiryForm unitId={u.id} slots={slots?.ok ? slots.data : []} />
          ) : (
            <Link href={`/customer/chat?unit=${u.id}`} className={`${buttonClass("primary")} h-12 w-full`}>
              Book a site visit in the chat
            </Link>
          )}
          <p className="m-0 text-center text-sm">
            <Link
              href={`/customer/chat?unit=${u.id}`}
              className="text-muted! underline underline-offset-4 hover:text-ink!"
            >
              Ask about this in chat
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
