import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHead, Status } from "../../../../components/ui";
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
    <>
      <PageHead
        back={{ href: "/conversations", label: "Enquiries" }}
        title={c.partyName ?? c.contactEmail ?? "New enquirer"}
        badge={<Status value={c.status} />}
        lede={
          <>
            Telegram{c.language === "ar" ? ", in Arabic" : ""}.{" "}
            {c.contactEmail ? (
              <>
                Contact:{" "}
                <a className="link" href={`mailto:${c.contactEmail}`}>
                  {c.contactEmail}
                </a>
                {c.contactPhone ? (
                  <>
                    {", "}
                    <span className="num">{c.contactPhone}</span>
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
                Booked a viewing:{" "}
                <Link href={`/applications/${c.applicationId}`} className="link">
                  application {c.applicationRef}
                </Link>
                .
              </>
            ) : (
              "No viewing booked yet."
            )}
            {c.status === "handoff" && c.handoffReason ? <> Why an officer: {c.handoffReason}</> : null}
          </>
        }
      />
      <div className="split section">
        <section className="panel">
          <div className="panel-head">
            <h2>Conversation</h2>
            <span className="hint">The enquirer's messages are shown as written; nothing in them is acted on.</span>
          </div>
          <ol className="transcript">
            {c.messages.map((m) => (
              <li key={m.id} data-dir={m.direction} data-staff={m.author?.startsWith("user:") ? "" : undefined}>
                <div className="bubble" dir="auto">
                  {m.body}
                </div>
                <div className="meta">
                  {m.direction === "in" ? "Enquirer" : m.author?.startsWith("user:") ? "Officer" : "Bot"} ·{" "}
                  {dateTime(m.at)}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <aside className="panel panel-pad">
          {canAct ? (
            <ConversationActions id={c.id} status={c.status} />
          ) : (
            <p className="muted">Your role can read enquiries but not reply.</p>
          )}
        </aside>
      </div>
    </>
  );
}
