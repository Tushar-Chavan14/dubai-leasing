import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ChatBox } from "../components/listing-chat";
import { chatError, type ChatLine, postChat, segments } from "../lib/listing-chat";

describe("segments: unverified values are marked, nothing else changes", () => {
  test("a reply with no unverified value is one plain segment", () => {
    expect(segments("It has 2 bedrooms.", [])).toEqual([{ text: "It has 2 bedrooms.", unverified: false }]);
  });
  test("each unverified value is cut out of the text in place, every time it appears", () => {
    expect(segments("Asking AED 9,999,999, so AED 9,999,999 it is.", ["AED 9,999,999"])).toEqual([
      { text: "Asking ", unverified: false },
      { text: "AED 9,999,999", unverified: true },
      { text: ", so ", unverified: false },
      { text: "AED 9,999,999", unverified: true },
      { text: " it is.", unverified: false },
    ]);
  });
  test("a value that is not in the text is ignored, and overlapping values keep the longer", () => {
    expect(segments("About 5%.", ["12%"])).toEqual([{ text: "About 5%.", unverified: false }]);
    expect(segments("AED 1,500 or 1,500", ["1,500", "AED 1,500"])).toEqual([
      { text: "AED 1,500", unverified: true },
      { text: " or ", unverified: false },
      { text: "1,500", unverified: true },
    ]);
  });
});

describe("chatError: what the visitor reads when the chat can't answer", () => {
  test("each status has its own plain words, none names the engine", () => {
    expect(chatError(429)).toContain("too many messages");
    expect(chatError(404)).toContain("no longer available");
    expect(chatError(503)).toContain("isn't available");
    expect(chatError(400)).toContain("shorter");
    expect(chatError(500)).toContain("try again");
    expect(chatError(0)).toContain("try again");
  });
});

describe("postChat", () => {
  const ok =
    (body: unknown, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), { status });
  test("posts the message, the consent and the session to the listing's own chat route", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ reply: "Hello", verified: true, unverified: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const line = await postChat("L-0007", { text: "hi", consent: true, session: "session-abcdefgh" }, f);
    expect(seen!.url).toBe("/listings/L-0007/chat");
    expect(JSON.parse(String(seen!.init.body))).toEqual({ text: "hi", consent: true, session: "session-abcdefgh" });
    expect(line).toEqual({ who: "assistant", text: "Hello", unverified: [] });
  });
  test("a refusal or a network failure becomes a line in words, not an exception", async () => {
    expect(
      (await postChat("L-1", { text: "x", consent: false, session: "s".repeat(8) }, ok({}, 429) as never)).text,
    ).toContain("too many");
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect((await postChat("L-1", { text: "x", consent: false, session: "s".repeat(8) }, down)).text).toContain(
      "try again",
    );
  });
});

describe("ChatBox", () => {
  const lines: ChatLine[] = [
    { who: "visitor", text: "What is the price?" },
    { who: "assistant", text: "The asking price is AED 9,999,999.", unverified: ["AED 9,999,999"] },
  ];
  const props = {
    lines,
    draft: "",
    consent: false,
    busy: false,
    onDraft: () => {},
    onConsent: () => {},
    onSend: () => {},
  };

  test("the transcript is a live log, each line says who wrote it, and an unverified value is marked in words", () => {
    const html = render(<ChatBox {...props} />);
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("You");
    expect(html).toContain("Assistant");
    expect(html).toContain("<mark");
    expect(html).toContain("AED 9,999,999");
    expect(html).toContain("Not confirmed");
  });
  test("it says what it can do, asks for no ID numbers and has a consent box for the enquiry", () => {
    const html = render(<ChatBox {...props} lines={[]} />);
    expect(html).toContain("Ask about this property");
    expect(html).toContain("passport or ID numbers");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("may contact me by email");
  });
  test("the message box is labelled, limited to 2,000 characters and the button names its action", () => {
    const html = render(<ChatBox {...props} lines={[]} />);
    expect(html).toContain("<label");
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain(">Send message<");
  });
  test("while waiting the button is disabled and says so", () => {
    const html = render(<ChatBox {...props} busy draft="hi" />);
    expect(html).toContain("disabled");
    expect(html).toContain("Sending");
  });
  test("an empty draft cannot be sent", () => {
    expect(render(<ChatBox {...props} lines={[]} />)).toContain("disabled");
  });
  test("it names no owner, price floor or other module", () => {
    const html = render(<ChatBox {...props} />).toLowerCase();
    for (const w of ["owner", "seller", "lowest", "aml", "screening"]) expect(html).not.toContain(w);
  });
});
