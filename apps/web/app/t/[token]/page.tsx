import { TENANCY_OPS } from "../../../lib/env";
import { formatAed } from "@leasing/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { portalView } from "../../../lib/engine";
import { longDate } from "../../../lib/format";
import {
  CheckIcon as IconCheck,
  FilePdfIcon as IconPdf,
  WarningIcon as IconWarning,
} from "@phosphor-icons/react/dist/ssr";
import { Banner } from "../../../components/ui/form";
import { Note, PAGE, PortalTitle, PRIMARY, Section, SMALL_GHOST, Tiles } from "../../../components/ui/portal";
import type { ApplicationPortalView } from "../../../lib/portal";
import type { MoveOutView } from "../../../lib/portal";
import { ApplicationStatus } from "./application-status";
import { AcknowledgeForm, ReplyForm } from "./forms";

interface PortalView {
  purpose: "tenancy" | "notice_ack" | "move_in_ack" | "deposit_response";
  tenancy: {
    canReportIssue: boolean;
    moveOut: MoveOutView;
    openPayments: { id: string; seq: number; amountFils: number; dueOn: string; status: string }[];
    reports: {
      ref: string | null;
      status: string;
      category: string | null;
      createdAt: string;
      ticketStatus: string | null;
    }[];
  };
  tenantFirstName: string;
  lease: { state: string; startOn: string; endOn: string; annualRentFils: number; ref: string };
  unit: { label: string; community: string } | null;
  notice: {
    sentAt: string;
    acknowledgedAt: string | null;
    currentRentFils: number;
    proposedRentFils: number;
    newTermStartOn: string;
    newTermEndOn: string;
  } | null;
  reply: { ref: string; choice: string | null; receivedAt: string } | null;
  canAcknowledge: boolean;
  canReply: boolean;
}

const CHOICE_TEXT: Record<string, string> = { renew: "renew", vacate: "move out", discuss: "discuss the renewal" };

