import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";
import { buttonClass } from "@platform/ui/button";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInEnabled } from "../../lib/server";
import { SLOW, WRONG } from "../../lib/sign-in";
import { signIn } from "../actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong: WRONG,
  slow: SLOW,
  down: "Sign-in isn't available right now. Try again in a moment.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!signInEnabled()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="mx-auto grid min-h-screen max-w-md content-center gap-6 px-6 py-12">
      <header className="grid gap-1">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">Sign in</h1>
        <p className="m-0 text-sm text-muted">One sign-in for Leasing and Sales</p>
      </header>
      {error && ERRORS[error] && (
        <Banner tone="bad" role="alert">
          {ERRORS[error]}
        </Banner>
      )}
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
    </main>
  );
}
