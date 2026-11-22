import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { extractPdf } from "../../readers/src/pdf/extract.ts";
import { appendSignatureRecord, mailEvidence, stampSignatures } from "../src/index.ts";

const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");
const blank = async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return d.save({ useObjectStreams: false });
};
const textOf = async (b: Uint8Array) => {
  const r = await extractPdf(b);
  if (!r.ok) throw new Error(r.message);
  return r.text;
};
const rec = (role: string) => ({
  reference: "R v1",
  documentSha256: "b".repeat(64),
  signers: [{ role, name: "N", typedName: "N", signedAt: "2026-01-01T00:00:00.000Z", email: null }],
  demo: false,
});

describe("appendSignatureRecord roleLabels profile", () => {
  test("a profile labels roles; unknown roles print as they are", async () => {
    const out = await appendSignatureRecord(await blank(), rec("purchaser"), {
      roleLabels: { purchaser: "Purchaser" },
    });
    expect(await textOf(out)).toContain("Purchaser: N");
    const raw = await appendSignatureRecord(await blank(), rec("broker"), { roleLabels: { purchaser: "Purchaser" } });
    expect(await textOf(raw)).toContain("broker: N");
  });
  test("without a profile the leasing words stay", async () => {
    const out = await appendSignatureRecord(await blank(), rec("tenant"));
    expect(await textOf(out)).toContain("Tenant: N");
  });
});

describe("stampSignatures", () => {
  test("writes each typed name at its anchor, matched by role and slot", async () => {
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    d.addPage([595, 842]);
    const pdf = await d.save({ useObjectStreams: false });
    const r = await stampSignatures(
      pdf,
      [
        { role: "purchaser", slot: 1, page: 1, xPt: 60, yPt: 200, widthPt: 200 },
        { role: "purchaser", slot: 2, page: 2, xPt: 60, yPt: 200, widthPt: 200 },
        { role: "seller", slot: null, page: 2, xPt: 60, yPt: 400, widthPt: 200 },
      ],
      [
        { role: "purchaser", slot: 2, text: "Beta Buyer" },
        { role: "purchaser", slot: 1, text: "Alpha Buyer" },
        { role: "seller", slot: 1, text: "Sam Seller" },
      ],
    );
    expect(r.stamped).toBe(3);
    const t = await textOf(r.bytes);
    for (const n of ["Alpha Buyer", "Beta Buyer", "Sam Seller"]) expect(t).toContain(n);
  });
  test("an unmatched signer is not stamped", async () => {
    const r = await stampSignatures(
      await blank(),
      [{ role: "seller", slot: null, page: 1, xPt: 1, yPt: 1, widthPt: 9 }],
      [{ role: "broker", slot: null, text: "Bo" }],
    );
    expect(r.stamped).toBe(0);
  });
});

describe("mailEvidence", () => {
  test("hashes body like leasing and each attachment, with the SMTP answer", () => {
    const mail = {
      to: "a@example.test",
      subject: "s",
      text: "hello text",
      html: "<p>hello</p>",
      attachments: [{ filename: "a.pdf", content: new Uint8Array([1, 2, 3]), contentType: "application/pdf" }],
    };
    const e = mailEvidence(mail, {
      messageId: "<m@x>",
      accepted: ["a@example.test"],
      rejected: [],
      response: "250 OK",
      deliveredTo: "a@example.test",
    });
    expect(e).toEqual({
      bodySha256: "2ca52db6649ec9eb1bd28aa251cc8fa15ab00eee91b05025d9c9b6ed420ad4f2",
      attachmentSha256s: [sha(new Uint8Array([1, 2, 3]))],
      messageId: "<m@x>",
      smtpResponse: "250 OK",
      previewUrl: null,
    });
  });
});
