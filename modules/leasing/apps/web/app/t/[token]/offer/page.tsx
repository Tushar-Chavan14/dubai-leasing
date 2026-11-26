import { formatAed } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Note, PAGE, PortalTitle, Rows, Section, SMALL_GHOST, Tiles } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { longDate } from "../../../../lib/format";
import type { ApplicationPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { OfferForm } from "./offer-form";

export const metadata: Metadata = { title: "Your offer" };

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await portalView<ApplicationPortalView>(token);
  if (!v || v.kind !== "application" || v.purpose !== "offer" || !v.offer) return <LinkGone />;
  const o = v.offer;
  return (
    <div className={PAGE}>
      <PortalTitle
        title={o.revision > 1 ? "Your revised offer is ready" : "Your offer is ready"}
        sub={`${v.unit.label}, ${v.unit.community}.`}
      />
      <Tiles
        label="The offer"
        items={[
          { label: "Annual rent", value: formatAed(o.annualRentFils) },
          { label: "Cheques", value: o.cheques },
          { label: "Security deposit", value: formatAed(o.depositFils) },
          { label: "Move in", value: longDate(o.moveInOn) },
        ]}
      />
      <Rows
        rows={[
          { label: "Tenancy", value: `${longDate(o.startOn)} to ${longDate(o.endOn)}` },
          { label: "Reservation to pay", value: formatAed(o.reservationFils) },
          ...(o.registrationFee
            ? [
                {
                  label: `Registration fee (${o.registrationFee.systemName})`,
                  value: `${formatAed(o.registrationFee.feeFils)}, paid by you`,
                },
              ]
            : []),
        ]}
      />
      <Note>This offer is open until {longDate(o.expiresOn)}.</Note>
      <OfferForm
        token={token}
        revision={o.revision}
        rentAed={o.annualRentFils / 100}
        cheques={o.cheques}
        moveInOn={o.moveInOn}
        canRespond={v.canRespond}
        closed={
          <Section>
            <p className="m-0">
              {o.acceptedAt
                ? "You accepted this offer. The leasing team will contact you about the reservation."
                : "This offer can't be answered from this link any more. Use the newest email from us."}
            </p>
            <Link className={`${SMALL_GHOST} w-fit`} href={`/t/${token}`}>
              View your application
            </Link>
          </Section>
        }
      />
    </div>
  );
}
