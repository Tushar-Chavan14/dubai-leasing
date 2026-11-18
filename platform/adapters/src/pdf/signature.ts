import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface SignatureRecord {
  /** Contract reference and version, e.g. "C-7KQ2M9 v1". */
  reference: string;
  /** SHA-256 of the approved PDF every signer was shown. */
  documentSha256: string;
  signers: {
    role: string;
    name: string;
    capacity?: string | null;
    typedName: string;
    signedAt: string;
    email: string | null;
  }[];
  demo: boolean;
}

const A4: [number, number] = [595.28, 841.89];
const safe = (s: string) => s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

/**
 * Appends a "Signature record" page to the approved contract PDF: who signed, the name they
 * typed, when (from the engine Clock), and the hash of the document they were shown. The pages
 * before it are copied unchanged. Electronic signature in the portal is simulated in the demo.
 */
export async function appendSignatureRecord(original: Uint8Array, r: SignatureRecord): Promise<Uint8Array> {
  const doc = await PDFDocument.load(original);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  const ink = rgb(0.1, 0.11, 0.12);
  const muted = rgb(0.41, 0.44, 0.46);
  let y = A4[1] - 56;
  const line = (text: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    const size = o.size ?? 10.5;
    page.drawText(safe(text), { x: 56, y: y - size, size, font: o.bold ? bold : font, color: o.color ?? ink });
    y -= size * 1.6;
  };
  line(r.demo ? "Signature record (simulated e-signature)" : "Signature record", { size: 18, bold: true });
  y -= 6;
  line(`Contract: ${r.reference}`);
  line("SHA-256 of the contract shown to the signers:", { color: muted });
  line(r.documentSha256, { size: 8.5 });
  y -= 10;
  for (const s of r.signers) {
    line(`${s.role === "tenant" ? "Tenant" : s.role === "landlord" ? "Landlord" : s.role}: ${s.name}`, { bold: true });
    if (s.capacity) line(s.capacity);
    line(`Typed name: ${s.typedName}`);
    line(`Signed at: ${s.signedAt} (UTC)`);
    if (s.email) line(`Signing link sent to: ${s.email}`, { color: muted });
    y -= 8;
  }
  y -= 8;
  line(
    r.demo
      ? "Demo build: each party signed through a personal portal link. This is not a qualified electronic signature."
      : "Each party signed through a personal, single-use link by typing their full name and confirming consent.",
    { size: 8.5, color: muted },
  );
  return doc.save({ useObjectStreams: false });
}
