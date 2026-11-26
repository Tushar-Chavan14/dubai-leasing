import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { Gallery } from "@platform/ui/media/gallery";
import { Cover } from "@platform/ui/media/cover";
import type { PublicPropertyDetail } from "@spa/core";
import Link from "next/link";
import { ListingChat } from "../listing-chat";
import { bedsShort, photoSrc, placeLine } from "../../lib/public-filters";
import { EnquiryForm } from "./enquiry-form";
import { PropertyAside } from "./property-aside";

/** The facts list: only what the property has. */
function facts(p: PublicPropertyDetail): [string, string][] {
  const rows: [string, string | null][] = [
    ["Type", p.unitTypeLabel],
    ["Bedrooms", p.bedrooms === null ? null : p.bedrooms === 0 ? "Studio" : String(p.bedrooms)],
    ["Bathrooms", p.bathrooms === null ? null : String(p.bathrooms)],
    ["Size", p.sizeSqft === null ? null : `${p.sizeSqft.toLocaleString("en-US")} sq ft`],
    ["Floor", p.floor === null ? null : String(p.floor)],
    ["View", p.view],
    ["Parking", p.parkingSpaces ? `${p.parkingSpaces} ${p.parkingSpaces === 1 ? "space" : "spaces"}` : null],
    ["Furnishing", p.furnishedLabel],
    ["Handover", p.handover],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null && r[1] !== "");
}

/** The property page (S78, S79): gallery, facts, description and the aside. Safe fields only: it is given the allow-listed shape. */
export function PropertyView({ p, slots = [] }: { p: PublicPropertyDetail; slots?: readonly string[] }) {
  const photos = p.photoIds.map((id) => ({ id, src: photoSrc(id)! }));
  const list = facts(p);
  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 md:px-8">
      <div className="mt-6 mb-4 text-sm md:mt-8">
        <Link href="/properties" className="inline-flex items-center gap-1 text-muted! hover:text-ink!">
          <ArrowLeftIcon size={14} aria-hidden="true" />
          All homes
        </Link>
      </div>
      <h1 className="m-0 text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-[44px]">
        {p.title}
      </h1>
      <p className="mt-2! mb-6! text-[17px] text-muted">{placeLine(p) || bedsShort(p.bedrooms ?? 0)}</p>
      <Gallery title={p.title} photos={photos} placeholder={<Cover name={p.title} src={undefined} label={false} />} />
      <div className="mt-8 grid gap-8 pb-4 md:grid-cols-[minmax(0,3fr)_minmax(340px,2fr)] md:items-start md:gap-14">
        <div className="grid justify-items-start gap-6">
          {list.length > 0 && (
            <dl className="m-0 grid w-full grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {list.map(([k, v]) => (
                <div key={k} className="grid gap-0.5 border-t border-line pt-3">
                  <dt className="text-sm text-muted">{k}</dt>
                  <dd className="m-0 text-base font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {p.description && (
            <p className="m-0 max-w-[62ch] text-base leading-relaxed whitespace-pre-line text-muted" dir="auto">
              {p.description}
            </p>
          )}
        </div>
        <PropertyAside
          p={p}
          actions={
            <>
              <EnquiryForm homeRef={p.ref} slots={slots} />
              {p.chat && <ListingChat listingRef={p.ref} />}
            </>
          }
        />
      </div>
    </div>
  );
}
