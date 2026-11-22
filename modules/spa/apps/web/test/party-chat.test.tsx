import { expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { PartyChat } from "../components/party-chat";

test("the portal chat renders a labelled question box, a send button and the no-ID-numbers note (C35, S67)", () => {
  const html = render(<PartyChat token="t" />);
  expect(html).toContain("Ask a question");
  expect(html).toContain('for="party-chat-text"');
  expect(html).toContain("Send");
  expect(html).toContain("passport or ID numbers");
  expect(html).not.toMatch(/\baml\b|screening|sanction|\brisk\b|flag/i);
});
