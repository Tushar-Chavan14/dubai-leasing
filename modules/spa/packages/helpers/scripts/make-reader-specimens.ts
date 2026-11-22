/**
 * Generates the fictional document specimens for the `spa:document-reader`, `spa:company-check` and
 * `spa:ownership-check` evals (S52, C20): `bun modules/spa/packages/helpers/scripts/make-reader-specimens.ts`.
 * Writes 180 PNGs (60 NOCs, bank letters and payment receipts, 30 companies × licence, memorandum and POA or resolution, 30 title deeds)
 * into `src/readers/evals/specimens/`. The text of each document comes from `fixtures.ts`, the same source as the labels.
 *
 * Every person, company, bank and number is invented and marked SPECIMEN · FICTIONAL: no national emblems, colours or
 * copies of real document designs.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { companyCases, ownershipCases, readerCases, type SpecimenSpec } from "../src/readers/evals/fixtures.ts";

const OUT = join(import.meta.dir, "../src/readers/evals/specimens");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const W = 1000;

function svg(d: SpecimenSpec): string {
  const rowH = 46;
  const H = 150 + d.lines.length * rowH + 40;
  const body = d.lines
    .map(
      (line, i) =>
        `<text x="48" y="${150 + i * rowH}" font-family="DejaVu Sans" font-size="${i === 0 ? 34 : 26}" font-weight="${i === 0 ? "bold" : "normal"}" fill="#14201a">${esc(line)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>
    <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="20" fill="#f7f8f6" stroke="#9aa39c" stroke-width="3"/>
    <rect x="8" y="8" width="${W - 16}" height="70" rx="20" fill="#dfe6e0"/>
    <text x="48" y="54" font-family="DejaVu Sans" font-size="26" font-weight="bold" fill="#1f2a24">${esc(d.title)}</text>
    <text x="${W - 48}" y="54" font-family="DejaVu Sans" font-size="18" fill="#5b665f" text-anchor="end">Demo specimen · not a real document</text>
    ${body}
    <text x="${W / 2}" y="${H / 2 + 20}" font-family="DejaVu Sans" font-size="64" font-weight="bold" fill="#c0392b" fill-opacity="0.11" text-anchor="middle" transform="rotate(-14 ${W / 2} ${H / 2})">SPECIMEN · FICTIONAL</text></svg>`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const docs: SpecimenSpec[] = [
  ...readerCases().map((c) => c.doc),
  ...companyCases().flatMap((c) => Object.values(c.docs)),
  ...ownershipCases().map((c) => c.deed),
];
for (const d of docs)
  writeFileSync(join(OUT, d.file), new Resvg(svg(d), { font: { loadSystemFonts: true } }).render().asPng());
console.log(`wrote ${docs.length} specimens to ${OUT}`);
