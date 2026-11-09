import { formatAed } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Cta, GHOST, PAGE, PortalTitle, PRIMARY, Rows, Section } from "../../../../components/ui/portal";
import { UnitGallery } from "../../../../components/unit-gallery";
import { portalView } from "../../../../lib/engine";
import { bedroomsLabel, viewingTime } from "../../../../lib/format";
import { ClockIcon as IconClock } from "@phosphor-icons/react/dist/ssr";
import type { ApplicationPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";

export const metadata: Metadata = { title: "The property" };

const yesNo = (v: boolean | null) => (v === null ? null : v ? "Yes" : "No");

/** The property an applicant is invited to view: photos, details, the booked time and the tour. */
export default async function PropertyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await portalView<ApplicationPortalView>(token);
  if (!v || v.kind !== "application" || !v.property) return <LinkGone />;
  const p = v.property;
  const closed = v.state === "WITHDRAWN" || v.state === "REJECTED";
  const facts: [string, string | null][] = [
    ["Bedrooms", p.bedrooms === null ? null : bedroomsLabel(p.bedrooms)],
    ["Bathrooms", p.bathrooms === null ? null : String(p.bathrooms)],
    ["Area", p.areaSqft === null ? null : `${p.areaSqft.toLocaleString("en-GB")} sq ft`],
    ["Floor", p.floor === null ? null : String(p.floor)],
    ["Furnished", yesNo(p.furnished)],
    ["Parking spaces", p.parkingSpaces === null ? null : String(p.parkingSpaces)],
    ["Asking rent", p.askingRentFils === null ? null : `${formatAed(p.askingRentFils)} a year`],
  ];
  return (
    <div className={PAGE}>
      <PortalTitle
        title={
          <>
            {p.unitNo ? `${p.unitNo}, ` : ""}
            {p.building}
          </>
        }
        sub={`${p.community}, Dubai`}
      />

      {closed ? (
        <Section>
          <p className="m-0">This application is closed. Contact the leasing team if you&apos;d like to apply again.</p>
        </Section>
      ) : v.state === "VIEWING" && v.viewingAt ? (
        <Section tone="accent">
          <p className="m-0 flex items-center gap-2">
            <IconClock size={18} aria-hidden />
            <span>
              Your site visit: <b>{viewingTime(v.viewingAt)}</b> (Dubai time)
            </span>
          </p>
        </Section>
      ) : null}

      <UnitGallery
        unitId=""
        code={p.unitNo ?? p.building}
        photos={p.photos}
        bedrooms={p.bedrooms}
        photoBase={`/t/${encodeURIComponent(token)}/property/photos`}
        emptyLabel="Photos coming soon"
      />

      <Rows rows={facts.filter(([, value]) => value !== null).map(([label, value]) => ({ label, value }))} />
      {p.description && <p className="m-0 whitespace-pre-line text-[15px] leading-relaxed">{p.description}</p>}

      <Cta>
        {p.virtualTourUrl?.startsWith("https://") ? (
          <>
            <a className={PRIMARY} href={p.virtualTourUrl} target="_blank" rel="noopener noreferrer">
              Virtual tour
            </a>
            <Link className={GHOST} href={`/t/${encodeURIComponent(token)}`}>
              Your application
            </Link>
          </>
        ) : (
          <Link className={PRIMARY} href={`/t/${encodeURIComponent(token)}`}>
            Your application
          </Link>
        )}
      </Cta>
    </div>
  );
}
