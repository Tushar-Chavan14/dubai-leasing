import { formatAed } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { UnitGallery } from "../../../../components/unit-gallery";
import { publicGet } from "../../../../lib/engine";
import { bedroomsLabel, viewingTime } from "../../../../lib/format";
import { IconClock } from "../../../../lib/icons";
import type { ApplicationPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";

export const metadata: Metadata = { title: "The property" };

const yesNo = (v: boolean | null) => (v === null ? null : v ? "Yes" : "No");

/** The property an applicant is invited to view: photos, details, the booked time and the tour. */
export default async function PropertyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<ApplicationPortalView>(`/api/portal/${encodeURIComponent(token)}`);
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
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="portal-title">
          {p.unitNo ? `${p.unitNo}, ` : ""}
          {p.building}
        </h1>
        <p className="muted">{p.community}, Dubai</p>
      </div>

      {closed ? (
        <section className="panel panel-pad">
          <p style={{ margin: 0 }}>
            This application is closed. Contact the leasing team if you&apos;d like to apply again.
          </p>
        </section>
      ) : v.state === "VIEWING" && v.viewingAt ? (
        <section className="panel panel-pad stack">
          <p style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>
            <IconClock size={16} />
            <span>
              Your viewing: <b>{viewingTime(v.viewingAt)}</b> (Dubai time)
            </span>
          </p>
        </section>
      ) : null}

      <UnitGallery
        unitId=""
        code={p.unitNo ?? p.building}
        photos={p.photos}
        bedrooms={p.bedrooms}
        photoBase={`/t/${encodeURIComponent(token)}/property/photos`}
        emptyLabel="Photos coming soon"
      />

      <section className="panel panel-pad stack">
        <dl className="facts">
          {facts
            .filter(([, value]) => value !== null)
            .map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
        {p.description && <p style={{ margin: 0, whiteSpace: "pre-line" }}>{p.description}</p>}
      </section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {p.virtualTourUrl?.startsWith("https://") && (
          <a className="btn primary" href={p.virtualTourUrl} target="_blank" rel="noopener noreferrer">
            Virtual tour
          </a>
        )}
        <Link className="btn" href={`/t/${encodeURIComponent(token)}`}>
          Your application
        </Link>
      </div>
    </div>
  );
}
