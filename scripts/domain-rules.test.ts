import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { importProblem, importsIn, NOW, ownerOf } from "./domain-rules.ts";

describe("owners (S34)", () => {
  test("files belong to leasing, spa, platform, the portal or the root", () => {
    expect(ownerOf("modules/leasing/apps/engine/src/main.ts")).toBe("leasing");
    expect(ownerOf("modules/spa/packages/core/src/env.ts")).toBe("spa");
    expect(ownerOf("platform/kernel/src/clock.ts")).toBe("platform");
    expect(ownerOf("apps/portal/app/page.tsx")).toBe("portal");
    expect(ownerOf("scripts/eval.ts")).toBe("root");
    expect(ownerOf("modules/spare/x.ts")).toBe("root");
  });
});

describe("module boundary (S34)", () => {
  test("a module imports its own packages and @platform/*", () => {
    expect(importProblem("modules/leasing/apps/engine/src/main.ts", "@leasing/core")).toBeNull();
    expect(importProblem("modules/leasing/apps/web/app/layout.tsx", "@platform/ui/button")).toBeNull();
    expect(importProblem("modules/spa/apps/web/lib/x.ts", "@platform/ui/button")).toBeNull();
    expect(importProblem("modules/spa/apps/engine/src/app.ts", "@spa/db")).toBeNull();
    expect(importProblem("modules/spa/apps/engine/src/app.ts", "zod")).toBeNull();
  });
  test("a module never imports another module", () => {
    expect(importProblem("modules/spa/apps/engine/src/app.ts", "@leasing/core")).toContain(
      "spa may not import @leasing/core",
    );
    expect(importProblem("modules/spa/apps/web/app/x.tsx", "@leasing/helpers/kyc")).not.toBeNull();
    expect(importProblem("modules/leasing/apps/web/app/x.tsx", "@spa/core")).toContain(
      "leasing may not import @spa/core",
    );
  });
  test("platform imports only platform", () => {
    expect(importProblem("platform/ui/src/x.tsx", "@platform/kernel")).toBeNull();
    for (const spec of ["@leasing/core", "@leasing/adapters", "@spa/core"])
      expect(importProblem("platform/kernel/src/x.ts", spec)).toContain("platform may not import");
  });
  test("the portal imports only platform (it talks to the engines over HTTP, S10)", () => {
    expect(importProblem("apps/portal/app/page.tsx", "@leasing/core")).not.toBeNull();
    expect(importProblem("apps/portal/app/page.tsx", "@spa/core")).not.toBeNull();
    expect(importProblem("apps/portal/app/page.tsx", "@platform/ui/button")).toBeNull();
  });
  test("nothing outside the portal imports from apps/portal (S69)", () => {
    for (const file of [
      "modules/spa/apps/web/lib/x.ts",
      "modules/leasing/apps/engine/src/main.ts",
      "platform/ui/src/x.tsx",
      "scripts/x.ts",
    ]) {
      expect(importProblem(file, "@portal/launcher")).toContain("nothing imports from apps/portal");
      expect(importProblem(file, "@portal/launcher/lib/env")).not.toBeNull();
    }
    expect(importProblem("modules/spa/apps/web/lib/x.ts", "../../../../../apps/portal/lib/env.ts")).not.toBeNull();
    expect(importProblem("scripts/x.ts", "../apps/portal/lib/env.ts")).toContain("nothing imports from apps/portal");
    expect(importProblem("apps/portal/lib/x.ts", "@portal/launcher")).toBeNull();
    expect(importProblem("apps/portal/lib/x.ts", "./env.ts")).toBeNull();
  });
  test("root scripts may import any module (the eval runner, the lint itself)", () => {
    expect(importProblem("scripts/eval.ts", "@leasing/core")).toBeNull();
    expect(importProblem("scripts/x.ts", "@spa/core")).toBeNull();
  });
  test("a relative import never leaves its owner", () => {
    expect(importProblem("modules/spa/apps/web/lib/x.ts", "../../../../leasing/packages/core/src/index.ts")).toContain(
      "outside spa",
    );
    expect(
      importProblem("platform/kernel/src/x.ts", "../../../modules/leasing/packages/core/src/gates.ts"),
    ).not.toBeNull();
    expect(importProblem("modules/leasing/apps/engine/test/a.test.ts", "../../ejari-mock/src/db.ts")).toBeNull();
    expect(importProblem("platform/kernel/src/clock.ts", "./dates.ts")).toBeNull();
    expect(importProblem("scripts/x.ts", "../modules/leasing/packages/core/src/index.ts")).toBeNull();
  });
});

