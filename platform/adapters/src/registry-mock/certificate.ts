import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { RegistryMockProfile } from "./profile.ts";

export interface SimulatedCertificateInput {
  profile: RegistryMockProfile;
  /** The PDF's document title; it must say "Simulated". */
  documentTitle: string;
  /** Label and value lines, top to bottom. */
  rows: readonly (readonly [label: string, value: string])[];
  /** Font size of the diagonal watermark (default 26): long wording needs a smaller one. */
  watermarkSize?: number;
}

const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

/**
 * A plain demo certificate, watermarked SIMULATED on the page. Grey type only: no registry logo, colours, layout or
 * wording (AGENTS rule 9). The wording comes from the module's profile.
 */
export async function simulatedCertificate(i: SimulatedCertificateInput): Promise<Uint8Array> {
  const w = i.profile.wording;
  const doc = await PDFDocument.create();
  doc.setTitle(i.documentTitle);
  doc.setProducer(w.producer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const ink = rgb(0.15, 0.15, 0.15);
  page.drawText(w.watermark, {
    x: 70,
    y: 250,
    size: i.watermarkSize ?? 26,
    font: bold,
    color: rgb(0.6, 0.6, 0.6),
    opacity: 0.35,
    rotate: degrees(40),
  });
  let y = 780;
  const text = (s: string, size = 11, f = font) => {
    page.drawText(safe(s), { x: 56, y, size, font: f, color: ink });
    y -= size * 1.7;
  };
  text(w.title, 18, bold);
  text(w.subline, 9);
  y -= 14;
  for (const [k, v] of i.rows) {
    page.drawText(safe(k), { x: 56, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(safe(v), { x: 190, y, size: 11, font: bold, color: ink });
    y -= 22;
  }
  return doc.save();
}
