import { afterEach, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { portalUrl } from "../lib/env";

const saved = process.env.LEASING_PORTAL_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.LEASING_PORTAL_URL;
  else process.env.LEASING_PORTAL_URL = saved;
});

describe("the Portal link in the leasing header (S69)", () => {
  test("it is a plain link labelled Portal to the given address", async () => {
    const link = await Bun.file(`${import.meta.dir}/../components/shell/portal-link.tsx`).text();
    expect(link).toContain("href={href}");
    expect(link).toMatch(/Portal\s*<\/a>/);
  });
  test("LEASING_PORTAL_URL sets it; unset, empty or not an http(s) URL gives the local default", () => {
    process.env.LEASING_PORTAL_URL = "https://portal.example.test/";
    expect(portalUrl()).toBe("https://portal.example.test");
    for (const v of ["", "  ", "javascript:alert(1)", "not a url"]) {
      process.env.LEASING_PORTAL_URL = v;
      expect(portalUrl()).toBe("http://localhost:3100");
    }
    delete process.env.LEASING_PORTAL_URL;
    expect(portalUrl()).toBe("http://localhost:3100");
  });
  test("the staff shell passes the address to the link, beside its own sign-out", async () => {
    const shell = await Bun.file(`${import.meta.dir}/../components/shell/staff-shell.tsx`).text();
    expect(shell).toContain("<PortalLink href={portalUrl} />");
    expect(shell).toContain("action={logout}");
    const layout = await Bun.file(`${import.meta.dir}/../app/(staff)/layout.tsx`).text();
    expect(layout).toContain("portalUrl={portalUrl()}");
  });
});

/**
 * S21 for the leasing app: apart from the "Portal" link, nothing in its source names, links or counts the sales module.
 * Comments may explain the boundary; code, strings and markup may not.
 */
const OTHER = /\b(spa|oqood|sales deals?|sales \(spa\)|buyers?|sellers?)\b|spa_session|SPA_|:3001|:4001|@spa\//i;
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("leasing web names no other module (S21)", () => {
  test("no leasing web source names the sales module", async () => {
    const hits: string[] = [];
    let files = 0;
    for (const dir of ["app", "components", "lib"]) {
      for await (const f of new Glob(`${dir}/**/*.{ts,tsx,css}`).scan({ cwd: `${import.meta.dir}/..` })) {
        files++;
        const text = stripComments(await Bun.file(`${import.meta.dir}/../${f}`).text());
        text.split("\n").forEach((line, i) => {
          if (OTHER.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(files).toBeGreaterThan(100);
    expect(hits).toEqual([]);
  });
});