describe("the real tree (P2b)", () => {
  test("every import under modules/ and platform/ passes the boundary rule", async () => {
    const problems: string[] = [];
    let files = 0;
    for (const pattern of ["modules/**/*.{ts,tsx}", "platform/**/*.{ts,tsx}"])
      for await (const file of new Glob(pattern).scan({ cwd: process.cwd() })) {
        if (file.includes("node_modules") || file.includes("/.next/")) continue;
        files++;
        (await Bun.file(file).text()).split("\n").forEach((line, i) => {
          for (const spec of importsIn(line)) {
            const p = importProblem(file, spec);
            if (p) problems.push(`${file}:${i + 1}: ${p}`);
          }
        });
      }
    expect(files).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  });
});

describe("the real portal (S69)", () => {
  test("apps/portal imports no @leasing/* or @spa/* and no path out of itself; nothing else imports from it", async () => {
    const problems: string[] = [];
    let portalFiles = 0;
    for (const pattern of [
      "apps/**/*.{ts,tsx}",
      "modules/**/*.{ts,tsx}",
      "platform/**/*.{ts,tsx}",
      "scripts/**/*.ts",
    ]) {
      for await (const file of new Glob(pattern).scan({ cwd: process.cwd() })) {
        if (file.includes("node_modules") || file.includes("/.next/") || file === "scripts/domain-rules.test.ts")
          continue;
        if (file.startsWith("apps/portal/")) portalFiles++;
        (await Bun.file(file).text()).split("\n").forEach((line, i) => {
          for (const spec of importsIn(line)) {
            if (file.startsWith("apps/portal/") && /^@(leasing|spa)\//.test(spec))
              problems.push(`${file}:${i + 1}: imports ${spec}`);
            const p = importProblem(file, spec);
            if (p && (file.startsWith("apps/portal/") || /@portal\/|apps\/portal/.test(p)))
              problems.push(`${file}:${i + 1}: ${p}`);
          }
        });
      }
    }
    expect(portalFiles).toBeGreaterThan(5);
    expect(problems).toEqual([]);
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

describe("the lint run on a temporary tree (S69)", () => {
  /** Runs the real guard with a throwaway folder as the repo, so no fixture ever touches the checkout. */
  const lint = async (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), "domain-rules-"));
    try {
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, name)), { recursive: true });
        writeFileSync(join(root, name), text);
      }
      const p = Bun.spawn(["bun", `${import.meta.dir}/check-domain-rules.ts`], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      return { code: await p.exited, text: out + err };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
  test("a clean portal passes", async () => {
    const r = await lint({
      "apps/portal/lib/a.ts": 'import { z } from "zod";\nimport { b } from "./b.ts";\nimport "@platform/ui/card";\n',
      "apps/portal/lib/b.ts": "export const b = 1;\n",
    });
    expect(r.text).toContain("domain rules: ok");
    expect(r.code).toBe(0);
  });
  test("the portal imports no module package", async () => {
    for (const spec of ["@leasing/core", "@spa/core"]) {
      const r = await lint({ "apps/portal/lib/a.ts": `import { x } from "${spec}";\n` });
      expect(r.code).toBe(1);
      expect(r.text).toContain(`portal may not import ${spec}`);
    }
    const byPath = await lint({
      "apps/portal/lib/a.ts": 'import { x } from "../../../modules/spa/packages/core/src/env.ts";\n',
    });
    expect(byPath.code).toBe(1);
    expect(byPath.text).toContain("apps/portal/lib/a.ts:1");
  });
  test("no other app or package imports from apps/portal", async () => {
    const r = await lint({
      "apps/portal/lib/env.ts": "export const e = 1;\n",
      "modules/spa/apps/web/lib/a.ts": 'import { e } from "@portal/launcher/lib/env";\n',
      "modules/leasing/apps/web/lib/b.ts": 'import { e } from "../../../../../apps/portal/lib/env.ts";\n',
      "platform/ui/src/c.ts": 'import { e } from "@portal/launcher";\n',
    });
    expect(r.code).toBe(1);
    for (const f of [
      "modules/spa/apps/web/lib/a.ts:1",
      "modules/leasing/apps/web/lib/b.ts:1",
      "platform/ui/src/c.ts:1",
    ])
      expect(r.text).toContain(f);
    expect(r.text).toContain("nothing imports from apps/portal");
  });
});
