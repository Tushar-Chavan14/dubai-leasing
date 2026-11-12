import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { TENANCY_OPS } from "../../../../lib/env";
import { AskAiMenu } from "../../../../components/ask-ai";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { Button, buttonClass } from "../../../../components/ui/button";
import { Banner, INPUT } from "../../../../components/ui/form";
import { Block, FormGrid, Panel, Preview, SET_SELECT, SetPage, SField } from "../../../../components/ui/settings";
import { engine } from "../../../../lib/engine";
import { milestoneLabel, milestoneScope, weekdayDate } from "../../../../lib/format";
import { ClockIcon as IconClock, WarningIcon as IconWarning } from "@phosphor-icons/react/dist/ssr";

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

/** Tawtheeq demo: the simulated Abu Dhabi registry rejects the next registration (name mismatch). */
async function rejectNextTawtheeq() {
  "use server";
  const r = await engine("/api/demo/ejari/reject-next", {
    method: "POST",
    body: JSON.stringify({ system: "tawtheeq" }),
  });
  const msg = r.ok
    ? "The next Tawtheeq submission will be rejected for a name mismatch (simulated)."
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
      <SetPage title="Demo clock">
        <Banner tone="warn">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          The demo clock is only available when the engine runs with DEMO_MODE=true.
        </Banner>
      </SetPage>
    );
  }
  const mono = "font-mono text-[13px]";
  return (
    <SetPage
      title="Demo clock"
      lede={
        <>
          Moves the engine&apos;s clock forward. Every deadline that falls due fires once, in date order, exactly as it
          would on the day. &ldquo;Back to today&rdquo; returns to real time and keeps all data (also{" "}
          <span className={mono}>bun run demo:rewind</span>); <span className={mono}>bun run demo:reset</span> wipes
          everything and re-seeds.
        </>
      }
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Demo")} />}
    >
      <FormGrid
        preview={
          <Preview title="Last jump" lede="What fired when you moved the clock.">
            <div aria-live="polite" className="grid gap-2 text-sm">
              {sp.error ? (
                <Banner tone="bad" role="alert">
                  <IconWarning size={16} className="mt-0.5 shrink-0" />
                  {sp.error}
                </Banner>
              ) : sp.rewound ? (
                <p className="m-0 text-muted">Back to today. All data kept.</p>
              ) : sp.n === undefined ? (
                <p className="m-0 text-muted">
                  Nothing yet. Try 10 days, then 31, to watch MRN-1204 enter its renewal window and get a notice.
                </p>
              ) : sp.n === "0" ? (
                <p className="m-0 text-muted">Moved {sp.d} days. No deadlines fell due.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1.5 p-0">
                  {(sp.fired ?? "")
                    .split("|")
                    .filter(Boolean)
                    .map((m) => (
                      <li key={m} className="rounded-xl border border-line bg-page px-3 py-2">
                        <b className="block text-sm font-semibold">{milestoneLabel(m)}</b>
                        <span className="text-[13px] text-muted">{milestoneScope(m)}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </Preview>
        }
      >
        <Panel className="grid gap-5 p-5">
          <div className="flex items-center gap-3.5">
            <span aria-hidden className="grid size-11 flex-none place-items-center rounded-xl bg-accent text-on-accent">
              <IconClock size={22} />
            </span>
            <div>
              <div className="font-sans text-[22px] font-semibold tracking-tight">{weekdayDate(clock.data.today)}</div>
              <p className="m-0 text-[13px] text-muted">
                {clock.data.offsetDays ? `${clock.data.offsetDays} days ahead of real time` : "Real time, no offset"}
              </p>
            </div>
          </div>
          <form action={fastForward} className="grid gap-2 border-t border-line pt-5">
            <span className="text-xs font-semibold text-muted">Jump ahead</span>
            <div className="flex flex-wrap gap-2">
              {[1, 7, 10, 30, 90].map((d) => (
                <Button key={d} type="submit" name="days" value={d} variant="ghost" size="sm">
                  {d === 1 ? "1 day" : `${d} days`}
                </Button>
              ))}
            </div>
          </form>
          <form action={fastForward} className="flex flex-wrap items-end gap-3">
            <SField label="Or any number of days" className="w-36">
              <input type="number" name="days" min={1} max={800} defaultValue={31} className={INPUT} />
            </SField>
            <Button type="submit" variant="primary" size="sm">
              Fast-forward
            </Button>
          </form>
          {clock.data.offsetDays ? (
            <form action={rewind} className="grid gap-2 border-t border-line pt-5">
              <span className="text-xs font-semibold text-muted">Back to real time</span>
              <div>
                <Button type="submit" variant="ghost" size="sm">
                  Back to today
                </Button>
              </div>
              <p className="m-0 text-[13px] text-muted">
                Keeps applications, leases and emails. Deadlines that already fired stay fired.
              </p>
            </form>
          ) : null}
        </Panel>
        {(sp.seeded || !leasesForPay.length || !leasesForNotice.some((l) => l.ref.startsWith("JLT-2205"))) && (
          <Panel className="p-5">
            <Block
              id="seed-demo-h"
              title="Demo leases"
              lede={`${
                leasesForPay.length
                  ? "The move-out demo lease (JLT-2205) isn't here."
                  : "There is no active lease to run these demos on."
              } Add the missing demo leases next to your data; nothing is deleted or changed.`}
            >
              {sp.seeded && <Done>{sp.seeded}</Done>}
              <form action={seedLeases}>
                <Button type="submit" variant="ghost" size="sm">
                  Add missing demo leases
                </Button>
              </form>
            </Block>
          </Panel>
        )}
        {TENANCY_OPS && (
          <Panel className="p-5">
            <Block
              id="pay-demo-h"
              title="Rent collections"
              lede="Fast-forward to a cheque date, then bounce it: the tenant gets friendly reminders, and after two a formal reminder goes to a leasing manager for approval. Its accepted email starts the rulebook's waiting period."
            >
              {sp.pay && <Done>{sp.pay}</Done>}
              <form action={demoPayment} className="flex flex-wrap items-end gap-3">
                <SField label="Lease" className="min-w-40">
                  <select name="leaseRef" required disabled={!leasesForPay.length} className={SET_SELECT}>
                    {!leasesForPay.length && <option value="">No active lease</option>}
                    {leasesForPay.map((l) => (
                      <option key={l.ref} value={l.ref}>
                        {l.ref}
                      </option>
                    ))}
                  </select>
                </SField>
                <Button
                  type="submit"
                  name="action"
                  value="bounce"
                  variant="ghost"
                  size="sm"
                  disabled={!leasesForPay.length}
                >
                  Bounce the next cheque
                </Button>
                <Button
                  type="submit"
                  name="action"
                  value="pay"
                  variant="ghost"
                  size="sm"
                  disabled={!leasesForPay.length}
                >
                  Mark the next payment paid
                </Button>
              </form>
            </Block>
          </Panel>
        )}
        <Panel className="p-5">
          <Block
            id="ejari-demo-h"
            title="Simulated Ejari"
            lede="Contracts are registered with a mock registry that runs beside the engine. It checks the property, the landlord and the tenant's name exactly as written. MRN-1608 is waiting for its contract: its tenant's verified name is in capitals, the registry holds it in title case, and the registration helper corrects it once."
          >
            {sp.ejari && <Done>{sp.ejari}</Done>}
            <div className="flex flex-wrap items-center gap-2">
              <a
                className={buttonClass("ghost", "sm")}
                href={process.env.EJARI_MOCK_URL ?? "http://localhost:4100"}
                target="_blank"
                rel="noreferrer"
              >
                Open the simulated registry
              </a>
              <form action={rejectNextEjari}>
                <Button type="submit" variant="ghost" size="sm">
                  Reject the next Ejari submission
                </Button>
              </form>
              <form action={rejectNextTawtheeq}>
                <Button type="submit" variant="ghost" size="sm">
                  Reject the next Tawtheeq submission (simulated)
                </Button>
              </form>
            </div>
          </Block>
        </Panel>
        {TENANCY_OPS && (
          <Panel className="p-5">
            <Block
              id="moveout-demo-h"
              title="Move-out and deposit"
              lede="JLT-2205 ends in about 40 days. Record the tenant's notice, then on the lease page: photograph each room, compare with move-in, confirm damage, complete the inspection (the deposit statement is emailed), let the tenant accept, have finance record the refund, and fast-forward to the move-out date: Ejari is cancelled and the unit goes back to preparation."
            >
              <form action={giveNotice} className="flex flex-wrap items-end gap-3">
                <SField label="Lease" className="min-w-40">
                  <select
                    name="leaseRef"
                    required
                    disabled={!leasesForNotice.length}
                    defaultValue={leasesForNotice.find((l) => l.ref.startsWith("JLT-2205"))?.ref}
                    className={SET_SELECT}
                  >
                    {!leasesForNotice.length && <option value="">No active lease</option>}
                    {leasesForNotice.map((l) => (
                      <option key={l.ref} value={l.ref}>
                        {l.ref}
                      </option>
                    ))}
                  </select>
                </SField>
                <Button type="submit" variant="ghost" size="sm" disabled={!leasesForNotice.length}>
                  Tenant gives notice (lease end)
                </Button>
              </form>
            </Block>
          </Panel>
        )}
        {me?.role === "admin" && (
          <Panel className="p-5">
            <Block
              id="reset-demo-h"
              title="Reset demo data"
              lede="Deletes every lease, unit, application, email and approval, then seeds the demo again with the clock at today. Staff accounts stay. This can't be undone."
            >
              {sp.reset && <Done>{sp.reset}</Done>}
              <form action={resetDemo} className="flex flex-wrap items-end gap-3">
                <SField label="Type RESET to confirm" className="min-w-48">
                  <input name="confirm" required pattern="RESET" autoComplete="off" className={INPUT} />
                </SField>
                <Button type="submit" variant="danger" size="sm">
                  Reset demo data
                </Button>
              </form>
            </Block>
          </Panel>
        )}
      </FormGrid>
    </SetPage>
  );
}

/** A short result line after a demo action. */
function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 rounded-xl bg-accent px-3.5 py-2.5 text-sm text-on-accent" role="status">
      {children}
    </p>
  );
}
