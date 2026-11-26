import { expect, test } from "bun:test";
import { needsLegalCheck } from "../lib/clause-legal";

test("termination, payment and subletting clauses are flagged for legal", () => {
  for (const c of ["termination", "payment", "subletting"]) expect(needsLegalCheck(c)).toBe(true);
  for (const c of ["pets", "parking", "maintenance", undefined, null]) expect(needsLegalCheck(c)).toBe(false);
});
