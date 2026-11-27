import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@platform/ui/button";
import { HomeTiles } from "../../components/live/home-tiles";
import { get, publicGet } from "../../lib/engine";
import { possessive, weekdayDate } from "../../lib/format";
import type { HomeView, Me, RecordRow, TaskRow } from "../../lib/types";
import { HomeActivity } from "./home-activity";
import { HomeQueue } from "./home-queue";
import { HomeStarters } from "./home-starters";

export const metadata: Metadata = { title: "Home" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function HomePage() {
  const [home, health, companyList, me, records, tasks] = await Promise.all([
    get<HomeView>("/api/home"),
    publicGet<{ today: string }>("/health"),
    get<{ name: string; active: boolean }[]>("/api/companies"),
    get<Me>("/api/me"),
    get<RecordRow[]>("/api/records?mine=1"),
    get<TaskRow[]>("/api/tasks"),
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

  const first = me?.name.trim().split(/\s+/)[0];
  const top = (records ?? [])
    .filter((r) => r.waitingForMe)
    .slice(0, 3)
    .map((r) => ({ key: `${r.kind}:${r.id}`, text: `${r.nextStep} ${r.title}` }));

  return (
    <div className="font-sans text-ink">
      <header className="ls-ptitle">
        <div>
          <h1>
            Hello
            {first ? `, ${first}` : ""}
          </h1>
          {today && <p>{weekdayDate(today)} UAE time</p>}
        </div>
        <Link href="/metrics" className={buttonClass("ghost", "sm")}>
          All metrics →
        </Link>
      </header>
      <HomeStarters suggestions={suggestions} />
      <HomeTiles initial={h} top={top} />

      <div className="ls-grid2">
        <HomeQueue records={records ?? []} tasks={tasks ?? []} today={today} role={me?.role} />

        <section aria-labelledby="did-h" className="ls-panel">
          <div className="ls-panel-h">
            <h2 id="did-h">Agent activity today</h2>
          </div>
          <HomeActivity entries={h.agentToday.slice(0, 8)} today={today} />
        </section>
      </div>
    </div>
  );
}
