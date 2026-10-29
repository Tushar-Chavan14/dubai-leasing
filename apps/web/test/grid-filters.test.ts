import { describe, expect, test } from "bun:test";
import { NO_FILTERS, applyChip, toQuery } from "../lib/grid-filters";

const f = {
  ...NO_FILTERS,
  community: "Dubai Marina",
  category: "residential" as const,
  bedrooms: 1,
  maxRentFils: 9000000,
};

describe("applyChip", () => {
  test("community keeps the other filters", () => {
    expect(applyChip(f, { kind: "community", community: "JVC" })).toEqual({ ...f, community: "JVC" });
  });
  test("selected community toggles off", () => {
    expect(applyChip(f, { kind: "community", community: "Dubai Marina" })).toEqual({ ...f, community: null });
  });
  test("category keeps community and budget, drops beds for non-residential", () => {
    expect(applyChip(f, { kind: "category", category: "commercial" })).toEqual({
      ...f,
      category: "commercial",
      bedrooms: null,
    });
  });
  test("category drops size band when residential", () => {
    const c = { ...NO_FILTERS, category: "commercial" as const, sizeBand: "small" as const, community: "X" };
    expect(applyChip(c, { kind: "category", category: "residential" })).toEqual({
      ...NO_FILTERS,
      community: "X",
      category: "residential",
    });
  });
  test("selected category toggles off only that filter", () => {
    expect(applyChip(f, { kind: "category", category: "residential" })).toEqual({
      ...f,
      category: null,
      bedrooms: null,
    });
  });
  test("bedrooms and size keep community and budget", () => {
    const b = applyChip(NO_FILTERS, { kind: "community", community: "A" });
    const withBudget = { ...b, maxRentFils: 5000 };
    expect(applyChip(withBudget, { kind: "bedrooms", bedrooms: 2 })).toEqual({
      ...withBudget,
      category: "residential",
      bedrooms: 2,
    });
    expect(applyChip(withBudget, { kind: "size", size: "small" })).toEqual({
      ...withBudget,
      category: "commercial",
      sizeBand: "small",
    });
  });
  test("reset and budget-clear", () => {
    expect(applyChip(f, { kind: "reset" })).toEqual(NO_FILTERS);
    expect(applyChip(f, { kind: "budget-clear" }).maxRentFils).toBeNull();
  });
  test("combined toQuery", () => {
    expect(toQuery(f)).toBe("area=Dubai+Marina&type=residential&beds=1&budget=90000");
  });
});
