import { formatAed } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { publicGet } from "../../../../lib/engine";
import { longDate } from "../../../../lib/format";
import type { ApplicationPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { OfferForm } from "./offer-form";

export const metadata: Metadata = { title: "Your offer" };

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<ApplicationPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v || v.kind !== "application" || v.purpose !== "offer" || !v.offer) return <LinkGone />;
  const o = v.offer;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 className="portal-title">{o.revision > 1 ? "Your revised offer" : "Your offer"}</h1>
        <p className="muted">
          {v.unit.label}, {v.unit.community}. Open until {longDate(o.expiresOn)}.
        </p>
      </div>
      <section className="panel panel-pad">
        <dl className="facts">
          <dt>Annual rent</dt>
          <dd className="num">
            <b>{formatAed(o.annualRentFils)}</b>
          </dd>
          <dt>Cheques</dt>
          <dd>{o.cheques}</dd>
          <dt>Security deposit</dt>
          <dd className="num">{formatAed(o.depositFils)}</dd>
          <dt>Move-in</dt>
          <dd>{longDate(o.moveInOn)}</dd>
          <dt>Tenancy</dt>
          <dd>
            {longDate(o.startOn)} to {longDate(o.endOn)}
          </dd>
          <dt>Reservation to pay</dt>
          <dd className="num">{formatAed(o.reservationFils)}</dd>
        </dl>
      </section>
      {v.canRespond ? (
        <OfferForm
          token={token}
          revision={o.revision}
          rentAed={o.annualRentFils / 100}
          cheques={o.cheques}
          moveInOn={o.moveInOn}
        />
      ) : (
        <section className="panel panel-pad stack">
          <p style={{ margin: 0 }}>
            {o.acceptedAt
              ? "You accepted this offer. The leasing team will contact you about the reservation."
              : "This offer can't be answered from this link any more. Use the newest email from us."}
          </p>
          <Link className="link" href={`/t/${token}`}>
            View your application
          </Link>
        </section>
      )}
    </div>
  );
}
