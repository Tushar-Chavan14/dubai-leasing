import type { Metadata } from "next";
import Link from "next/link";
import { initials } from "../../components/ui";
import { publicGet } from "../../lib/engine";
import { roleLabel } from "../../lib/format";
import { BrandMark, IconWarning } from "../../lib/icons";
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
    <div className="login">
      <section className="art">
        <div className="brand">
          <BrandMark size={26} />
          Dubai Leasing
        </div>
        <div>
          <h1>Every Dubai lease, on time and on record.</h1>
          <p>
            Units, renewals and approvals in one place. Notice dates come from the rulebook, every decision is made by a
            person, and every step is kept for the Rental Disputes Centre.
          </p>
        </div>
        <p className="foot">Demo build. All people, IDs and Ejari numbers are fictional; Ejari is simulated.</p>
      </section>

      <section className="form-side">
        <div>
          <h2>Sign in</h2>
          <p className="muted">Choose a demo staff member. What you can approve depends on the role.</p>
          {error && (
            <div className="alert" data-tone="bad" role="alert" style={{ marginTop: 16 }}>
              <IconWarning size={16} />
              Sign-in failed. Check that the engine is running and try again.
            </div>
          )}
          {users === null ? (
            <div className="alert" data-tone="warn" style={{ marginTop: 20 }}>
              <IconWarning size={16} />
              <span>
                The engine isn&apos;t reachable, or demo sign-in is off. Start everything with{" "}
                <span className="ref">bun run dev</span>.
              </span>
            </div>
          ) : (
            <form action={demoLogin}>
              <fieldset className="role-list">
                <legend className="sr-only">Staff member</legend>
                {sorted.map((u, i) => (
                  <label key={u.email} className="role-option">
                    <input type="radio" name="email" value={u.email} defaultChecked={i === 0} required />
                    <span>
                      <span className="avatar" aria-hidden="true">
                        {initials(u.name)}
                      </span>
                      <b>
                        {u.name}, {roleLabel(u.role).toLowerCase()}
                      </b>
                      <small>{ROLE_HINT[u.role] ?? ""}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button type="submit" className="btn primary block">
                Sign in
              </button>
            </form>
          )}
          <p className="muted" style={{ marginTop: 20 }}>
            Looking for a home? <Link href="/properties">Browse properties</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
