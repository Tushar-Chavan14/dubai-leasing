import { describe, expect, test } from "bun:test";
import { normalisePhone } from "../src/enquiry.ts";

describe("normalisePhone", () => {
  test.each([
    ["+971 50 123 4567", "+971501234567"],
    ["00971501234567", "+971501234567"],
    ["050 123 4567", "+971501234567"],
    ["050-123-4567", "+971501234567"],
    ["04 123 4567", "+97141234567"],
    ["+44 (20) 7946 0958", "+442079460958"],
    ["+91 98765 43210", "+919876543210"],
  ])("%s → %s", (input, out) => {
    expect(normalisePhone(input)).toBe(out);
  });

  test.each(["", "skip", "12345", "+0123456789", "+1234567890123456", "call me", "501234567", "+971 50 abc"])(
    "rejects %p",
    (input) => {
      expect(normalisePhone(input)).toBeNull();
    },
  );
});
