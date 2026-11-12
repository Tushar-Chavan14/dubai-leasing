import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface CertificateData {
  system?: "ejari" | "tawtheeq";
  ejariNo: string;
  issuedOn: string;
  dldPropertyNo: string;
  unitNo: string;
  makaniNo: string;
  tenantName: string;
  landlordName: string;
  startOn: string;
  endOn: string;
  annualRent: string;
}

/** The visible wording per system, kept in one place so tests can check it (PDF streams are compressed). */
export const CERTIFICATE_WORDING = {
  ejari: {
    title: "Tenancy registration certificate (simulated)",
    subline: "Demo service for testing. It is not connected to the Dubai Land Department.",
    watermark: "SIMULATED - NOT ISSUED BY DUBAI LAND DEPARTMENT",
    producer: "Simulated Ejari (demo)",
  },
  tawtheeq: {
    title: "Tenancy contract registration (simulated Tawtheeq)",
    subline: "Demo service for testing. It is not connected to any Abu Dhabi government system.",
    watermark: "SIMULATED - NOT ISSUED BY ANY ABU DHABI AUTHORITY",
    producer: "Simulated Tawtheeq (demo)",
  },
} as const;

const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

/**
 * A plain demo certificate, watermarked SIMULATED on the page. Grey type only: no DLD logo,
 * colours, layout or wording (AGENTS rule 9).
 */
export async function certificatePdf(d: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const twq = d.system === "tawtheeq";
  const w = CERTIFICATE_WORDING[twq ? "tawtheeq" : "ejari"];
  doc.setTitle(`Simulated tenancy registration ${d.ejariNo}`);
  doc.setProducer(w.producer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const ink = rgb(0.15, 0.15, 0.15);
  page.drawText(w.watermark, {
    x: 70,
    y: 250,
    size: twq ? 22 : 26,
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
  for (const [k, v] of [
    ["Registration no.", d.ejariNo],
    ["Issued on", d.issuedOn],
    ["Property no.", d.dldPropertyNo],
    ["Unit no.", d.unitNo],
    ["Makani no.", d.makaniNo],
    ["Tenant", d.tenantName],
    ["Landlord", d.landlordName],
    ["Period", `${d.startOn} to ${d.endOn}`],
    ["Annual rent", d.annualRent],
  ] as const) {
    page.drawText(safe(k), { x: 56, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(safe(v), { x: 190, y, size: 11, font: bold, color: ink });
    y -= 22;
  }
  return doc.save();
}
