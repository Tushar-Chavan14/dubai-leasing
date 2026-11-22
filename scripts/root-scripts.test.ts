import { describe, expect, test } from "bun:test";
import pkg from "../package.json";

const scripts = pkg.scripts as Record<string, string>;
const LEASING = "--filter './modules/leasing/apps/*'";
const SPA = "--filter './modules/spa/apps/*'";
const PORTAL = "--filter './apps/*'";

describe("root scripts (S33, S69)", () => {
  test("`dev` still starts leasing only", () => {
    expect(scripts.dev).toBe(`bun run ${LEASING} dev`);
    expect(scripts.dev).not.toContain("spa");
    expect(scripts.dev).not.toContain(PORTAL);
    expect(scripts.dev!.match(/--filter/g)).toHaveLength(1);
    expect(scripts["dev:leasing"]).toBe(scripts.dev!);
  });
  test("`dev:all` starts leasing, the sales module and the portal", () => {
    const all = scripts["dev:all"]!;
    for (const part of [LEASING, SPA, PORTAL]) expect(all).toContain(part);
    expect(all.startsWith("bun run ")).toBe(true);
    expect(all.endsWith(" dev")).toBe(true);
    expect(all.match(/--filter/g)).toHaveLength(3);
  });
  test("the portal can start alone", () => {
    expect(scripts["dev:portal"]).toBe(`bun run ${PORTAL} dev`);
  });
  test("apps/* is a workspace and the portal's tsconfig is in typecheck", () => {
    expect(pkg.workspaces).toContain("apps/*");
    expect(scripts.typecheck).toContain("tsc -p apps/portal/tsconfig.json");
  });
  test("the dev filters match the apps' own dev scripts", async () => {
    const portal = (await Bun.file(`${import.meta.dir}/../apps/portal/package.json`).json()) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(portal.name).toBe("@portal/launcher");
    expect(portal.scripts.dev).toBe("bun scripts/next.ts dev");
  });
});
