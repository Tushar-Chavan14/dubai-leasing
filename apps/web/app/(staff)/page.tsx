import type { Metadata } from "next";
import Link from "next/link";
import { HomeTiles } from "../../components/live/home-tiles";
import { CopilotWorkspace } from "../../components/copilot/workspace";
import { type ThreadDetail, type ThreadRow, toChat } from "../../components/copilot/thread";
import { get, publicGet } from "../../lib/engine";
import { dateTime, possessive, relativeTime, weekdayDate } from "../../lib/format";
import type { HomeView } from "../../lib/types";

export const metadata: Metadata = { title: "Home" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ thread?: string; ask?: string }> }) {
  const { thread, ask } = await searchParams;
  const [home, health, threads, companyList, current] = await Promise.all([
    get<HomeView>("/api/home"),
    publicGet<{ today: string }>("/health"),
    get<ThreadRow[]>("/api/copilot/threads"),
    get<{ name: string; active: boolean }[]>("/api/companies"),
    thread ? get<ThreadDetail>(`/api/copilot/threads/${encodeURIComponent(thread)}`) : Promise.resolve(null),
  ]);
  const today = health?.today ?? "";
  const h: HomeView = home ?? {
    viewingsToday: 0,
    offersOut: 0,
    awaitingSignature: 0,
    ejariPending: 0,
    waitingForYou: 0,
    agentToday: [],
  };

  // Settings examples name a real company (the first active one) so they work as written.
  const co = companyList?.find((c) => c.active)?.name ?? "the company";
  const suggestions = [
    "How many applications are in each stage?",
    h.waitingForYou > 0 && `View ${plural(h.waitingForYou, "item", "items")} requiring action`,
    h.offersOut > 0 && `Show the ${plural(h.offersOut, "offer", "offers")} waiting on applicants`,
    h.viewingsToday > 0 && `Show the ${plural(h.viewingsToday, "site visit", "site visits")} today`,
    h.awaitingSignature > 0 &&
      `Which ${h.awaitingSignature === 1 ? "contract is" : `${h.awaitingSignature} contracts are`} waiting for a signature?`,
    h.ejariPending > 0 && `What is pending at Ejari?`,
    "Which contracts are waiting for approval?",
    "Which contracts couldn't be prepared, and why?",
    `What contract rules and clauses does ${co} have?`,
    `Add a clause to ${possessive(co)} contract: `,
    `Set ${possessive(co)} residential rent band to `,
    "Which units are available to let?",
    "What can you help me with?",
  ]
    .filter((s): s is string => !!s)
    .slice(0, 12);

  return (
    <div className="home">
      {today && <p className="home-date">{weekdayDate(today)} in Dubai</p>}
      <HomeTiles initial={h} />

      <section className="home-chat panel" aria-label="Copilot">
        <CopilotWorkspace
          key={current?.id ?? "new"}
          heading="What needs your attention today?"
          suggestions={suggestions}
          {...(ask && !current ? { initialDraft: ask } : {})}
          {...(current ? { threadId: current.id, initial: toChat(current) } : {})}
        />
      </section>
      {threads && threads.length > 0 && (
        <details className="home-threads">
          <summary>Earlier conversations</summary>
          <ul>
            {threads.slice(0, 8).map((t) => (
              <li key={t.id}>
                <Link href={`/?thread=${t.id}`} aria-current={t.id === current?.id ? "page" : undefined}>
                  <span>{t.title}</span>
                  <time dateTime={t.createdAt}>{dateTime(t.createdAt)}</time>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section aria-labelledby="did-h" className="home-did">
        <h2 id="did-h">Agent activity today</h2>
        {h.agentToday.length === 0 ? (
          <p className="muted">Nothing yet today.</p>
        ) : (
          <ul>
            {h.agentToday.slice(0, 8).map((e) => (
              <li key={`${e.source}:${e.refId}`}>
                <span className="wk-actor" data-kind="agent">
                  Agent
                </span>
                <span className="wk-text">{e.text}</span>
                <time dateTime={e.at}>{relativeTime(today, e.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
