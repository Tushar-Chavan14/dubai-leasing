import { esc, simulatedPage } from "@platform/adapters";
import { REGISTRY_PROFILES } from "./certificate.ts";
import type { registrations, submissions } from "./schema.ts";

type Reg = typeof registrations.$inferSelect;
type Sub = typeof submissions.$inferSelect;

/**
 * The demo console of the simulated registry. Deliberately plain (system font, greys, one
 * outline colour for state): no DLD logo, colours, layout or screen copy.
 */
export function page(regs: Reg[], subs: Sub[]): string {
  const prefix = (system: string) => (system === "tawtheeq" ? "/tawtheeq" : "");
  const label = (system: string) => REGISTRY_PROFILES[system === "tawtheeq" ? "tawtheeq" : "ejari"].systemLabel;
  const regRows = regs
    .map(
      (r) =>
        `<tr><td>${label(r.system)}</td><td><a href="${prefix(r.system)}/api/v1/registrations/${encodeURIComponent(r.ejariNo)}/certificate.pdf">${esc(r.ejariNo)}</a></td><td>${esc(r.dldPropertyNo)}</td><td>${esc(r.tenantName)}</td><td>${esc(r.startOn)} → ${esc(r.endOn)}</td><td>${esc(r.issuedOn)}</td><td><span class="tag ${esc(r.state)}">${esc(r.state)}</span></td></tr>`,
    )
    .join("");
  const subRows = subs
    .map(
      (s) =>
        `<tr><td>${label(s.system)}</td><td>${esc(s.receivedAt.toISOString().replace("T", " ").slice(0, 19))}</td><td>${esc(s.kind)}</td><td>${esc(s.payload.dldPropertyNo)}</td><td>${esc(s.payload.tenantNameEn)}</td><td><span class="tag ${esc(s.outcome)}">${esc(s.outcome)}</span></td><td>${
          s.outcome === "issued"
            ? esc(s.ejariNo)
            : s.reasons.map((r) => `<div><b>${esc(r.code)}</b> ${esc(r.message)}</div>`).join("")
        }</td></tr>`,
    )
    .join("");
  return simulatedPage({
    title: "Simulated registries (demo)",
    heading: "Simulated registries (demo)",
    notices: [
      "<b>Simulated Ejari (demo)</b> and <b>Simulated Tawtheeq (demo)</b>, side by side.",
      "A mock registry for demos and tests. The simulated Ejari is not connected to the Dubai Land Department, and the simulated Tawtheeq is not connected to any Abu Dhabi government system. Their certificates are not valid anywhere.",
    ],
    main: `<h2>Registrations</h2>
${regs.length ? `<table><tr><th>System</th><th>Number</th><th>Property</th><th>Tenant</th><th>Period</th><th>Issued</th><th>State</th></tr>${regRows}</table>` : '<p class="empty">No registrations yet.</p>'}
<h2>Latest requests</h2>
${subs.length ? `<table><tr><th>System</th><th>Received (UTC)</th><th>Kind</th><th>Property</th><th>Tenant</th><th>Outcome</th><th>Detail</th></tr>${subRows}</table>` : '<p class="empty">No requests yet.</p>'}`,
  });
}
