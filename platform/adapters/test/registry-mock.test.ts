import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  esc,
  maybeUnavailable,
  type RegistryMockProfile,
  replayByRequestId,
  replyWithAnswer,
  simulatedCertificate,
  simulatedPage,
  UNAVAILABLE_MESSAGE,
} from "../src/index.ts";

const profile: RegistryMockProfile = {
  systemLabel: "Test registry (simulated)",
  wording: {
    title: "Test certificate (simulated)",
    subline: "Demo service for testing. It is not connected to any government system.",
    watermark: "SIMULATED - NOT A REAL REGISTRY",
    producer: "Simulated test registry (demo)",
  },
};
const c = { json: (b: unknown, s: 201 | 400 | 422 | 503) => Response.json(b, { status: s }) };

describe("registry-mock shell", () => {
  test("the page escapes what callers typed and carries the module's own wording", () => {
    const html = simulatedPage({
      title: "Simulated <x>",
      heading: "Simulated registry (demo)",
      notices: ["Not connected to anything."],
      main: `<p>${esc('<script>alert("x")</script>')}</p>`,
    });
    expect(html).toContain("<title>Simulated &lt;x&gt;</title>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<p class="warn">Not connected to anything.</p>');
    expect(html).not.toMatch(/<img|<svg|logo/i);
  });

  test("the certificate is a PDF with the profile's producer, title and no images", async () => {
    const bytes = await simulatedCertificate({
      profile,
      documentTitle: "Simulated test no. 1",
      rows: [["No.", "SIM-1"]],
    });
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getProducer()).toBe(profile.wording.producer);
    expect(doc.getTitle()).toBe("Simulated test no. 1");
    expect(doc.getPageCount()).toBe(1);
    expect(new TextDecoder("latin1").decode(bytes)).not.toContain("/Subtype /Image");
  });

  test("maybeUnavailable follows the injected random and the rate", () => {
    expect(maybeUnavailable({ failureRate: 0, random: () => 0 })).toBe(false);
    expect(maybeUnavailable({ failureRate: 1, random: () => 0.99 })).toBe(true);
    expect(maybeUnavailable({ failureRate: 0.3, random: () => 0.29 })).toBe(true);
    expect(maybeUnavailable({ failureRate: 0.3, random: () => 0.3 })).toBe(false);
    expect(maybeUnavailable({})).toBe(false);
  });

  test("replayByRequestId turns a stored row into its first answer; none is a new request", async () => {
    expect(
      await replayByRequestId(
        async () => undefined,
        () => ({ http: 201, body: 1 }),
      ),
    ).toBeNull();
    expect(
      await replayByRequestId(
        async () => ({ n: 7 }),
        (r) => ({ http: 422, body: r }),
      ),
    ).toEqual({
      http: 422,
      body: { n: 7 },
    });
  });

  test("replyWithAnswer: 201, 422, 503 for no answer, 400 for a schema error, anything else is rethrown", async () => {
    const r201 = await replyWithAnswer(c, async () => ({ http: 201, body: { ok: 1 } }));
    expect([r201.status, await r201.json()]).toEqual([201, { ok: 1 }]);
    expect((await replyWithAnswer(c, async () => ({ http: 422, body: {} }))).status).toBe(422);
    const r503 = await replyWithAnswer(c, async () => null);
    expect([r503.status, await r503.json()]).toEqual([503, { error: UNAVAILABLE_MESSAGE }]);
    const r400 = await replyWithAnswer(c, async () => {
      throw Object.assign(new Error("bad"), { issues: [{ message: "too short" }] });
    });
    expect([r400.status, await r400.json()]).toEqual([400, { error: "invalid request", issues: ["too short"] }]);
    await expect(
      replyWithAnswer(c, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
