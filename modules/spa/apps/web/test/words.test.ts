import { describe, expect, test } from "bun:test";
import { FURNISHED, UNIT_TYPES } from "@spa/core";
import {
  bedsLabel,
  bedsShort,
  FIELD_LABEL,
  floorLabel,
  FURNISHED_LABEL,
  UNIT_STATE_LABEL,
  UNIT_TYPE_LABEL,
} from "../lib/words";

describe("S75: the words the inventory screens print", () => {
  test("every unit type, furnishing and unit state has a label that is not its code", () => {
    for (const t of UNIT_TYPES) {
      expect(UNIT_TYPE_LABEL[t], t).toBeTruthy();
      expect(UNIT_TYPE_LABEL[t]).not.toBe(t);
    }
    for (const f of FURNISHED) expect(FURNISHED_LABEL[f], f).toBeTruthy();
    expect(Object.keys(UNIT_STATE_LABEL).sort()).toEqual(["AVAILABLE", "HANDED_OVER", "HELD", "REGISTERED", "SOLD"]);
    for (const [k, v] of Object.entries(UNIT_STATE_LABEL)) expect(v).not.toBe(k);
  });

  test("0 bedrooms is a studio; floors have words", () => {
    expect(bedsLabel(0)).toBe("Studio");
    expect(bedsLabel(1)).toBe("1 bedroom");
    expect(bedsLabel(3)).toBe("3 bedrooms");
    expect(bedsLabel(null)).toBe("");
    expect(bedsShort(0)).toBe("Studio");
    expect(bedsShort(2)).toBe("2 bed");
    expect(floorLabel(0)).toBe("Ground floor");
    expect(floorLabel(-1)).toBe("Basement 1");
    expect(floorLabel(12)).toBe("Floor 12");
  });

  test("every field an update event can name has words", () => {
    for (const f of ["bedrooms", "view", "description", "community", "anticipatedCompletionOn", "internalSqft"])
      expect(FIELD_LABEL[f], f).toBeTruthy();
  });
});
