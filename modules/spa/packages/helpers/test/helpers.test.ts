import { expect, test } from "bun:test";
import { SPA_HELPERS_PACKAGE } from "../src/index.ts";

test("placeholder until P5/P6", () => {
  expect(SPA_HELPERS_PACKAGE).toBe("@spa/helpers");
});
