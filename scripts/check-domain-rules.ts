/**
 * Repo-specific guard run by `bun run lint` (AGENTS.md rules 5 and 8, decisions S1 and S34):
 * - no `Date.now()` / `new Date()` (current time) in domain code — use `Clock`;
 * - no code referencing `data/uploads`;
 * - the module boundary (S34): a module imports only its own packages and `@platform/*`; platform imports no module.
 * The Clock implementations and date helpers are the allowed edges. The checks themselves are in `domain-rules.ts`.
 */
import { Glob } from "bun";
import { importProblem, importsIn, NOW, UPLOADS } from "./domain-rules.ts";

const DOMAIN = [
  "platform/kernel/src/**/*.ts",
  "modules/leasing/packages/core/src/**/*.ts",
  "modules/leasing/packages/rulebook/src/**/*.ts",
  "modules/leasing/packages/helpers/src/**/*.ts",
  // Every SPA package, as before the move (S2: SPA domain code reads time only from its Clock).
  "modules/spa/packages/*/src/**/*.ts",
  "modules/leasing/packages/copilot/**/*.ts",
  "modules/*/apps/engine/src/manager/**/*.ts",
  "modules/leasing/apps/engine/src/import/**/*.ts",
];
const TIME_EDGES = new Set(["platform/kernel/src/clock.ts", "platform/kernel/src/dates.ts"]);
const ALL_CODE = ["modules/**/*.{ts,tsx}", "platform/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"];
/** Imports are checked in tests and scripts too: a test importing across the boundary is still a dependency. */
const IMPORT_CODE = [...ALL_CODE, "scripts/**/*.ts"];

/** The rule's own tests hold forbidden imports as test data. */
const IMPORT_EXEMPT = new Set(["scripts/domain-rules.test.ts"]);

const problems: string[] = [];

async function scan(patterns: string[], test: (file: string, line: string) => string | null) {
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for await (const file of new Glob(pattern).scan({ cwd: process.cwd() })) {
      if (file.includes("node_modules") || file.includes("/.next/") || seen.has(file)) continue;
      seen.add(file);
      const lines = (await Bun.file(file).text()).split("\n");
      lines.forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        const msg = test(file, line);
        if (msg) problems.push(`${file}:${i + 1}: ${msg}`);
      });
    }
  }
}

await scan(DOMAIN, (file, line) =>
  !TIME_EDGES.has(file) && NOW.test(line) ? "current time in domain code; use Clock" : null,
);
// env.ts only names the default UPLOADS_DIR location; nothing there reads it.
await scan(ALL_CODE, (file, line) =>
  file !== "modules/leasing/packages/core/src/env.ts" && UPLOADS.test(line)
    ? "code must not reference data/uploads"
    : null,
);
await scan(IMPORT_CODE, (file, line) => {
  if (IMPORT_EXEMPT.has(file)) return null;
  for (const spec of importsIn(line)) {
    const p = importProblem(file, spec);
    if (p) return p;
  }
  return null;
});

if (problems.length) {
  console.error(`domain rules: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("domain rules: ok");
