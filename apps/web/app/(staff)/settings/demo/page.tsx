import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TENANCY_OPS } from "../../../../lib/env";
import { PageHead } from "../../../../components/ui";
import { engine } from "../../../../lib/engine";
import { milestoneLabel, milestoneScope, weekdayDate } from "../../../../lib/format";
import { IconClock, IconWarning } from "../../../../lib/icons";

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
  redirect(`/settings/demo?${new URLSearchParams(params)}`);
}

async function rewind() {
  "use server";
  const r = await engine<{ today: string }>("/api/demo/rewind", { method: "POST" });
  revalidatePath("/", "layout");
  redirect(
    `/settings/demo?${new URLSearchParams(r.ok ? { rewound: "1" } : { error: r.error?.error ?? "Rewind failed" })}`,
  );
}

async function demoPayment(formData: FormData) {
  "use server";
  const action = formData.get("action") === "pay" ? "pay" : "bounce";
  const leaseRef = String(formData.get("leaseRef") ?? "");
  const r = await engine<{ seq: number; status: string }>(`/api/demo/payments/${action}`, {
    method: "POST",
    body: JSON.stringify({ leaseRef }),
  });
  revalidatePath("/", "layout");
  const msg = r.ok
    ? `${leaseRef}: instalment ${r.data.seq} ${action === "pay" ? "confirmed paid" : "recorded as bounced; the tenant gets a friendly reminder"}.`
    : (r.error?.error ?? "That didn't work");
  redirect(`/settings/demo?${new URLSearchParams(r.ok ? { pay: msg } : { error: msg })}`);
}

/** Ejari demo: the simulated registry rejects the next registration (name mismatch). */
async function rejectNextEjari() {
  "use server";
  const r = await engine("/api/demo/ejari/reject-next", { method: "POST", body: "{}" });
  const msg = r.ok
    ? "The next Ejari submission will be rejected for a name mismatch. Approve a submission in the Workspace to see the review path."
    : (r.error?.error ?? "That didn't work");
  redirect(`/settings/demo?${new URLSearchParams(r.ok ? { ejari: msg } : { error: msg })}`);
}

/** Move-out demo: record the tenant's notice to vacate at the lease end. */
async function giveNotice(formData: FormData) {
  "use server";
  const leaseRef = String(formData.get("leaseRef") ?? "");
  const r = await engine<{ ref: string; leaseId: string; moveOutOn: string }>("/api/demo/move-out/notice", {
    method: "POST",
    body: JSON.stringify({ leaseRef }),
  });
  revalidatePath("/", "layout");
  if (!r.ok) redirect(`/settings/demo?${new URLSearchParams({ error: r.error?.error ?? "That didn't work" })}`);
  redirect(`/work?kind=lease&id=${r.data.leaseId}`);
}

/** Adds the demo leases that are missing (MRN-1204, MRN-0807, JVC-0310, JLT-2205); deletes nothing. */
async function seedLeases() {
  "use server";
  const r = await engine<{ results: { status: string; ref: string | null; reasons: string[] }[] }>(
    "/api/demo/seed-leases",
    { method: "POST", body: "{}" },
  );
  revalidatePath("/", "layout");
  const added = r.ok ? r.data.results.filter((x) => x.status === "imported").map((x) => x.ref) : [];
  const msg = r.ok
    ? added.length
      ? `Added demo leases: ${added.join(", ")}.`
      : "Every demo lease is already there (or its unit has another live lease)."
    : (r.error?.error ?? "That didn't work");
  redirect(`/settings/demo?${new URLSearchParams(r.ok ? { seeded: msg } : { error: msg })}`);
}

