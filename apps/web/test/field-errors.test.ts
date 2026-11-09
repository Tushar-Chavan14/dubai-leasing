import { describe, expect, test } from "bun:test";
import { splitReasons } from "../lib/field-errors";
import { ruleError } from "../lib/portfolio";

describe("engine reasons → field errors", () => {
  test("a nested Zod path names the input by its last segment", () => {
    const r = splitReasons(["legal.email: invalid email", "name: required"]);
    expect(r.fieldErrors).toEqual({ email: "Invalid email", name: "Required" });
    expect(r.reasons).toEqual([]);
  });
  test("a path through a list, or no path at all, stays a general reason", () => {
    const r = splitReasons(["fields.3.label: required", "the rule overlaps another rule"]);
    expect(r.fieldErrors).toEqual({});
    expect(r.reasons).toEqual(["Fields.3.label: required", "The rule overlaps another rule"]);
  });
  test("the first message per field wins", () => {
    expect(splitReasons(["email: too long", "email: invalid"]).fieldErrors).toEqual({ email: "Too long" });
  });
  test("ruleError marks the fields of a 400 and of a 422 with field reasons", () => {
    const bad = ruleError({
      ok: false,
      status: 400,
      data: null,
      error: { error: "invalid request", code: "invalid_request", reasons: ["legal.phone: too long"] },
    });
    expect(bad.fieldErrors).toEqual({ phone: "Too long" });
    const cross = ruleError({
      ok: false,
      status: 422,
      data: null,
      error: {
        error: "company legal details can't be saved this way",
        code: "invalid_legal",
        reasons: ["tradeLicenceExpiresOn: must expire in the future"],
      },
    });
    expect(cross.fieldErrors).toEqual({ tradeLicenceExpiresOn: "Must expire in the future" });
    expect(cross.error).toBe("Some fields need attention.");
  });
});
