import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { repoRoot } from "../src/repo-root.ts";

// P2b: leasing moved under modules/leasing; every path that reaches the repo root must still land on it.
describe("paths to the repo root", () => {
  test("the engine's repo root is the workspace root", () => {
    expect(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).name).toBe("leasing-agents");
  });

  test("every --env-file in a leasing package.json points at the repo .env", () => {
    const found: string[] = [];
    for (const group of ["apps", "packages"]) {
      const base = join(repoRoot, "modules", "leasing", group);
      for (const name of readdirSync(base)) {
        const pkgPath = join(base, name, "package.json");
        let scripts: Record<string, string> = {};
        try {
          scripts = JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {};
        } catch {
          continue;
        }
        for (const cmd of Object.values(scripts))
          for (const m of cmd.matchAll(/--env-file=(\S+)/g)) {
            found.push(`${name}: ${m[1]}`);
            expect(resolve(dirname(pkgPath), m[1]!)).toBe(join(repoRoot, ".env"));
          }
      }
    }
    expect(found.length).toBeGreaterThanOrEqual(11);
  });
});