/** Everything back to the seeded demo with the clock at today (admin only; asks for RESET). */
async function resetDemo(formData: FormData) {
  "use server";
  const r = await engine<{ today: string; mockReset: boolean }>("/api/demo/reset", {
    method: "POST",
    body: JSON.stringify({ confirm: String(formData.get("confirm") ?? "") }),
  });
  revalidatePath("/", "layout");
  const msg = r.ok
    ? `Demo data reset to the seed; today is ${r.data.today}.${r.data.mockReset ? "" : " The simulated registry didn't answer: restart it to reset it too."}`
    : (r.error?.error ?? "Type RESET to confirm.");
  redirect(`/settings/demo?${new URLSearchParams(r.ok ? { reset: msg } : { error: msg })}`);
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{
    fired?: string;
    n?: string;
    d?: string;
    error?: string;
    rewound?: string;
    pay?: string;
    ejari?: string;
    reset?: string;
    seeded?: string;
  }>;
}) {
  const leases = (await engine<{ ref: string; state: string }[]>("/api/leases")).data ?? [];
  const leasesForPay = leases.filter((l) => ["ACTIVE", "RENEWAL", "MOVE_OUT"].includes(l.state));
  const leasesForNotice = leases.filter((l) => ["ACTIVE", "RENEWAL"].includes(l.state));
  const me = (await engine<{ role: string }>("/api/me")).data;
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
      {(sp.seeded || !leasesForPay.length || !leasesForNotice.some((l) => l.ref.startsWith("JLT-2205"))) && (
        <section className="panel panel-pad section" aria-labelledby="seed-demo-h">
          <h2 id="seed-demo-h" className="section-title">
            Demo leases
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {leasesForPay.length
              ? "The move-out demo lease (JLT-2205) isn't here."
              : "There is no active lease to run these demos on."}{" "}
            Add the missing demo leases next to your data; nothing is deleted or changed.
          </p>
          {sp.seeded && <p className="row-done">{sp.seeded}</p>}
          <form action={seedLeases}>
            <button type="submit" className="btn">
              Add missing demo leases
            </button>
          </form>
        </section>
      )}
      {TENANCY_OPS && (
        <section className="panel panel-pad section" aria-labelledby="pay-demo-h">
          <h2 id="pay-demo-h" className="section-title">
            Rent collections
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Fast-forward to a cheque date, then bounce it: the tenant gets friendly reminders, and after two a formal
            reminder goes to a leasing manager for approval. Its accepted email starts the rulebook&apos;s waiting
            period.
          </p>
          {sp.pay && <p className="row-done">{sp.pay}</p>}
          <form action={demoPayment} className="btn-row" style={{ alignItems: "end" }}>
            <label className="field">
              <span className="field-label">Lease</span>
              <select name="leaseRef" required disabled={!leasesForPay.length}>
                {!leasesForPay.length && <option value="">No active lease</option>}
                {leasesForPay.map((l) => (
                  <option key={l.ref} value={l.ref}>
                    {l.ref}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" name="action" value="bounce" className="btn" disabled={!leasesForPay.length}>
              Bounce the next cheque
            </button>
            <button type="submit" name="action" value="pay" className="btn" disabled={!leasesForPay.length}>
              Mark the next payment paid
            </button>
          </form>
        </section>
      )}
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
        {sp.ejari && <p className="row-done">{sp.ejari}</p>}
        <div className="btn-row">
          <a
            className="btn"
            href={process.env.EJARI_MOCK_URL ?? "http://localhost:4100"}
            target="_blank"
            rel="noreferrer"
          >
            Open the simulated registry
          </a>
          <form action={rejectNextEjari}>
            <button type="submit" className="btn">
              Reject the next Ejari submission
            </button>
          </form>
        </div>
      </section>
      {TENANCY_OPS && (
        <section className="panel panel-pad section" aria-labelledby="moveout-demo-h">
          <h2 id="moveout-demo-h" className="section-title">
            Move-out and deposit
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            JLT-2205 ends in about 40 days. Record the tenant&apos;s notice, then on the lease page: photograph each
            room, compare with move-in, confirm damage, complete the inspection (the deposit statement is emailed), let
            the tenant accept, have finance record the refund, and fast-forward to the move-out date: Ejari is cancelled
            and the unit goes back to preparation.
          </p>
          <form action={giveNotice} className="btn-row" style={{ alignItems: "end" }}>
            <label className="field">
              <span className="field-label">Lease</span>
              <select
                name="leaseRef"
                required
                disabled={!leasesForNotice.length}
                defaultValue={leasesForNotice.find((l) => l.ref.startsWith("JLT-2205"))?.ref}
              >
                {!leasesForNotice.length && <option value="">No active lease</option>}
                {leasesForNotice.map((l) => (
                  <option key={l.ref} value={l.ref}>
                    {l.ref}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn" disabled={!leasesForNotice.length}>
              Tenant gives notice (lease end)
            </button>
          </form>
        </section>
      )}
      {me?.role === "admin" && (
        <section className="panel panel-pad section" aria-labelledby="reset-demo-h">
          <h2 id="reset-demo-h" className="section-title">
            Reset demo data
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Deletes every lease, unit, application, email and approval, then seeds the demo again with the clock at
            today. Staff accounts stay. This can&apos;t be undone.
          </p>
          {sp.reset && <p className="row-done">{sp.reset}</p>}
          <form action={resetDemo} className="btn-row" style={{ alignItems: "end" }}>
            <label className="field">
              <span className="field-label">Type RESET to confirm</span>
              <input name="confirm" required pattern="RESET" autoComplete="off" />
            </label>
            <button type="submit" className="btn danger">
              Reset demo data
            </button>
          </form>
        </section>
      )}
    </>
  );
}
