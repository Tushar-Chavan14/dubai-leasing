import Link from "next/link";

/** Shown instead of a form when the home an enquiry was about has a deal, was sold or can't be found (M6, S81). */
export function DealUnavailable({ code }: { code?: string | undefined }) {
  return (
    <div className="grid max-w-[620px] gap-3">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">This home is no longer available</h1>
      <p className="m-0 text-sm text-muted">
        {code
          ? `${code} has a deal or is no longer for sale, so a new deal can't start on it.`
          : "The home this enquiry was about can't be found."}{" "}
        <Link href="/work" className="font-semibold text-ink! underline">
          Back to Work
        </Link>
      </p>
    </div>
  );
}
