import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface CertificateData {
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

const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

/**
 * A plain demo certificate, watermarked SIMULATED on the page. Grey type only: no DLD logo,
 * colours, layout or wording (AGENTS rule 9).
 */
export async function certificatePdf(d: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Simulated tenancy registration ${d.ejariNo}`);
  doc.setProducer("Simulated Ejari (demo)");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595.28, 841.89]);
  const ink = rgb(0.15, 0.15, 0.15);
  page.drawText("SIMULATED - NOT ISSUED BY DUBAI LAND DEPARTMENT", {
    x: 70,
    y: 250,
    size: 26,
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
  text("Tenancy registration certificate (simulated)", 18, bold);
  text("Demo service for testing. It is not connected to the Dubai Land Department.", 9);
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
