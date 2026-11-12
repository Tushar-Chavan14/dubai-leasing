import { formatAed } from "@leasing/core";
import { CheckIcon as IconCheck } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { longDate, viewingTime } from "../../../lib/format";
import { APPLICANT_STAGES, type ApplicationPortalView, stageIndex } from "../../../lib/portal";
import { Banner } from "../../../components/ui/form";
import { Cta, Note, PAGE, PortalTitle, PRIMARY, Section, Tiles } from "../../../components/ui/portal";

const CLOSED: Record<string, string> = {
  WITHDRAWN: "This application is closed. If you think that's a mistake, reply to the email you received.",
  REJECTED: "We couldn't continue with this application. The leasing team will contact you.",
};

/** The applicant's view of their application: where it is and what (if anything) to do next. */
export function ApplicationStatus({ v, token }: { v: ApplicationPortalView; token: string }) {
  const at = stageIndex(v);
  const closed =
    v.state === "WITHDRAWN" && v.viewingOutcome === "no_show"
      ? "This application is closed because we didn't see you at the site visit. If you're still interested, contact the leasing team to apply again."
      : CLOSED[v.state];
  // The one primary action of the page, pinned at the bottom on phones.
  const cta = closed
    ? null
    : v.state === "SCREENING" && v.canUpload
      ? { href: `/t/${token}/documents`, label: "Upload documents" }
      : v.offer && !v.offer.acceptedAt && v.canRespond
        ? { href: `/t/${token}/offer`, label: "Answer the offer" }
        : v.state === "VIEWING" && v.property
          ? { href: `/t/${token}/property`, label: "View the property" }
          : null;
  return (
    <div className={PAGE}>
      <PortalTitle
        title={`Hello${v.firstName ? `, ${v.firstName}` : ""}`}
        sub={
          <>
            Your application for {v.unit.label}, {v.unit.community}
            {v.ref ? (
              <>
                {" "}
                (reference <span className="font-mono text-[13px]">{v.ref}</span>)
              </>
            ) : null}
            .
          </>
        }
      />

      {closed ? (
        <Section>
          <p className="m-0">{closed}</p>
        </Section>
      ) : (
        <>
          {v.state === "VIEWING" && (
            <Section tone="accent">
              <p className="m-0">
                {v.viewingAt ? (
                  <>
                    Your site visit is booked for <b>{viewingTime(v.viewingAt)}</b> (Dubai time).
                  </>
                ) : (
                  "Your site visit is booked."
                )}{" "}
                After the site visit we&apos;ll email you a link to upload your ID documents.
              </p>
            </Section>
          )}
          {v.state === "SCREENING" && (
            <Section tone="accent">
              {v.canUpload ? (
                <p className="m-0">We need photos of your ID documents to prepare the tenancy.</p>
              ) : (
                <p className="m-0">
                  We&apos;re checking your documents. We&apos;ll email you as soon as that&apos;s done, usually the same
                  day.
                </p>
              )}
            </Section>
          )}
          <ol aria-label="Application progress" className="m-0 grid list-none gap-1 p-0">
            {APPLICANT_STAGES.map((s, i) => {
              const state = i < at ? "done" : i === at ? "now" : "todo";
              return (
                <li
                  key={s.key}
                  aria-current={state === "now" ? "step" : undefined}
                  className={`flex min-h-9 items-center gap-3 text-[15px] ${state === "todo" ? "text-muted" : "text-ink"} ${state === "now" ? "font-semibold" : ""}`}
                >
                  <span
                    aria-hidden
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${state === "done" ? "bg-ink text-page" : state === "now" ? "bg-accent text-on-accent" : "border border-line"}`}
                  >
                    {state === "done" ? <IconCheck size={13} weight="bold" /> : i + 1}
                  </span>
                  {s.label}
                  <span className="sr-only">
                    {state === "done" ? " (done)" : state === "now" ? " (current)" : " (to do)"}
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {v.offer && (
        <Section title={v.offer.revision > 1 ? `Our offer (revision ${v.offer.revision})` : "Our offer"}>
          <Tiles
            items={[
              { label: "Annual rent", value: formatAed(v.offer.annualRentFils) },
              { label: "Cheques", value: v.offer.cheques },
              { label: "Security deposit", value: formatAed(v.offer.depositFils) },
              { label: "Reservation", value: formatAed(v.offer.reservationFils) },
              ...(v.offer.registrationFee
                ? [
                    {
                      label: `Registration fee (${v.offer.registrationFee.systemName})`,
                      value: `${formatAed(v.offer.registrationFee.feeFils)}, paid by you`,
                    },
                  ]
                : []),
              { label: "Tenancy", value: `${longDate(v.offer.startOn)} to ${longDate(v.offer.endOn)}`, wide: true },
            ]}
          />
          {v.offer.acceptedAt ? (
            <Banner tone="good">
              <IconCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {v.reservationRecorded
                  ? "Accepted and reserved. We're preparing your tenancy contract."
                  : "Accepted. The leasing team will contact you about the reservation payment."}
              </span>
            </Banner>
          ) : v.canRespond ? (
            <Note>Open until {longDate(v.offer.expiresOn)}.</Note>
          ) : (
            <Note>
              Use the &ldquo;Answer the offer&rdquo; button in the newest offer email. Open until{" "}
              {longDate(v.offer.expiresOn)}.
            </Note>
          )}
        </Section>
      )}
      {cta && (
        <Cta>
          <Link className={PRIMARY} href={cta.href}>
            {cta.label}
          </Link>
        </Cta>
      )}
    </div>
  );
}
