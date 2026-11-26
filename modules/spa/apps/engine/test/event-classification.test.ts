import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPLIANCE_EVENTS, eventVisibleTo, SpaRole, STAFF_EVENTS } from "@spa/core";

const SRC = join(import.meta.dir, "..", "src");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );

/** Every upper-case literal on a line that writes an event `type` (also in a ternary), and every template-literal type. */
function appendedTypes(): { literals: Map<string, string>; templates: string[] } {
  const literals = new Map<string, string>();
  const templates: string[] = [];
  for (const f of files(SRC)) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!/^\s*type:\s/.test(line)) continue;
      for (const m of line.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) literals.set(m[1]!, f);
      if (/type:\s*`/.test(line)) templates.push(line.trim());
    }
  }
  return { literals, templates };
}

describe("S57: every appended event type is classified", () => {
  test("each `type` the engine appends is in STAFF_EVENTS or COMPLIANCE_EVENTS", () => {
    const { literals } = appendedTypes();
    expect(literals.size).toBeGreaterThan(40);
    const unclassified = [...literals.keys()].filter((t) => !STAFF_EVENTS.has(t) && !COMPLIANCE_EVENTS.has(t));
    expect(unclassified).toEqual([]);
  });
  test("the one template-literal type (OFFER_<status>) has all of its values classified", () => {
    const { templates } = appendedTypes();
    expect(templates).toEqual(["type: `OFFER_${status}`,"]);
    for (const t of ["OFFER_REJECTED", "OFFER_EXPIRED", "OFFER_WITHDRAWN"]) expect(STAFF_EVENTS.has(t)).toBe(true);
  });
  test("a type nobody classified is hidden from every non-compliance role", () => {
    for (const role of SpaRole.options)
      expect(eventVisibleTo("A_BRAND_NEW_EVENT", role)).toBe(role === "compliance_officer" || role === "mlro");
  });
});
