import { describe, expect, test } from "bun:test";
import { filterHub, HUB } from "../lib/settings/hub";

const all = (demo: boolean) => filterHub("", { demo }).flatMap((g) => g.items);

describe("HUB", () => {
  test("hrefs equal the old tab bar's", () => {
    const expected = [
      "/settings/companies",
      "/settings/rent-rules",
      "/settings/contracts",
      "/settings/rent-index",
      "/settings/kyc",
      "/settings/rulebook",
      "/settings/agent",
      "/settings/import",
      "/settings/demo",
    ];
    expect(HUB.flatMap((g) => g.items.map((i) => i.href)).toSorted()).toEqual([...expected].toSorted());
  });
  test("groups follow the spec", () => {
    expect(HUB.map((g) => g.group)).toEqual(["Your company", "Money and rules", "Contracts", "Agent", "Data"]);
  });
  test("every item has a who and a blurb without dashes", () => {
    for (const i of all(true)) {
      expect(i.who.length).toBeGreaterThan(5);
      expect(`${i.title}${i.blurb}${i.who}`).not.toMatch(/[–—]/);
    }
  });
});

describe("filterHub", () => {
  test("trims and ignores case", () => {
    const r = filterHub("  SRI ", { demo: false });
    expect(r.flatMap((g) => g.items.map((i) => i.title))).toEqual(["Smart Rental Index"]);
  });
  test("ejari matches an item by keyword", () => {
    const titles = filterHub("ejari", { demo: false }).flatMap((g) => g.items.map((i) => i.title));
    expect(titles.length).toBeGreaterThan(0);
  });
  test("no match is empty", () => {
    expect(filterHub("zzz", { demo: true })).toEqual([]);
  });
  test("empty query keeps everything but hides Demo without demo mode", () => {
    expect(all(false).some((i) => i.href === "/settings/demo")).toBe(false);
    expect(all(true).some((i) => i.href === "/settings/demo")).toBe(true);
  });
  test("drops groups that end up empty", () => {
    expect(filterHub("clock", { demo: false })).toEqual([]);
    expect(filterHub("clock", { demo: true }).map((g) => g.group)).toEqual(["Data"]);
  });
});
