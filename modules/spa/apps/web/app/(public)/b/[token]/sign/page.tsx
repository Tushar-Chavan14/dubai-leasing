import { buttonClass } from "@platform/ui/button";
import { Banner, FIELD, INPUT, LABEL } from "@platform/ui/form";
import type { Metadata } from "next";
import { linkProblem, signError } from "../../../../../lib/buyer-link";
import { publicEngine } from "../../../../../lib/engine";
import { signAgreement } from "./actions";

export const metadata: Metadata = { title: "Sign your agreement", robots: { index: false } };

/** A signer's page (design.md §7.3): read the full PDF, type your name, tick consent, sign. */
export default async function SignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { token } = await params;
  const { error, done } = await searchParams;
  if (done)
    return (
      <section className="grid gap-2" aria-live="polite">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">Signed</h1>
        <p className="m-0 text-sm text-ink">
          Thank you. Your signature is recorded. Once everyone has signed you will be emailed a signed copy.
        </p>
      </section>
    );
  const res = await publicEngine()
    .public["sign-links"][":token"].$get({ param: { token } })
    .catch(() => null);
  if (!res?.ok) {
    const code = ((await res?.json().catch(() => null)) as { code?: string } | null)?.code;
    const p = linkProblem(res?.status ?? 502, code);
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
          Sign your {s.document} · {s.property}
        </h1>
        <p className="m-0 text-sm text-muted">
          You sign {s.position} of {s.of}. Link valid until{" "}
          {new Date(s.expiresAt).toLocaleDateString("en-GB", {
            timeZone: "Asia/Dubai",
            day: "numeric",
            month: "short",
            year: "numeric",
          })}{" "}
          (UAE time).
        </p>
      </header>
      {error && (
        <Banner tone="bad" role="alert">
          {signError(error)}
        </Banner>
      )}
      <p className="m-0 text-sm text-ink">
        <a href={`/b/${token}/document`} target="_blank" rel="noreferrer">
          Read the full agreement (PDF)
        </a>
        . Please read all of it before you sign.
      </p>
      {s.yourTurn ? (
        <form action={signAgreement.bind(null, token)} className="grid gap-4">
          <div className={FIELD}>
            <label htmlFor="typedName" className={LABEL}>
              Type your full name as written on the agreement: {s.name}
            </label>
            <input id="typedName" name="typedName" required autoComplete="off" className={INPUT} />
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="consent" required className="mt-1" />I have read the agreement and I agree to
            sign it electronically.
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Sign
          </button>
        </form>
      ) : (
        <Banner tone="warn">
          An earlier signer has not signed yet. You will be able to sign here after them; there is nothing to do now.
        </Banner>
      )}
    </article>
  );
}