export default async function TenancyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await portalView<PortalView | ApplicationPortalView>(token);
  if (!view) return <ExpiredLink />;
  if ("kind" in view && view.kind === "application") return <ApplicationStatus v={view} token={token} />;
  if ("kind" in view && (view as { kind: string }).kind === "sign") redirect(`/t/${token}/sign`);
  const v = view as PortalView;
  // Move-in through move-out is off: the renewal, payment, issue and move-out forms don't exist.
  if (!TENANCY_OPS)
    return (
      <div className={PAGE}>
        <PortalTitle
          title="Nothing to do right now"
          sub="There's nothing for you to do here right now. Contact the leasing team with any question."
        />
      </div>
    );
  const increase = v.notice && v.notice.proposedRentFils > v.notice.currentRentFils;
  const done = (text: ReactNode) => (
    <Banner tone="good" role="status">
      <IconCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>{text}</span>
    </Banner>
  );

  return (
    <div className={PAGE}>
      <PortalTitle
        title={`Hello${v.tenantFirstName ? `, ${v.tenantFirstName}` : ""}`}
        sub={`${v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your tenancy"}. Tenancy until ${longDate(v.lease.endOn)}.`}
      />

      {v.purpose === "move_in_ack" && redirectTo(`/t/${token}/move-in`)}
      {v.purpose === "deposit_response" && redirectTo(`/t/${token}/deposit`)}

      {v.purpose === "tenancy" &&
        (v.tenancy.moveOut.canGiveNotice || v.tenancy.moveOut.booking || v.tenancy.moveOut.statement) && (
          <Section title="Moving out">
            {v.tenancy.moveOut.canGiveNotice && (
              <a className={`${SMALL_GHOST} w-fit`} href={`/t/${token}/vacate`}>
                Give notice to move out
              </a>
            )}
            {v.tenancy.moveOut.booking && (
              <p className="m-0 text-[15px]">
                Moving out on <b>{longDate(v.tenancy.moveOut.booking.moveOutOn)}</b>.{" "}
                {v.tenancy.moveOut.booking.done ? (
                  "The inspection is done."
                ) : (
                  <a className="font-semibold underline" href={`/t/${token}/inspection`}>
                    {v.tenancy.moveOut.booking.scheduledAt ? "Change the inspection time" : "Book the inspection"}
                  </a>
                )}
              </p>
            )}
            {v.tenancy.moveOut.statement && (
              <p className="m-0 text-[15px]">
                Deposit statement {v.tenancy.moveOut.statement.revision}: refund{" "}
                <b>{formatAed(v.tenancy.moveOut.statement.refundFils)}</b>
                {v.tenancy.moveOut.statement.paidOn
                  ? `, paid on ${longDate(v.tenancy.moveOut.statement.paidOn)}`
                  : ` (${v.tenancy.moveOut.statement.status})`}
                .
              </p>
            )}
          </Section>
        )}

      {v.tenancy.openPayments.length > 0 && (
        <Section title="Payments that need your attention">
          <ul className="m-0 grid list-none gap-2 p-0">
            {v.tenancy.openPayments.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-line bg-page px-3.5 py-3 text-[15px]"
              >
                <span>
                  Payment {p.seq}: {formatAed(p.amountFils)}, due {longDate(p.dueOn)}
                  {p.status === "bounced" ? " (cheque returned)" : ""}
                </span>
                {v.purpose === "tenancy" && (
                  <a className={`${SMALL_GHOST} shrink-0`} href={`/t/${token}/payment/${p.id}`}>
                    Reply
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {v.tenancy.canReportIssue && v.purpose === "tenancy" && (
        <Section title="Something wrong at home?">
          <a className={`${PRIMARY} !w-fit px-6`} href={`/t/${token}/report`}>
            Report an issue
          </a>
          {v.tenancy.reports.length > 0 && (
            <ul className="m-0 grid list-none gap-2 p-0">
              {v.tenancy.reports.map((r) => (
                <li
                  key={r.ref ?? r.createdAt}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-page px-3.5 py-3 text-[15px]"
                >
                  <span>
                    <span className="font-mono text-[13px]">{r.ref}</span> {r.category ?? "being read"}
                  </span>
                  <span className="text-[13px] text-muted">
                    {r.ticketStatus ? `repair ${r.ticketStatus.replace("_", " ")}` : r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {v.notice ? (
        <Section title="Your renewal offer">
          <Tiles
            items={[
              { label: "Current annual rent", value: formatAed(v.notice.currentRentFils) },
              {
                label: increase ? "New annual rent" : "New annual rent (no change)",
                value: formatAed(v.notice.proposedRentFils),
              },
              {
                label: "New term",
                value: `${longDate(v.notice.newTermStartOn)} to ${longDate(v.notice.newTermEndOn)}`,
                wide: true,
              },
            ]}
          />
          <a
            className="flex min-h-12 items-center gap-2.5 rounded-xl border border-line bg-page px-3.5 py-3 text-[15px] text-ink!"
            href={`/t/${token}/notice.pdf`}
            target="_blank"
            rel="noreferrer"
          >
            <IconPdf size={22} aria-hidden />
            Read the full notice (PDF)
          </a>
        </Section>
      ) : v.tenancy.openPayments.length === 0 && !v.tenancy.canReportIssue ? (
        <Note>There&apos;s nothing for you to do right now. We&apos;ll email you when there is.</Note>
      ) : null}

      {v.notice && (
        <Section title="1. Confirm you received the notice">
          {v.canAcknowledge ? <AcknowledgeForm token={token} /> : done("Confirmed. Thank you.")}
        </Section>
      )}

      {v.notice && (
        <Section title="2. Tell us your plans">
          {v.reply &&
            done(
              <>
                You told us you want to {CHOICE_TEXT[v.reply.choice ?? ""] ?? "reply"} (reference{" "}
                <span className="font-mono text-[13px]">{v.reply.ref}</span>).
              </>,
            )}
          {v.reply && v.canReply && (
            <Note>When you&apos;re ready, you can still tell us whether you&apos;ll renew or move out.</Note>
          )}
          {v.reply && !v.canReply ? null : v.canReply ? (
            v.purpose === "tenancy" ? (
              <ReplyForm token={token} />
            ) : (
              <Note>Use the &ldquo;Reply&rdquo; button in the notice email to answer.</Note>
            )
          ) : (
            <Note>This offer can no longer be answered online. Please contact the leasing team.</Note>
          )}
        </Section>
      )}
    </div>
  );
}

function redirectTo(path: string): never {
  redirect(path);
}

function ExpiredLink() {
  return (
    <div className={PAGE}>
      <PortalTitle title="This link has expired" />
      <Banner tone="warn">
        <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Links in our emails work for a limited time. Open the newest email from us, or reply to it and we&apos;ll send
          you a fresh link.
        </span>
      </Banner>
    </div>
  );
}
