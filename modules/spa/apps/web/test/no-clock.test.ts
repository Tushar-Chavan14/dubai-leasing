import { expect, test } from "bun:test";
import { Glob } from "bun";

/** The clock is the engine's (rule 5): ages and legal dates arrive from it; the web only formats what it is given. */
test("no web source reads the system clock", async () => {
  const hits: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for await (const f of new Glob(`${dir}/**/*.{ts,tsx}`).scan({ cwd: `${import.meta.dir}/..` })) {
      const text = await Bun.file(`${import.meta.dir}/../${f}`).text();
      text.split("\n").forEach((line, i) => {
        if (/Date\.now\s*\(|new Date\s*\(\s*\)/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  expect(hits).toEqual([]);
});

test("the Work and record pages call only read routes and the task-done route (the inbox decision goes through its one action, C31)", async () => {
  const files = [
    "lib/loaders.ts",
    "app/(staff)/work/actions.ts",
    "app/(staff)/work/page.tsx",
    "app/(staff)/work/deals/[id]/page.tsx",
  ];
  const text = (await Promise.all(files.map((f) => Bun.file(`${import.meta.dir}/../${f}`).text())))
    .join("\n")
    // the one write the inbox makes is the decide action's, imported by the page; nothing here posts it directly
    .replace('import { decideApproval } from "../decide";', "");
  expect(text).not.toMatch(/\.\$(put|patch|delete)\b|\/decide|method:\s*["']POST/i);
  expect([...text.matchAll(/\.\$post\b/g)]).toHaveLength(1);
  expect(text).toContain('tasks[":id"].done');
});

test("the decision is posted only by lib/inbox.ts, through the one server action, and carries no role", async () => {
  const lib = await Bun.file(`${import.meta.dir}/../lib/inbox.ts`).text();
  const action = await Bun.file(`${import.meta.dir}/../app/(staff)/decide.ts`).text();
  expect(lib).toContain("/decide`");
  expect(action).toContain("submitDecision(enginePost");
  for (const t of [lib, action]) expect(t).not.toMatch(/\b(role|actor|decidedBy)\s*:/);
});
