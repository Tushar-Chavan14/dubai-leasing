import { Card } from "@platform/ui/card";
import type { Tile, TileCounts } from "../lib/tiles";

function Counts({ counts }: { counts: TileCounts }) {
  if (counts.state === "hidden") return null;
  if (counts.state === "unavailable") return <p className="m-0 text-sm text-muted">Not available</p>;
  return (
    <dl className="m-0 grid grid-cols-2 gap-3">
      <div className="grid gap-0.5">
        <dt className="text-xs text-muted">Open work</dt>
        <dd className="m-0 text-2xl font-semibold tabular-nums">{counts.counts.openWork}</dd>
      </div>
      <div className="grid gap-0.5">
        <dt className="text-xs text-muted">Waiting approvals</dt>
        <dd className="m-0 text-2xl font-semibold tabular-nums">{counts.counts.waitingApprovals}</dd>
      </div>
    </dl>
  );
}

/** The module chooser: one tile per module, each a link. Nothing else is shown (S69). */
export function PortalHome({
  tiles,
  signedIn = false,
  signOutAction,
}: {
  tiles: Tile[];
  /** Signed in with the portal (S70): says so when there is nothing to open, and offers Sign out. */
  signedIn?: boolean;
  signOutAction?: () => Promise<void>;
}) {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-3xl content-center gap-8 px-6 py-16">
      <h1 className="m-0 font-sans text-[26px] font-semibold tracking-tight">Choose a module</h1>
      {signedIn && tiles.length === 0 && (
        <p className="m-0 text-sm text-muted">
          No modules are available to this account. Ask an administrator to add you to Leasing or Sales.
        </p>
      )}
      <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
        {tiles.map((t) => (
          <li key={t.key}>
            <Card className="grid h-full content-between gap-6" data-tile={t.key}>
              <div className="grid gap-4">
                <h2 className="m-0 font-sans text-lg font-semibold">{t.name}</h2>
                <Counts counts={t.counts} />
              </div>
              <a
                href={t.href}
                className="inline-flex h-9 w-fit items-center rounded-full border border-line px-4 text-sm font-semibold !text-ink no-underline hover:bg-page"
              >
                Open {t.name}
              </a>
            </Card>
          </li>
        ))}
      </ul>
      {signedIn && (
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex h-9 w-fit cursor-pointer items-center rounded-full border border-line bg-transparent px-4 text-sm font-semibold text-ink hover:bg-page"
          >
            Sign out
          </button>
        </form>
      )}
    </main>
  );
}
