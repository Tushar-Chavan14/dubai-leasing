import { describe, expect, test } from "bun:test";
import { templateLines } from "@platform/readers/structure/mapping";
import type { TemplateBlank } from "@platform/readers/structure/schema";
import { partyBlocks, signatureRoles } from "../src/index.ts";
import { read, SAMPLES } from "./fixtures/template-samples.ts";

const fieldNear = (blanks: TemplateBlank[], near: string) =>
  blanks.find((b) => b.role === "field" && b.before.slice(-30).includes(near))?.field;

describe("spa-template reads three fictional templates", () => {
  test.each(SAMPLES.map((s) => [s.spec.id, s] as const))("%s: blanks map to SPA keys", async (_id, s) => {
    const { llm, rec } = await read(s);
    expect(rec.result.status).toBe("ok");
    const data = rec.result.data;
    if (!data) throw new Error("no data");
    const { blanks, sections } = data;
    for (const m of s.maps) expect([m.near, fieldNear(blanks, m.near)]).toEqual([m.near, m.field]);
    for (const secret of s.secrets)
      for (const call of llm.chatCalls) for (const msg of call) expect(msg.content).not.toContain(secret);
    if (s.slots) {
      const purchaser = partyBlocks(templateLines(sections)).find((p) => p.role === "purchaser");
      expect(purchaser?.slots).toEqual(s.slots);
    }
  });

  test("numbered purchaser blocks get slot keys; the seller block keeps its plain key", async () => {
    const { rec } = await read(SAMPLES[0]!);
    const names = (rec.result.data?.blanks ?? []).filter((b) => b.label === "Name").map((b) => b.field);
    expect(names).toEqual(["seller_name", "purchaser_name_1", "purchaser_name_2"]);
  });

  test("signature lines name their party", async () => {
    const { rec } = await read(SAMPLES[0]!);
    const roles = Object.values(signatureRoles(rec.result.data?.blanks ?? []));
    expect(roles).toEqual(["seller", "purchaser"]);
  });
});
