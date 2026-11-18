import { describe, expect, test } from "bun:test";
import { parseQuery, workHref } from "../app/(staff)/work/url";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("Workspace url state", () => {
  test("new=1 opens the New application sheet; anything else is ignored", () => {
    expect(parseQuery({ new: "1" }).new).toBe(true);
    expect(parseQuery({ new: "yes" }).new).toBeUndefined();
    expect(parseQuery({}).new).toBeUndefined();
  });

  test("workHref writes new=1 and clears it", () => {
    expect(workHref({}, { new: true })).toContain("new=1");
    expect(workHref({ new: true }, { new: undefined })).toBe("/work");
  });

  test("existing keys round-trip", () => {
    const q = parseQuery({
      view: "waiting",
      q: "dana",
      stage: "Offer",
      kind: "lease",
      id: ID,
      entry: "e1",
      pane: "open",
      wide: "1",
      draft: "d1",
    });
    const parsed = parseQuery(Object.fromEntries(new URL(workHref(q), "http://x").searchParams));
    expect(parsed).toEqual(q);
  });
});
