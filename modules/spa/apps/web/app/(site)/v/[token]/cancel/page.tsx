import { buttonClass } from "@platform/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import { cancelViewing } from "./actions";

// The token is in the address: never send it on in a Referer header.
export const metadata: Metadata = { title: "Cancel your viewing", robots: { index: false }, referrer: "no-referrer" };

const RESULTS: Record<string, { title: string; body: string }> = {
  cancelled: {
    title: "Your viewing is cancelled",
    body: "We have emailed you to confirm. You are welcome to book another time.",
  },
  already_cancelled: { title: "Already cancelled", body: "This viewing was cancelled earlier. Nothing more to do." },
  not_found: {
    title: "This link is no longer valid",
    body: "The viewing may have taken place already, or the link is out of date.",
  },
  busy: { title: "Too many requests", body: "Wait a few minutes and try again." },
  error: { title: "We couldn't cancel it", body: "Try again in a moment." },
};

/**
 * The visitor's cancel page (S79). The link in the email only opens this page; nothing is cancelled until the button is
 * pressed, so a mail scanner opening the link can't cancel it. A second press, or an old link, says "Already cancelled".
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const { token } = await params;
  const { result } = await searchParams;
  const done = result ? (RESULTS[result] ?? RESULTS.error!) : null;
  return (
    <div className="mx-auto grid w-full max-w-[560px] gap-5 px-4 py-12 md:px-8">
      {done ? (
        <section aria-live="polite" className="grid gap-3 rounded-[22px] border border-line bg-page p-6">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">{done.title}</h1>
          <p className="m-0 text-base text-muted">{done.body}</p>
          <Link href="/properties" className={`${buttonClass("primary")} w-fit`}>
            Browse homes
          </Link>
        </section>
      ) : (
        <form action={cancelViewing} className="grid gap-3 rounded-[22px] border border-line bg-page p-6">
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Cancel your viewing?</h1>
          <p className="m-0 text-base text-muted">
            The time will go back to other visitors. You can book another time from the home&apos;s page.
          </p>
          <input type="hidden" name="token" value={token} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClass("primary")}>
              Cancel this viewing
            </button>
            <Link href="/properties" className={buttonClass("ghost")}>
              Keep it
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
