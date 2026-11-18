import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { importProblem, importsIn, NOW } from "./domain-rules.ts";

describe("import boundary (S1)", () => {
  test("leasing code never imports @spa/* or a file under spa/", () => {
    expect(importProblem("apps/engine/src/index.ts", "@spa/core")).toContain("must not import @spa/core");
    expect(importProblem("packages/core/src/x.ts", "@spa/rulebook/src/fees")).not.toBeNull();
    expect(importProblem("apps/engine/test/a.test.ts", "@spa")).not.toBeNull();
    expect(importProblem("packages/core/src/x.ts", "../../../spa/packages/core/src/index.ts")).toContain(
      "must not import SPA code",
    );
  });
  test("leasing code may import anything else", () => {
    expect(importProblem("apps/engine/src/index.ts", "@leasing/core")).toBeNull();
    expect(importProblem("apps/engine/src/index.ts", "@spatial/thing")).toBeNull();
    expect(importProblem("packages/helpers/src/kyc/index.ts", "./rules.ts")).toBeNull();
  });
  test("SPA code may import the shared packages, with subpaths", () => {
    for (const spec of [
      "@platform/kernel",
      "@platform/kernel/clock",
      "@platform/llm",
      "@leasing/adapters",
      "@leasing/adapters/mail",
      "@platform/ui",
      "@leasing/helpers/runner",
      "@leasing/helpers/kyc",
      "@leasing/helpers/contract-structure",
    ])
      expect(importProblem("spa/apps/engine/src/index.ts", spec)).toBeNull();
  });
  test("SPA code may import its own packages, npm packages and files inside spa/", () => {
    expect(importProblem("spa/apps/engine/src/index.ts", "@spa/core")).toBeNull();
    expect(importProblem("spa/apps/engine/src/index.ts", "zod")).toBeNull();
    expect(importProblem("spa/apps/engine/src/index.ts", "../../../packages/core/src/index.ts")).toBeNull();
    expect(importProblem("spa/packages/core/src/a.ts", "./b.ts")).toBeNull();
  });
  test("SPA code never imports leasing domain packages or the helpers root", () => {
    for (const spec of [
      "@leasing/core",
      "@leasing/core/tokens",
      "@leasing/rulebook",
      "@leasing/db",
      "@leasing/copilot",
      "@leasing/helpers",
      "@leasing/helpers/offer",
      "@leasing/helpers/kyc/checks",
      "@leasing/kernelx",
    ])
      expect(importProblem("spa/apps/web/app/page.tsx", spec)).toContain("may import only shared packages");
  });
  test("SPA code never reaches out of spa/ by a relative path", () => {
    expect(importProblem("spa/apps/engine/src/index.ts", "../../../../packages/core/src/index.ts")).toContain(
      "must not import outside spa/",
    );
    expect(importProblem("spa/x.ts", "../platform/kernel/src/index.ts")).not.toBeNull();
  });
});

describe("kernel boundary (S4)", () => {
  test("the kernel imports only itself, its own files and npm packages", () => {
    expect(importProblem("platform/kernel/src/clock.ts", "./dates.ts")).toBeNull();
    expect(importProblem("platform/kernel/src/clock.ts", "zod")).toBeNull();
    expect(importProblem("platform/kernel/test/kernel.test.ts", "../src/index.ts")).toBeNull();
    expect(importProblem("platform/kernel/src/x.ts", "@platform/kernel/dates")).toBeNull();
  });
  test("the kernel never imports a domain package or leaves platform/kernel/", () => {
    for (const spec of ["@leasing/core", "@leasing/rulebook", "@platform/llm", "@leasing/helpers", "@spa/core"])
      expect(importProblem("platform/kernel/src/x.ts", spec)).toContain("must not import a domain package");
    expect(importProblem("platform/kernel/src/x.ts", "../../core/src/gates.ts")).toContain("outside platform/kernel/");
  });
});

describe("importsIn", () => {
  test("finds import, export-from, side-effect, dynamic and require specifiers", () => {
    expect(importsIn('import { a } from "@leasing/core";')).toEqual(["@leasing/core"]);
    expect(importsIn("export * from '@spa/core';")).toEqual(["@spa/core"]);
    expect(importsIn('import "./polyfill.ts";')).toEqual(["./polyfill.ts"]);
    expect(importsIn('const m = await import("@leasing/db");')).toEqual(["@leasing/db"]);
    expect(importsIn('const x = require("@leasing/rulebook");')).toEqual(["@leasing/rulebook"]);
    expect(importsIn('} from "@platform/llm";')).toEqual(["@platform/llm"]);
    expect(importsIn("const s = 'from nowhere';")).toEqual([]);
  });
});

describe("current time", () => {
  test("Date.now() and new Date() are found; new Date(x) is not", () => {
    expect(NOW.test("const t = Date.now();")).toBe(true);
    expect(NOW.test("const t = new Date();")).toBe(true);
    expect(NOW.test("const t = new Date(ms);")).toBe(false);
  });
});

describe("the real spa/ tree (P2)", () => {
  test("every import under spa/ passes the boundary rule", async () => {
    const problems: string[] = [];
    let files = 0;
    for await (const file of new Glob("spa/**/*.{ts,tsx}").scan({ cwd: process.cwd() })) {
      if (file.includes("node_modules") || file.includes("/.next/")) continue;
      files++;
      (await Bun.file(file).text()).split("\n").forEach((line, i) => {
        for (const spec of importsIn(line)) {
          const p = importProblem(file, spec);
          if (p) problems.push(`${file}:${i + 1}: ${p}`);
        }
      });
    }
    expect(files).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });
  test("importing @leasing/core from SPA code fails lint", () => {
    for (const file of ["spa/apps/engine/src/app.ts", "spa/apps/web/app/layout.tsx", "spa/packages/db/src/schema.ts"])
      expect(importProblem(file, "@leasing/core")).toBe(
        "SPA code may import only shared packages (S1), not @leasing/core",
      );
  });
});
