import type { Metadata } from "next";
import { PartyChat } from "../../../../../components/party-chat";
import { linkProblem } from "../../../../../lib/buyer-link";
import { publicEngine } from "../../../../../lib/engine";

export const metadata: Metadata = { title: "Where things stand", robots: { index: false } };

const day = (d: string) =>
  new Date(`${d}T00:00:00+04:00`).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** A party's read-only status page (design.md §7.3): the step, the one next thing, documents, plan, transfer day. */
export default async function StatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await publicEngine()
    .public.portal[":token"].status.$get({ param: { token } })
    .catch(() => null);
  if (!res?.ok) {
    const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
    const p = linkProblem(res?.status ?? 502, code, "portal");
    return (
      <section className="grid gap-2">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">{p.title}</h1>
        <p className="m-0 text-sm text-muted">{p.body}</p>
      </section>
    );
  }
  const s = await res.json();
  return (
    <article className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">
          {s.role === "seller" ? "Your sale" : "Your purchase"} · {s.property}
        </h1>
        <p className="m-0 text-sm text-muted">Reference {s.ref}</p>
      </header>
      <section className="grid gap-1 rounded-card border border-line bg-raised p-4" aria-label="Status">
        {s.step && <p className="m-0 text-xs font-semibold text-muted">{s.step}</p>}
        <p className="m-0 text-sm text-ink">{s.status}</p>
      </section>
      <section className="grid gap-1 rounded-card border border-line bg-raised p-4" aria-label="What to do now">
        <h2 className="m-0 text-[15px] font-semibold text-ink">{s.next.title}</h2>
        <p className="m-0 text-sm text-ink">{s.next.body}</p>
      </section>
      {s.signing && (
        <p className="m-0 text-sm text-ink">
          You sign {s.signing.position} of {s.signing.of}.{s.signing.signed ? " You have signed." : ""}
        </p>
      )}
      {s.documents.fields.length > 0 && (
        <section className="grid gap-2" aria-label="Your documents">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Your documents</h2>
          {s.documents.underReview && <p className="m-0 text-sm text-ink">Under review</p>}
          <ul className="m-0 grid list-none gap-1 p-0 text-sm text-ink">
            {s.documents.fields.map((f) => (
              <li key={f.label}>
                {f.label}: {f.state === "received" ? "Received" : "Needed"}
              </li>
            ))}
          </ul>
          {s.documents.attention.map((a) => (
            <p key={a} className="m-0 text-sm text-warning">
              {a}
            </p>
          ))}
        </section>
      )}
      {s.plan && (
        <section className="grid gap-2" aria-label="Payment plan">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Payment plan</h2>
          <ul className="m-0 grid list-none gap-2 p-0 text-sm text-ink">
            {s.plan.instalments.map((i) => (
              <li key={i.label} className="flex flex-wrap justify-between gap-2 rounded-card border border-line p-3">
                <span>
                  {i.label} · {i.dueOn ? day(i.dueOn) : i.milestone}
                </span>
                <span>
                  {i.amount} · {i.state === "paid" ? "Paid" : i.state === "part" ? `Part paid (${i.paid})` : "Due"}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-muted">
            Payments show here once your agent has confirmed them. If you have paid and it is not shown, send your
            receipt to your agent.
          </p>
        </section>
      )}
      {s.transferDay && (
        <section className="grid gap-1" aria-label="Transfer day">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Transfer day</h2>
          <p className="m-0 text-sm text-ink">
            Planned for {day(s.transferDay)}. Your agent will confirm it; it can change.
          </p>
        </section>
      )}
      <PartyChat token={token} />
    </article>
  );
}
