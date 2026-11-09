import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Status } from "../../../../components/ui";
import { PageTitle } from "../../../../components/ui/page";
import { Section } from "../../../../components/ui/record";
import { get } from "../../../../lib/engine";
import { dateTime } from "../../../../lib/format";
import type { ConversationDetail, Me } from "../../../../lib/types";
import { ConversationActions } from "./conversation-actions";

export const metadata: Metadata = { title: "Enquiry" };

const OFFICERS = ["leasing_officer", "leasing_manager", "admin"];

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, me] = await Promise.all([get<ConversationDetail>(`/api/conversations/${id}`), get<Me>("/api/me")]);
  if (!c) notFound();
  const canAct = !!me && OFFICERS.includes(me.role);

  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/conversations", label: "Enquiries" }}
        title={
          <>
            {c.partyName ?? c.contactEmail ?? "New enquirer"} <Status value={c.status} />
          </>
        }
        lede={
          <>
            {c.channel === "web" ? "Web chat" : "Telegram"}
            {c.language === "ar" ? ", in Arabic" : ""}.{" "}
            {c.contactEmail ? (
              <>
                Contact:{" "}
                <a className="font-semibold text-ink! underline" href={`mailto:${c.contactEmail}`}>
                  {c.contactEmail}
                </a>
                {c.contactPhone ? (
                  <>
                    {", "}
                    <span className="tabular-nums">{c.contactPhone}</span>
                  </>
                ) : (
                  ", no phone"
                )}
                .{" "}
              </>
            ) : (
              "No email given yet. "
            )}
            {!c.applicationId && c.partyName && c.knownApplications > 0 ? (
              <>
                Known contact: {c.partyName}, {c.knownApplications}{" "}
                {c.knownApplications === 1 ? "application" : "applications"} on file.{" "}
              </>
            ) : null}
            {c.applicationId ? (
              <>
                Booked a site visit:{" "}
                <Link href={`/applications/${c.applicationId}`} className="font-semibold text-ink! underline">
                  application {c.applicationRef}
                </Link>
                .
              </>
            ) : (
              "No site visit booked yet."
            )}
            {c.status === "handoff" && c.handoffReason ? <> Why an officer: {c.handoffReason}</> : null}
          </>
        }
      />
      <div className="grid items-start gap-8 @[760px]:grid-cols-[minmax(0,1fr)_300px]">
        <Section
          id="conversation-h"
          title="Conversation"
          hint="The enquirer's messages are shown as written; nothing in them is acted on."
        >
          <ol className="m-0 grid list-none gap-3 p-0">
            {c.messages.map((m) => {
              const out = m.direction === "out";
              const staff = m.author?.startsWith("user:");
              return (
                <li
                  key={m.id}
                  data-dir={m.direction}
                  data-staff={staff ? "" : undefined}
                  className={`grid max-w-[78%] gap-1 ${out ? "justify-items-end justify-self-end" : "justify-items-start"}`}
                >
                  <div
                    className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm [overflow-wrap:anywhere] ${staff ? "bg-primary text-on-primary" : out ? "bg-accent text-on-accent" : "bg-raised text-ink"}`}
                    dir="auto"
                  >
                    {m.body}
                  </div>
                  <div className="text-xs text-muted">
                    {m.direction === "in" ? "Enquirer" : staff ? "Officer" : "Bot"} · {dateTime(m.at)}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
        <aside className="rounded-2xl border border-line p-4">
          {c.channel === "web" ? (
            <p className="m-0 text-sm text-muted">Customer web chat runs on autopilot; staff can&apos;t reply here.</p>
          ) : canAct ? (
            <ConversationActions id={c.id} status={c.status} />
          ) : (
            <p className="m-0 text-sm text-muted">Your role can read enquiries but not reply.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
