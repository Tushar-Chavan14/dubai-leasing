import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHead, Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { dateTime } from "../../../lib/format";
import { IconChat } from "../../../lib/icons";
import type { ConversationRow } from "../../../lib/types";

export const metadata: Metadata = { title: "Enquiries" };

export default async function ConversationsPage() {
  const rows = (await get<ConversationRow[]>("/api/conversations")) ?? [];
  const waiting = rows.filter((r) => r.status === "handoff").length;

  return (
    <>
      <PageHead
        title="Enquiries"
        lede={
          <>
            Telegram conversations with people looking for a home. The bot answers, shows listed units and books
            viewings; anything else comes to an officer.{" "}
            {waiting ? (
              <strong>
                {waiting} {waiting === 1 ? "needs" : "need"} an officer.
              </strong>
            ) : null}
          </>
        }
      />
      <section className="panel">
        {rows.length === 0 ? (
          <Empty icon={<IconChat />} title="No enquiries yet">
            Conversations appear here when someone writes to the Telegram bot.
          </Empty>
        ) : (
          <ul className="list">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/conversations/${c.id}`} className="list-row">
                  <div>
                    <div className="title">
                      {c.partyName ?? c.contactEmail ?? "New enquirer"}
                      {c.applicationRef ? (
                        <span className="muted" style={{ fontWeight: 400 }}>
                          {" "}
                          · {c.applicationRef}
                        </span>
                      ) : null}
                    </div>
                    <div className="meta">
                      <span>Telegram{c.language === "ar" ? " · Arabic" : ""}</span>
                      <span>{c.contactEmail ?? "No email yet"}</span>
                      {c.contactPhone ? <span className="num">{c.contactPhone}</span> : null}
                      {c.status === "handoff" && c.handoffReason ? <span>{c.handoffReason}</span> : null}
                    </div>
                  </div>
                  <div className="side">
                    <Status value={c.status} />
                    {c.lastMessageAt ? <span className="muted">{dateTime(c.lastMessageAt)}</span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
