import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageHead } from "../../../components/ui";
import { engine } from "../../../lib/engine";
import { milestoneLabel, milestoneScope, weekdayDate } from "../../../lib/format";
import { IconClock, IconWarning } from "../../../lib/icons";

export const metadata: Metadata = { title: "Demo clock" };

async function fastForward(formData: FormData) {
  "use server";
  const days = Number(formData.get("days"));
  const r = await engine<{ today: string; fired: { milestone: string }[] }>("/api/demo/fast-forward", {
    method: "POST",
    body: JSON.stringify({ days }),
  });
  revalidatePath("/", "layout");
  const params = r.ok
    ? { fired: r.data.fired.map((f) => f.milestone).join("|"), n: String(r.data.fired.length), d: String(days) }
    : { error: r.error?.error ?? "Fast-forward failed" };
  redirect(`/demo?${new URLSearchParams(params)}`);
}

async function rewind() {
  "use server";
  const r = await engine<{ today: string }>("/api/demo/rewind", { method: "POST" });
  revalidatePath("/", "layout");
  redirect(`/demo?${new URLSearchParams(r.ok ? { rewound: "1" } : { error: r.error?.error ?? "Rewind failed" })}`);
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ fired?: string; n?: string; d?: string; error?: string; rewound?: string }>;
}) {
  const sp = await searchParams;
  const clock = await engine<{ now: string; today: string; offsetDays: number }>("/api/demo/clock");
  if (!clock.ok) {
    return (
      <>
        <PageHead title="Demo clock" />
        <div className="alert">
          <IconWarning size={16} />
          The demo clock is only available when the engine runs with DEMO_MODE=true.
        </div>
      </>
    );
  }
  return (
    <>
      <PageHead
        title="Demo clock"
        lede={
          <>
            Moves the engine&apos;s clock forward. Every deadline that falls due fires once, in date order, exactly as
            it would on the day. &ldquo;Back to today&rdquo; returns to real time and keeps all data (also{" "}
            <span className="ref">bun run demo:rewind</span>); <span className="ref">bun run demo:reset</span> wipes
            everything and re-seeds.
          </>
        }
      />
      <div className="split">
        <section className="panel panel-pad">
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <span className="avatar" style={{ width: 44, height: 44, borderRadius: 12 }}>
              <IconClock size={22} />
            </span>
            <div>
              <div className="price" style={{ fontSize: 26 }}>
                {weekdayDate(clock.data.today)}
              </div>
              <p className="muted">
                {clock.data.offsetDays ? `${clock.data.offsetDays} days ahead of real time` : "Real time, no offset"}
              </p>
            </div>
          </div>
          <div className="divider" />
          <form action={fastForward} className="stack">
            <span className="field-label">Jump ahead</span>
            <div className="btn-row">
              {[1, 7, 10, 30, 90].map((d) => (
                <button key={d} type="submit" name="days" value={d} className="btn">
                  {d === 1 ? "1 day" : `${d} days`}
                </button>
              ))}
            </div>
          </form>
          <form action={fastForward} className="btn-row" style={{ marginTop: 16, alignItems: "end" }}>
            <label className="field" style={{ width: 140 }}>
              <span className="field-label">Or any number of days</span>
              <input type="number" name="days" min={1} max={800} defaultValue={31} />
            </label>
            <button type="submit" className="btn primary">
              Fast-forward
            </button>
          </form>
          {clock.data.offsetDays ? (
            <form action={rewind} className="stack" style={{ marginTop: 16 }}>
              <span className="field-label">Back to real time</span>
              <div className="btn-row">
                <button type="submit" className="btn">
                  Back to today
                </button>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                Keeps applications, leases and emails. Deadlines that already fired stay fired.
              </p>
            </form>
          ) : null}
        </section>
        <section className="panel" aria-live="polite">
          <div className="panel-head">
            <h2>Last jump</h2>
          </div>
          {sp.error ? (
            <div className="alert panel-pad" data-tone="bad" style={{ margin: 16 }}>
              <IconWarning size={16} />
              {sp.error}
            </div>
          ) : sp.rewound ? (
            <p className="muted panel-pad">Back to today. All data kept.</p>
          ) : sp.n === undefined ? (
            <p className="muted panel-pad">
              Nothing yet. Try 10 days, then 31, to watch MRN-1204 enter its renewal window and get a notice.
            </p>
          ) : sp.n === "0" ? (
            <p className="muted panel-pad">Moved {sp.d} days. No deadlines fell due.</p>
          ) : (
            <ul className="list" style={{ marginTop: 6 }}>
              {(sp.fired ?? "")
                .split("|")
                .filter(Boolean)
                .map((m) => (
                  <li key={m} className="list-row">
                    <span className="title">{milestoneLabel(m)}</span>
                    <span className="muted">{milestoneScope(m)}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
      <section className="panel panel-pad section" aria-labelledby="ejari-demo-h">
        <h2 id="ejari-demo-h" className="section-title">
          Simulated Ejari
        </h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Contracts are registered with a mock registry that runs beside the engine. It checks the property, the
          landlord and the tenant&apos;s name exactly as written. MRN-1608 is waiting for its contract: its
          tenant&apos;s verified name is in capitals, the registry holds it in title case, and the registration helper
          corrects it once.
        </p>
        <div className="btn-row">
          <a
            className="btn"
            href={process.env.EJARI_MOCK_URL ?? "http://localhost:4100"}
            target="_blank"
            rel="noreferrer"
          >
            Open the simulated registry
          </a>
        </div>
      </section>
    </>
  );
}
