import type { PublicPropertyDetail } from "@spa/core";
import type { ReactNode } from "react";
import { aed } from "../../lib/public-filters";

/**
 * The property page's right column: the price, the advertising permit (resale listings only), the agent (a name, no
 * contact detail) and an `actions` slot. The slot holds the enquiry and viewing form (S79) and, on a listing, a secondary "Chat with the assistant" button that opens the listing chat.
 */
export function PropertyAside({ p, actions }: { p: PublicPropertyDetail; actions?: ReactNode }) {
  return (
    <aside
      className="grid gap-4 rounded-[22px] border border-line bg-page p-6 md:[position:sticky] md:top-24"
      aria-label="Price and contact"
    >
      <p className="m-0 text-3xl font-semibold tracking-tight tabular-nums">{aed(p.priceFils)}</p>
      {p.source === "developer" && (
        <p className="m-0 text-sm text-muted">
          New home from {p.developerName ?? "the developer"}
          {p.handover ? `, handover ${p.handover}` : ""}
        </p>
      )}
      {p.permitNo && (
        <dl className="m-0 grid gap-0.5 border-t border-line pt-4 text-sm">
          <dt className="text-muted">Advertising permit</dt>
          <dd className="m-0 font-mono text-base text-ink tabular-nums">{p.permitNo}</dd>
        </dl>
      )}
      {p.agent && (
        <div className="grid gap-0.5 border-t border-line pt-4 text-sm">
          <span className="text-muted">Listing agent</span>
          <b className="text-base font-semibold text-ink">{p.agent.name}</b>
        </div>
      )}
      {actions && <div className="grid gap-3 border-t border-line pt-4">{actions}</div>}
    </aside>
  );
}
