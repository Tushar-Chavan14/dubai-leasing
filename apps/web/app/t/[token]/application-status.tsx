import { formatAed } from "@leasing/core";
import Link from "next/link";
import { longDate, viewingTime } from "../../../lib/format";
import { IconCheck } from "../../../lib/icons";
import { APPLICANT_STAGES, type ApplicationPortalView, stageIndex } from "../../../lib/portal";

const CLOSED: Record<string, string> = {
  WITHDRAWN: "This application is closed. If you think that's a mistake, reply to the email you received.",
  REJECTED: "We couldn't continue with this application. The leasing team will contact you.",
};

/** The applicant's view of their application: where it is and what (if anything) to do next. */
export function ApplicationStatus({ v, token }: { v: ApplicationPortalView; token: string }) {
  const at = stageIndex(v);
  const closed =
    v.state === "WITHDRAWN" && v.viewingOutcome === "no_show"
      ? "This application is closed because we didn't see you at the viewing. If you're still interested, contact the leasing team to apply again."
      : CLOSED[v.state];
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Hello{v.firstName ? `, ${v.firstName}` : ""}</h1>
        <p className="muted">
          Your application for {v.unit.label}, {v.unit.community}
          {v.ref ? (
            <>
              {" "}
              (reference <span className="ref">{v.ref}</span>)
            </>
          ) : null}
          .
        </p>
      </div>

      {closed ? (
        <section className="panel panel-pad">
          <p style={{ margin: 0 }}>{closed}</p>
        </section>
      ) : (
        <ol className="stages" aria-label="Application progress">
          {APPLICANT_STAGES.map((s, i) => (
            <li
              key={s.key}
              data-state={i < at ? "done" : i === at ? "current" : "todo"}
              aria-current={i === at ? "step" : undefined}
            >
              <span className="dot">{i < at ? <IconCheck size={13} /> : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {!closed && v.state === "VIEWING" && (
        <section className="panel panel-pad stack">
          <p style={{ margin: 0 }}>
            {v.viewingAt ? (
              <>
                Your viewing is booked for <b>{viewingTime(v.viewingAt)}</b> (Dubai time).
              </>
            ) : (
              "Your viewing is booked."
            )}{" "}
            After the viewing we&apos;ll email you a link to upload your ID documents.
          </p>
          {v.property && (
            <div>
              <Link className="btn primary" href={`/t/${token}/property`}>
                View the property
              </Link>
            </div>
          )}
        </section>
      )}

      {!closed && v.state === "SCREENING" && (
        <section className="panel panel-pad stack">
          {v.canUpload ? (
            <>
              <p style={{ margin: 0 }}>We need photos of your ID documents to prepare the tenancy.</p>
              <div>
                <Link className="btn primary" href={`/t/${token}/documents`}>
                  Upload documents
                </Link>
              </div>
            </>
          ) : (
            <p style={{ margin: 0 }}>
              We&apos;re checking your documents. We&apos;ll email you as soon as that&apos;s done, usually the same
              day.
            </p>
          )}
        </section>
      )}

      {v.offer && (
        <section className="panel panel-pad stack">
          <h2 className="section-title" style={{ margin: 0 }}>
            {v.offer.revision > 1 ? `Our offer (revision ${v.offer.revision})` : "Our offer"}
          </h2>
          <dl className="facts">
            <dt>Annual rent</dt>
            <dd className="num">
              <b>{formatAed(v.offer.annualRentFils)}</b>
            </dd>
            <dt>Cheques</dt>
            <dd>{v.offer.cheques}</dd>
            <dt>Security deposit</dt>
            <dd className="num">{formatAed(v.offer.depositFils)}</dd>
            <dt>Tenancy</dt>
            <dd>
              {longDate(v.offer.startOn)} to {longDate(v.offer.endOn)}
            </dd>
            <dt>Reservation</dt>
            <dd className="num">{formatAed(v.offer.reservationFils)}</dd>
          </dl>
          {v.offer.acceptedAt ? (
            <p className="row-done">
              <IconCheck size={16} />
              {v.reservationRecorded
                ? "Accepted and reserved. We're preparing your tenancy contract."
                : "Accepted. The leasing team will contact you about the reservation payment."}
            </p>
          ) : v.canRespond ? (
            <div>
              <Link className="btn primary" href={`/t/${token}/offer`}>
                Answer the offer
              </Link>
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                Open until {longDate(v.offer.expiresOn)}.
              </p>
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              Use the &ldquo;Answer the offer&rdquo; button in the newest offer email. Open until{" "}
              {longDate(v.offer.expiresOn)}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
