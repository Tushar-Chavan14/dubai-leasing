/** Escapes text for HTML (the console shows names and reasons a caller typed). */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export interface SimulatedPageInput {
  /** The browser title; it must say "simulated". Escaped here. */
  title: string;
  /** The page heading; it must say "simulated". Escaped here. */
  heading: string;
  /** Warning paragraphs as HTML (already escaped by the caller): what the service is and what it is not connected to. */
  notices: string[];
  /** The main content as HTML (already escaped by the caller). */
  main: string;
}

/**
 * The shell of a simulated registry's demo console. Deliberately plain (system font, greys, one outline colour for
 * state): no registry logo, colours, layout or screen copy (AGENTS rule 9).
 */
export function simulatedPage(i: SimulatedPageInput): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(i.title)}</title>
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
<header><h1>${esc(i.heading)}</h1>
${i.notices.map((n) => `<p class="warn">${n}</p>`).join("\n")}</header>
<main>
${i.main}
</main></body></html>`;
}
