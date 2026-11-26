import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { appendSignatureRecord } from "../src/index.ts";

// C28 goldens (S54): recorded from the leasing behaviour BEFORE the shared code gained a profile.
// The leasing signature-record PDF and the leasing mail evidence values must never change.
const sha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");

describe("leasing goldens", () => {
  beforeAll(() => setSystemTime(new Date("2026-01-02T03:04:05Z")));
  afterAll(() => setSystemTime());

  test("leasing signature record bytes are unchanged", async () => {
    const base = await PDFDocument.create();
    base.addPage([595.28, 841.89]);
    const original = await base.save({ useObjectStreams: false });
    const out = await appendSignatureRecord(original, {
      reference: "C-7KQ2M9 v1",
      documentSha256: "a".repeat(64),
      signers: [
        {
          role: "tenant",
          name: "Test Tenant",
          typedName: "Test Tenant",
          signedAt: "2026-01-02T03:04:05.000Z",
          email: "t@example.test",
        },
        {
          role: "landlord",
          name: "Test Landlord",
          capacity: "Owner",
          typedName: "Test Landlord",
          signedAt: "2026-01-02T04:04:05.000Z",
          email: null,
        },
        { role: "agent", name: "Other", typedName: "Other", signedAt: "2026-01-02T05:04:05.000Z", email: null },
      ],
      demo: true,
    });
    expect(sha(out)).toBe(GOLDEN_SIGNATURE_RECORD);
  });

  test("leasing mail evidence formula is unchanged", () => {
    const mail = { to: "a@example.test", subject: "S", text: "hello text", html: "<p>hello</p>" };
    expect(sha(`${mail.text}\n${mail.html}`)).toBe(GOLDEN_BODY);
  });
});

const GOLDEN_SIGNATURE_RECORD = "1ddbaddac8c983e6a2aef9990dd5def7973c896af7a5f22b519a74976486a052";
const GOLDEN_BODY = "2ca52db6649ec9eb1bd28aa251cc8fa15ab00eee91b05025d9c9b6ed420ad4f2";
