import { EmptyState } from "@platform/ui/empty-state";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingChat } from "../../../../components/listing-chat";
import { publicEngine } from "../../../../lib/engine";

/** "AED 1,850,000": whole dirhams unless fils matter (design.md §8). */
const aed = (fils: number) => {
  const whole = Math.floor(fils / 100).toLocaleString("en-US");
  return fils % 100 ? `AED ${whole}.${String(fils % 100).padStart(2, "0")}` : `AED ${whole}`;
};

async function load(ref: string) {
  const res = await publicEngine()
    .public.listings[":ref"].$get({ param: { ref } })
    .catch(() => null);
  return res?.ok ? res.json() : null;
}

export async function generateMetadata({ params }: { params: Promise<{ ref: string }> }): Promise<Metadata> {
  const l = await load((await params).ref);
  return { title: l?.title ?? "Listing" };
}

/** The public listing page (S17): safe fields only; taken down automatically when the permit expires. */
export default async function PublicListing({ params }: { params: Promise<{ ref: string }> }) {
  const l = await load((await params).ref);
  if (!l) notFound();
  const facts = [
    l.bedrooms !== null ? `${l.bedrooms} bedroom${l.bedrooms === 1 ? "" : "s"}` : null,
    l.sizeSqft !== null ? `${l.sizeSqft.toLocaleString("en-US")} sq ft` : null,
    l.community,
  ].filter(Boolean);
  return (
    <article className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="m-0 text-[26px] font-semibold tracking-tight text-ink">{l.title}</h1>
        <p className="m-0 text-sm text-muted">{facts.join(" · ")}</p>
      </header>
      <p className="m-0 text-[22px] font-semibold tabular-nums text-ink">
        {l.askingPriceFils !== null ? aed(l.askingPriceFils) : "Price on request"}
      </p>
      {l.description ? <p className="m-0 whitespace-pre-line text-[15px] text-ink">{l.description}</p> : null}
      <dl className="m-0 grid gap-2 rounded-card border border-line bg-raised p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Advertising permit</dt>
          <dd className="m-0 font-mono text-ink">{l.permitNo ?? "None"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Reference</dt>
          <dd className="m-0 font-mono text-ink">{l.ref}</dd>
        </div>
      </dl>
      <ListingChat listingRef={l.ref} />
      {l.agent ? (
        <section aria-labelledby="contact" className="grid gap-1">
          <h2 id="contact" className="m-0 text-[15px] font-semibold text-ink">
            Contact the agent
          </h2>
          <p className="m-0 text-sm text-ink">
            {l.agent.name} · <a href={`mailto:${l.agent.email}`}>{l.agent.email}</a>
          </p>
        </section>
      ) : (
        <EmptyState title="Contact" body="Ask the agency for this listing." />
      )}
    </article>
  );
}
