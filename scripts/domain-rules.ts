/**
 * Pure checks behind `scripts/check-domain-rules.ts` (AGENTS.md rules 5 and 8, SPA decision S1), kept apart so they
 * can be tested without scanning the repo.
 */
import { posix } from "node:path";

/** Current time in domain code: use `Clock`. */
export const NOW = /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)/;
/** Real tenant uploads are never referenced from code. */
export const UPLOADS = /data\/uploads/;

export type Owner = "leasing" | "spa" | "platform" | "portal" | "root";

/** Who owns a repo-relative path (S34): a module, the shared platform, the portal, or the repo root (scripts, docs). */
export function ownerOf(file: string): Owner {
  if (file.startsWith("modules/leasing/")) return "leasing";
  if (file.startsWith("modules/spa/")) return "spa";
  if (file.startsWith("platform/")) return "platform";
  if (file.startsWith("apps/")) return "portal";
  return "root";
}

/** The owner a package scope belongs to, or null for npm packages. */
const scopeOwner = (spec: string): Owner | null =>
  spec.startsWith("@leasing/")
    ? "leasing"
    : spec.startsWith("@spa/")
      ? "spa"
      : spec.startsWith("@platform/")
        ? "platform"
        : null;

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
 * The module boundary (S34). `file` is repo-relative with `/` separators. Returns a problem, or null when allowed:
 * - a module (leasing, spa) imports its own packages, `@platform/*` and npm packages, never another module;
 * - `platform/` imports only `@platform/*` and npm packages (no domain code);
 * - the portal (`apps/`) imports only `@platform/*`: it talks to each engine over HTTP (S10);
 * - nothing outside the portal imports from `apps/portal`, by `@portal/*` or by path (S69);
 * - root scripts (eval runner, this lint) may import anything else;
 * - a relative import never leaves its owner.
 */
export function importProblem(file: string, spec: string): string | null {
  const owner = ownerOf(file);
  // Nothing outside the portal imports from it, scripts included (S69): it is a leaf that only reads the engines by URL.
  if (owner !== "portal") {
    const into = spec.startsWith(".") ? ownerOf(posix.normalize(posix.join(posix.dirname(file), spec))) : null;
    if (spec.startsWith("@portal/") || into === "portal")
      return `${owner} may not import ${spec}: nothing imports from apps/portal (S69)`;
  }
  if (owner === "root") return null;
  if (spec.startsWith(".")) {
    const target = ownerOf(posix.normalize(posix.join(posix.dirname(file), spec)));
    return target === owner
      ? null
      : `${owner} code must not import outside ${owner} by path (${spec}); use a package (S34)`;
  }
  const to = scopeOwner(spec);
  if (to === null || to === "platform" || to === owner) return null;
  return `${owner} may not import ${spec} (S34)`;
}
