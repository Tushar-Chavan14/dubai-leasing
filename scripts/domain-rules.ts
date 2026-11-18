/**
 * Pure checks behind `scripts/check-domain-rules.ts` (AGENTS.md rules 5 and 8, SPA decision S1), kept apart so they
 * can be tested without scanning the repo.
 */
import { posix } from "node:path";

/** Current time in domain code: use `Clock`. */
export const NOW = /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/;
/** Real tenant uploads are never referenced from code. */
export const UPLOADS = /data\/uploads/;

/** Shared packages SPA code may import (S1), each with any subpath. */
const SPA_SHARED_PACKAGES = ["@platform/kernel", "@platform/llm", "@leasing/adapters", "@platform/ui"];
/** The shared parts of `@leasing/helpers` (each called with a profile, S4); the package root is leasing's. */
const SPA_SHARED_HELPERS = ["@leasing/helpers/runner", "@leasing/helpers/kyc", "@leasing/helpers/contract-structure"];

const isSpaFile = (file: string) => file === "spa" || file.startsWith("spa/");
const isKernelFile = (file: string) => file.startsWith("platform/kernel/");
const within = (spec: string, pkg: string) => spec === pkg || spec.startsWith(`${pkg}/`);

/** Every module specifier a line imports or re-exports (`from "x"`, `import "x"`, `import("x")`, `require("x")`). */
export function importsIn(line: string): string[] {
  const out: string[] = [];
  for (const re of [
    /\bfrom\s+["']([^"']+)["']/g,
    /^\s*import\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of line.matchAll(re)) out.push(m[1]!);
  }
  return out;
}

/**
 * The module boundary (S1). `file` is repo-relative with `/` separators. Returns a problem, or null when allowed:
 * - leasing code (anything outside `spa/`) never imports `@spa/*` or a file under `spa/`;
 * - SPA code imports `@leasing/*` only from the shared packages (kernel, llm, adapters, ui, and exactly the three
 *   shared helper entry points), and never reaches out of `spa/` by a relative path;
 * - the kernel imports no other workspace package (`@leasing/*` or `@spa/*`) and nothing outside `platform/kernel/`.
 */
export function importProblem(file: string, spec: string): string | null {
  const spa = isSpaFile(file);
  if (isKernelFile(file)) {
    if (spec.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      return isKernelFile(target) ? null : `the kernel must not import outside platform/kernel/ (${spec}) (S4)`;
    }
    if (within(spec, "@platform/kernel")) return null;
    return spec.startsWith("@leasing/") || within(spec, "@spa")
      ? `the kernel must not import a domain package (${spec}) (S4)`
      : null;
  }
  if (spec.startsWith(".")) {
    const target = posix.normalize(posix.join(posix.dirname(file), spec));
    if (spa && !isSpaFile(target))
      return `SPA code must not import outside spa/ by path (${spec}); use a shared package (S1)`;
    if (!spa && isSpaFile(target)) return `leasing code must not import SPA code (${spec}) (S1)`;
    return null;
  }
  if (!spa) return within(spec, "@spa") ? `leasing code must not import ${spec} (S1)` : null;
  if (!spec.startsWith("@leasing/")) return null;
  if (SPA_SHARED_PACKAGES.some((p) => within(spec, p))) return null;
  // Exact entry points only: the helpers' internals still import leasing code (S32).
  if (SPA_SHARED_HELPERS.includes(spec)) return null;
  return `SPA code may import only shared packages (S1), not ${spec}`;
}
