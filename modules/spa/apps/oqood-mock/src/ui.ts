import { esc, simulatedPage } from "@platform/adapters";
import { PROFILES } from "./certificate.ts";
import type { registrations, submissions } from "./schema.ts";

type Reg = typeof registrations.$inferSelect;
type Sub = typeof submissions.$inferSelect;

/** The demo console of the simulated registry: plain, with no registry logo, colours, layout or screen copy. */
export function page(regs: Reg[], subs: Sub[]): string {
  const regRows = regs
    .map(
      (r) =>
        `<tr><td>${esc(PROFILES[r.kind].systemLabel)}</td><td><a href="/api/v1/oqood/${encodeURIComponent(r.registryNo)}/certificate.pdf">${esc(r.registryNo)}</a></td><td>${esc(r.unitNo)}</td><td>${esc(r.buyers.join(", "))}</td><td>${esc(r.issuedOn)}</td><td><span class="tag">${esc(r.state)}</span></td></tr>`,
    )
    .join("");
  const subRows = subs
    .map(
      (s) =>
        `<tr><td>${esc(PROFILES[s.kind].systemLabel)}</td><td>${esc(s.receivedAt.toISOString().replace("T", " ").slice(0, 19))}</td><td>${esc(s.unitNo)}</td><td><span class="tag ${esc(s.outcome)}">${esc(s.outcome)}</span></td><td>${
          s.outcome === "issued"
            ? esc(s.registryNo)
            : s.reasons.map((r) => `<div><b>${esc(r.code)}</b> ${esc(r.message)}</div>`).join("")
        }</td></tr>`,
    )
    .join("");
  return simulatedPage({
    title: "Simulated registry (demo)",
    heading: "Simulated registry (demo)",
    notices: [
      "<b>Simulated Oqood (demo)</b> and <b>Simulated trustee transfer (demo)</b>, side by side.",
      "A mock registry for demos and tests. It is not connected to the Dubai Land Department. Its certificates are not valid anywhere.",
    ],
    main: `<h2>Registrations</h2>
${regs.length ? `<table><tr><th>Service</th><th>Number</th><th>Unit</th><th>Buyers</th><th>Issued</th><th>State</th></tr>${regRows}</table>` : '<p class="empty">No registrations yet.</p>'}
<h2>Latest requests</h2>
${subs.length ? `<table><tr><th>Service</th><th>Received (UTC)</th><th>Unit</th><th>Outcome</th><th>Detail</th></tr>${subRows}</table>` : '<p class="empty">No requests yet.</p>'}`,
  });
}
