import { describe, expect, test } from "bun:test";
import config from "../next.config.ts";

const EXPECTED = [
  ["/inbox", "/work?view=waiting"],
  ["/inbox/:id", "/work?approval=:id"],
  ["/applications/:id((?!new$)[^/]+)", "/work?kind=application&id=:id"],
  ["/leases/:id", "/work?kind=lease&id=:id"],
  ["/conversations", "/work?stage=Enquiry"],
  ["/copilot", "/"],
  ["/rules", "/settings/rulebook"],
  ["/rules/:version", "/settings/rulebook/:version"],
  ["/sri", "/settings/rent-index"],
  ["/import", "/settings/import"],
  ["/demo", "/settings/demo"],
  ["/properties", "/customer/properties"],
  ["/properties/:id", "/customer/properties/:id"],
  ["/chat", "/customer/chat"],
] as const;

describe("staff route redirects (slice 2)", () => {
  test("the table is exactly the old routes to the new shell and the customer section, all temporary", async () => {
    const table = await config.redirects!();
    expect(table).toEqual(EXPECTED.map(([source, destination]) => ({ source, destination, permanent: false })));
  });

  test("/applications/new is not caught by the applications redirect; an id is", async () => {
    const table = await config.redirects!();
    const rule = table.find((r) => r.source.startsWith("/applications/"))!;
    const group = /:id\((.+)\)$/.exec(rule.source)![1]!;
    const pattern = new RegExp(`^/applications/(${group.slice(0)})$`);
    expect(pattern.test("/applications/new")).toBe(false);
    expect(pattern.test("/applications/0198a1b2-c3d4")).toBe(true);
    expect(pattern.test("/applications/newer")).toBe(true);
  });
});
