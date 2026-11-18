import { expect, test } from "bun:test";
import { Glob } from "bun";

/**
 * S21: inside the SPA app nothing names, links or counts another module. Comments may explain the boundary; code,
 * strings and markup may not mention leasing words.
 */
const OTHER = /\b(leas(e|es|ing)|tenan\w*|landlords?|ejari|rental|rent)\b|:3000|:4000|leasing_/i;
// The shared packages' scope (`@platform/ui`, S1) is a package name, not text in the app.
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/["']@leasing\/(ui|kernel)(\/[\w./-]+)?["']/g, '""');

test("no SPA web source names another module", async () => {
  const hits: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for await (const f of new Glob(`${dir}/**/*.{ts,tsx,css}`).scan({ cwd: `${import.meta.dir}/..` })) {
      const text = stripComments(await Bun.file(`${import.meta.dir}/../${f}`).text());
      text.split("\n").forEach((line, i) => {
        if (OTHER.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  expect(hits).toEqual([]);
});
