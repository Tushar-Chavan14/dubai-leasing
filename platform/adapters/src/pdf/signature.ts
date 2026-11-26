import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { SignatureAnchor } from "./styled.ts";

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

/** Role words for the record page. Leasing's are the default; a module passes its own (S54). */
export interface SignatureRecordProfile {
  roleLabels?: Readonly<Record<string, string>>;
}
const LEASING_ROLE_LABELS: Readonly<Record<string, string>> = { tenant: "Tenant", landlord: "Landlord" };

/**
 * Appends a "Signature record" page to the approved contract PDF: who signed, the name they
 * typed, when (from the engine Clock), and the hash of the document they were shown. The pages
 * before it are copied unchanged. Electronic signature in the portal is simulated in the demo.
 */
export async function appendSignatureRecord(
  original: Uint8Array,
  r: SignatureRecord,
  profile: SignatureRecordProfile = {},
): Promise<Uint8Array> {
  const labels = profile.roleLabels ?? LEASING_ROLE_LABELS;
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
    line(`${Object.hasOwn(labels, s.role) ? labels[s.role] : s.role}: ${s.name}`, { bold: true });
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

export interface StampSigner {
  /** The template role of the signature line (`purchaser`, `seller`, `broker`). */
  role: string;
  /** The numbered slot of the line ("Purchaser 2"); a line with no slot takes the first signer of its role. */
  slot: number | null;
  text: string;
}

/**
 * Writes each signer's typed name on its signature line, at the anchor the render recorded (C14). A line matches a
 * signer by role and slot (an unnumbered line matches the first signer of its role that is still unplaced). Pure:
 * every other byte of the pages is the original's.
 */
export async function stampSignatures(
  original: Uint8Array,
  anchors: readonly SignatureAnchor[],
  signers: readonly StampSigner[],
): Promise<{ bytes: Uint8Array; stamped: number }> {
  const doc = await PDFDocument.load(original);
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);
  const pages = doc.getPages();
  const used = new Set<number>();
  let stamped = 0;
  for (const a of anchors) {
    const i = signers.findIndex(
      (s, n) => !used.has(n) && s.role === a.role && (a.slot === null || s.slot === null || s.slot === a.slot),
    );
    const page = pages[a.page - 1];
    if (i < 0 || !page) continue;
    used.add(i);
    const size = 11;
    const text = safe(signers[i]!.text);
    const fit = Math.min(size, (a.widthPt / Math.max(1, font.widthOfTextAtSize(text, size))) * size);
    page.drawText(text, { x: a.xPt + 2, y: a.yPt + 3, size: fit, font, color: rgb(0.05, 0.1, 0.45) });
    stamped++;
  }
  return { bytes: await doc.save({ useObjectStreams: false }), stamped };
}
