const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

interface Reg {
  ejari_no: string;
  dld_property_no: string;
  tenant_name: string;
  start_on: string;
  end_on: string;
  state: string;
  issued_on: string;
}
interface Sub {
  kind: string;
  outcome: string;
  ejari_no: string | null;
  reasons: { code: string; message: string }[];
  property: string;
  tenant: string;
  received_at: Date;
}

/**
 * The demo console of the simulated registry. Deliberately plain (system font, greys, one
 * outline colour for state): no DLD logo, colours, layout or screen copy.
 */
export function page(regs: Reg[], subs: Sub[]): string {
  const regRows = regs
    .map(
      (r) =>
        `<tr><td><a href="/api/v1/registrations/${encodeURIComponent(r.ejari_no)}/certificate.pdf">${esc(r.ejari_no)}</a></td><td>${esc(r.dld_property_no)}</td><td>${esc(r.tenant_name)}</td><td>${esc(r.start_on)} → ${esc(r.end_on)}</td><td>${esc(r.issued_on)}</td><td><span class="tag ${esc(r.state)}">${esc(r.state)}</span></td></tr>`,
    )
    .join("");
  const subRows = subs
    .map(
      (s) =>
        `<tr><td>${esc(new Date(s.received_at).toISOString().replace("T", " ").slice(0, 19))}</td><td>${esc(s.kind)}</td><td>${esc(s.property)}</td><td>${esc(s.tenant)}</td><td><span class="tag ${esc(s.outcome)}">${esc(s.outcome)}</span></td><td>${
          s.outcome === "issued"
            ? esc(s.ejari_no)
            : s.reasons.map((r) => `<div><b>${esc(r.code)}</b> ${esc(r.message)}</div>`).join("")
        }</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulated Ejari (demo)</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;color:#222;background:#fafafa}
header{padding:20px 24px;border-bottom:1px solid #ddd;background:#fff}
h1{font-size:20px;margin:0 0 4px}
.warn{margin:0;color:#555;font-size:14px}
main{padding:16px 24px;max-width:1100px}
h2{font-size:15px;margin:24px 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #eee;vertical-align:top}
th{color:#666;font-weight:600}
.tag{display:inline-block;padding:1px 7px;border:1px solid #999;border-radius:4px;font-size:12px}
.tag.rejected,.tag.unavailable{border-style:dashed}
.empty{color:#777;padding:12px 0}
a{color:#222}
</style></head><body>
<header><h1>Simulated Ejari (demo)</h1>
<p class="warn">A mock registry for demos and tests. It is not connected to the Dubai Land Department and its certificates are not valid anywhere.</p></header>
<main>
<h2>Registrations</h2>
${regs.length ? `<table><tr><th>Number</th><th>Property</th><th>Tenant</th><th>Period</th><th>Issued</th><th>State</th></tr>${regRows}</table>` : '<p class="empty">No registrations yet.</p>'}
<h2>Latest requests</h2>
${subs.length ? `<table><tr><th>Received (UTC)</th><th>Kind</th><th>Property</th><th>Tenant</th><th>Outcome</th><th>Detail</th></tr>${subRows}</table>` : '<p class="empty">No requests yet.</p>'}
</main></body></html>`;
}
