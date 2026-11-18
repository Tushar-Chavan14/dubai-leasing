/**
 * Repo-specific guard run by `bun run lint` (AGENTS.md rules 5 and 8, SPA decision S1):
 * - no `Date.now()` / `new Date()` (current time) in domain code — use `Clock`;
 * - no code referencing `data/uploads`;
 * - the module boundary: leasing never imports `@spa/*`; `spa/` imports only the shared packages.
 * The Clock implementations and date helpers are the allowed edges. The checks themselves are in `domain-rules.ts`.
 */
import { Glob } from "bun";
import { importProblem, importsIn, NOW, UPLOADS } from "./domain-rules.ts";

const DOMAIN = [
  "platform/kernel/src/**/*.ts",
  "packages/core/src/**/*.ts",
  "packages/rulebook/src/**/*.ts",
  "packages/helpers/src/**/*.ts",
  "packages/copilot/**/*.ts",
  "apps/engine/src/manager/**/*.ts",
  "apps/engine/src/import/**/*.ts",
  "spa/packages/*/src/**/*.ts",
  "spa/apps/engine/src/manager/**/*.ts",
];
const TIME_EDGES = new Set(["platform/kernel/src/clock.ts", "platform/kernel/src/dates.ts"]);
const ALL_CODE = [
  "packages/*/src/**/*.{ts,tsx}",
  "apps/*/src/**/*.{ts,tsx}",
  "apps/web/app/**/*.{ts,tsx}",
  "apps/web/lib/**/*.{ts,tsx}",
  "spa/**/*.{ts,tsx}",
];
/** Imports are checked in tests and scripts too: a test importing across the boundary is still a dependency. */
const IMPORT_CODE = [
  ...ALL_CODE,
  "packages/*/test/**/*.{ts,tsx}",
  "packages/*/*.ts",
  "apps/*/test/**/*.{ts,tsx}",
  "scripts/**/*.ts",
];

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
  file !== "packages/core/src/env.ts" && UPLOADS.test(line) ? "code must not reference data/uploads" : null,
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
