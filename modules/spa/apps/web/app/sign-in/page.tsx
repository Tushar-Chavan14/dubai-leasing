import { buttonClass } from "@platform/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";
import type { Metadata } from "next";
import { publicEngine } from "../../lib/engine";
import { webEnv } from "../../lib/env";
import { demoSignIn, signIn } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  wrong: "That email and password don't match. Try again.",
  down: "The sales engine isn't answering. Try again in a moment.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const demo = webEnv().SPA_DEMO_MODE;
  const users = demo
    ? await publicEngine()
        .api.auth["demo-users"].$get()
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    : [];
  return (
    <main id="main" className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-6 py-12">
      <header className="grid gap-1">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="m-0 text-sm text-muted">Sales desk</p>
      </header>
      {error && ERRORS[error] && (
        <Banner tone="bad" role="alert">
          {ERRORS[error]}
        </Banner>
      )}
      {demo ? (
        // Demo mode: pick a fictional user, like the leasing demo login (S33). No passwords.
        <section aria-labelledby="demo-users" className="grid gap-2">
          <h2 id="demo-users" className="m-0 text-[15px] font-semibold text-ink">
            Choose a demo user
          </h2>
          <p className="m-0 text-[12.5px] text-muted">Fictional staff, one per role.</p>
          {users.length === 0 && <Banner tone="warn">No demo users yet. Run the demo seed first.</Banner>}
          <ul className="m-0 grid list-none gap-2 p-0">
            {users.map((u) => (
              <li key={u.email}>
                <form action={demoSignIn}>
                  <input type="hidden" name="email" value={u.email} />
                  <button
                    type="submit"
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-page px-3.5 py-2.5 text-left font-sans text-sm text-ink hover:bg-raised"
                  >
                    <span className="font-semibold">{u.name}</span>
                    <span className="text-[12.5px] text-muted">{u.roleLabel}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <form action={signIn} className="grid gap-4 rounded-card border border-line bg-page p-6">
          <label className={FIELD}>
            <span className={LABEL}>Email</span>
            <input name="email" type="email" autoComplete="username" required className={INPUT} />
          </label>
          <label className={FIELD}>
            <span className={LABEL}>Password</span>
            <input name="password" type="password" autoComplete="current-password" required className={INPUT} />
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Sign in
          </button>
        </form>
      )}
    </main>
  );
}
