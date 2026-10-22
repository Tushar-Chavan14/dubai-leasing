/**
 * Repo-specific guard run by `bun run lint` (AGENTS.md rules 5 and 8):
 * - no `Date.now()` / `new Date()` (current time) in domain code — use `Clock`;
 * - no code referencing `data/uploads`.
 * The Clock implementations and date helpers are the allowed edges.
 */
import { Glob } from "bun";

const DOMAIN = [
  "packages/core/src/**/*.ts",
  "packages/rulebook/src/**/*.ts",
  "packages/helpers/src/**/*.ts",
  "packages/copilot/**/*.ts",
  "apps/engine/src/manager/**/*.ts",
  "apps/engine/src/import/**/*.ts",
];
const TIME_EDGES = new Set(["packages/core/src/clock.ts", "packages/core/src/dates.ts"]);
const ALL_CODE = ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts", "apps/web/app/**/*.{ts,tsx}", "apps/web/lib/**/*.ts"];

const NOW = /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/;
const UPLOADS = /data\/uploads/;
const problems: string[] = [];

async function scan(patterns: string[], test: (file: string, line: string) => string | null) {
  for (const pattern of patterns) {
    for await (const file of new Glob(pattern).scan({ cwd: process.cwd() })) {
      if (file.includes("node_modules")) continue;
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

if (problems.length) {
  console.error(`domain rules: ${problems.length} problem(s)\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("domain rules: ok");
