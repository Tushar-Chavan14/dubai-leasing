import { expect, test } from "bun:test";
import { clientBucket } from "../lib/client-address";

const h = (xff?: string) => new Headers(xff ? { "x-forwarded-for": xff } : {});

test("without a trusted proxy the header is visitor-supplied and ignored: one fixed bucket", () => {
  expect(clientBucket(h("1.2.3.4"), false)).toBe("direct");
  expect(clientBucket(h("1.2.3.4, 5.6.7.8"), false)).toBe("direct");
  expect(clientBucket(h(), false)).toBe("direct");
});

test("behind a trusted proxy the last hop is used, never a first entry the visitor wrote", () => {
  expect(clientBucket(h("6.6.6.6, 203.0.113.9"), true)).toBe("203.0.113.9");
  expect(clientBucket(h("203.0.113.9"), true)).toBe("203.0.113.9");
  expect(clientBucket(h("9.9.9.9, 203.0.113.9 "), true)).toBe("203.0.113.9");
});

test("behind a proxy with no usable header, or junk in the last hop, falls back to the fixed bucket", () => {
  expect(clientBucket(h(), true)).toBe("direct");
  expect(clientBucket(h("1.2.3.4, not an address!!"), true)).toBe("direct");
  expect(clientBucket(h("x".repeat(200)), true)).toBe("direct");
});
