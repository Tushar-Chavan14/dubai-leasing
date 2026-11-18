import { expect, test } from "bun:test";
import { SPA_RULEBOOK_PACKAGE } from "../src/index.ts";

test("placeholder until P4", () => {
  expect(SPA_RULEBOOK_PACKAGE).toBe("@spa/rulebook");
});
