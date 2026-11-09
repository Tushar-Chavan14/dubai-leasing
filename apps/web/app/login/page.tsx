import type { Metadata } from "next";
import Link from "next/link";
import { initials } from "../../components/ui";
import { publicGet } from "../../lib/engine";
import { roleLabel } from "../../lib/format";
import { BrandMark } from "../../lib/icons";
import { WarningIcon as IconWarning } from "@phosphor-icons/react/dist/ssr";
import { Skyline } from "../../components/public/hero-panel";
import { buttonClass } from "../../components/ui/button";
import { demoLogin } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ROLE_HINT: Record<string, string> = {
  leasing_officer: "Units, contracts, Ejari, move-in and move-out",
  leasing_manager: "Approves notices, offers and formal reminders",
  finance: "Approves refunds above the threshold",
  admin: "Company limits, rules, users and imports",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const users = await publicGet<{ email: string; name: string; role: string }[]>("/api/auth/demo-users");
  const order = ["leasing_manager", "leasing_officer", "finance", "admin"];
  const sorted = users?.toSorted((a, b) => order.indexOf(a.role) - order.indexOf(b.role)) ?? [];

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-page text-ink md:grid-cols-[minmax(420px,1fr)_minmax(0,1.1fr)]">
      <section className="grid place-items-center px-4 py-10 md:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            <BrandMark size={26} />
            Dubai Leasing
          </div>
          <div className="rounded-[22px] border border-line bg-page p-6 md:p-8">
            <h1 className="m-0 mb-1.5! text-[28px] leading-tight font-semibold tracking-[-0.03em]">Sign in</h1>
            <p className="m-0 text-muted">Choose a demo staff member. What you can approve depends on the role.</p>
            {error && (
              <div
                className="mt-4 flex items-center gap-2 rounded-input border border-danger px-3 py-2.5 text-sm"
                role="alert"
              >
                <IconWarning size={16} />
                Sign-in failed. Check that the engine is running and try again.
              </div>
            )}
            {users === null ? (
              <div className="mt-5 flex items-start gap-2 rounded-input border border-warning px-3 py-2.5 text-sm">
                <IconWarning size={16} />
                <span>
                  The engine isn&apos;t reachable, or demo sign-in is off. Start everything with{" "}
                  <span className="font-mono">bun run dev</span>.
                </span>
              </div>
            ) : (
              <form action={demoLogin}>
                <fieldset className="my-5 grid gap-2 border-0 p-0">
                  <legend className="sr-only">Staff member</legend>
                  {sorted.map((u, i) => (
                    <label key={u.email} className="relative block">
                      <input
                        type="radio"
                        name="email"
                        value={u.email}
                        defaultChecked={i === 0}
                        required
                        className="peer absolute opacity-0"
                      />
                      <span className="grid cursor-pointer grid-cols-[34px_minmax(0,1fr)] items-center gap-x-3 rounded-card border border-line bg-page px-3.5 py-3 transition-colors duration-150 ease-out peer-checked:border-ink peer-checked:bg-raised peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink motion-reduce:transition-none">
                        <span
                          className="row-span-2 grid size-[34px] place-items-center rounded-full bg-accent text-xs font-semibold text-on-accent"
                          aria-hidden="true"
                        >
                          {initials(u.name)}
                        </span>
                        <b className="font-semibold">
                          {u.name}, {roleLabel(u.role).toLowerCase()}
                        </b>
                        <small className="text-sm text-muted">{ROLE_HINT[u.role] ?? ""}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className={`${buttonClass("primary")} w-full`}>
                  Sign in
                </button>
              </form>
            )}
            <p className="mt-5! mb-0 text-sm text-muted">
              Looking for a home?{" "}
              <Link href="/customer/properties" className="text-ink! underline underline-offset-4">
                Browse properties
              </Link>
            </p>
          </div>
          <p className="mt-5! text-center text-xs text-muted md:hidden">
            Demo build. All people, IDs and Ejari numbers are fictional; Ejari is simulated.
          </p>
        </div>
      </section>

      <aside className="relative hidden flex-col justify-between overflow-hidden bg-accent p-12 text-on-accent md:flex">
        <Skyline />
        <p className="relative m-0 text-sm font-semibold">Leasing for Dubai, from enquiry to move-out</p>
        <div className="relative">
          <h2 className="m-0 max-w-[14ch] text-5xl leading-[1.04] font-semibold tracking-[-0.035em]">
            Every Dubai lease, on time and on record.
          </h2>
          <p className="mt-5! mb-0 max-w-[44ch] text-base">
            Notice dates come from the published rulebook, a person approves every step that creates a legal or money
            commitment, and every decision is kept for the Rental Disputes Centre.
          </p>
        </div>
        <p className="relative m-0 text-sm">
          Demo build. All people, IDs and Ejari numbers are fictional; Ejari is simulated.
        </p>
      </aside>
    </div>
  );
}
