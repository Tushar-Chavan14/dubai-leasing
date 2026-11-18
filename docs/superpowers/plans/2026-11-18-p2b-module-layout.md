# P2b: Modules + Platform Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the monorepo to `modules/leasing`, `modules/spa` and `platform/` with `@platform/*` names for shared code, with no change in leasing or SPA behaviour.

**Architecture:** A pure move-and-rename. Leasing apps and packages move together (so relative paths between them keep working); SPA moves the same way; shared, domain-free code moves to `platform/` and is renamed `@platform/*`. The only code changes are paths that cross the repo root, the import boundary rule, and splitting `@leasing/adapters` into a generic `@platform/adapters` and the leasing-specific rest. Decision S34 records it.

**Tech Stack:** Bun workspaces, TypeScript, Next.js 16, Hono, Drizzle, pg-boss, oxlint/oxfmt.

**Spec:** The P2b proposal in this conversation (2026-11-18), accepted by the user: modules as peers, one shared layer, `@platform/*` names, readers stay in leasing until P5/P6, `bun run dev` unchanged.

## Global Constraints

- No leasing or SPA behaviour or visual change. Leasing typecheck, lint, tests and evals give the same results as the Task 0 baseline.
- No model tags, pinned versions or `.env*` files changed. Never open `data/uploads/`, `.env`, `.env.local` or `.env.spa.local`.
- No commits (user preference): each task ends at a checkpoint, not a commit.
- Move tracked files with `git mv` so history follows. Delete the old folder afterwards only when `git status --ignored <old>` shows nothing but `node_modules/`, `.next/`, `next-env.d.ts`, `*.tsbuildinfo`.
- Ports, scripts and commands the user types stay the same: `bun run dev` (leasing 3000/4000), `dev:leasing`, `dev:spa` (3001/4001), `db:*`, `demo:*`, `spa:*`, `test`, `typecheck`, `lint`, `eval`.
- No `Date.now()` / `new Date()` added to domain code.

## Target layout

```
modules/leasing/apps/{engine,web,telegram-bot,ejari-mock}
modules/leasing/packages/{core,rulebook,db,copilot,helpers,adapters}
modules/spa/apps/{engine,web}
modules/spa/packages/{core,rulebook,db,helpers}
platform/{kernel,ui,llm,adapters}
apps/                      (empty until the portal, P10; not a workspace yet)
docs/{leasing,spa,platform}/ + docs/roadmap.md + docs/superpowers/
```

## Rename map (used by Tasks 1–6)

| Old | New |
|---|---|
| `packages/kernel` `@leasing/kernel` | `platform/kernel` `@platform/kernel` |
| `packages/ui` `@leasing/ui` | `platform/ui` `@platform/ui` |
| `packages/llm` `@leasing/llm` | `platform/llm` `@platform/llm` |
| generic half of `packages/adapters` | `platform/adapters` `@platform/adapters` (new) |
| `packages/{core,rulebook,db,copilot,helpers,adapters}` | `modules/leasing/packages/…` (names unchanged) |
| `apps/{engine,web,telegram-bot,ejari-mock}` | `modules/leasing/apps/…` (names unchanged) |
| `spa/apps/*`, `spa/packages/*` | `modules/spa/apps/*`, `modules/spa/packages/*` |
| `docs/{specs,architecture,decisions,demo-rehearsal,import,legal-review-emirates}.md`, `docs/source/` | `docs/leasing/…` |

## Review Focus

1. A leftover old folder (`packages/core/node_modules`, `apps/web/.next`) still resolves an import, so the suite passes against stale code. Task 3/4 delete old folders and Task 7 asserts none of `apps/{engine,web,telegram-bot,ejari-mock}`, `packages/`, `spa/` exist.
2. A `--env-file` path one level off: the leasing engine fails fast, but the leasing web app starts with no env and uses defaults. Task 3 adds a test that every `--env-file` in a package.json resolves to `<repo>/.env`.
3. The engine's repo root (uploads, media, documents dirs) one level off, so files are written outside the repo. Task 3 adds a test that `repoRoot` holds the root `package.json`.
4. Tailwind no longer scans `@platform/ui` (moved `@source`), so classes silently disappear. Task 7 re-runs the P2 CSS comparison: identical rules.
5. Tests silently not discovered after the move. Task 7 compares the test count with the Task 0 baseline (equal, plus only the tests this plan adds).

---

### Task 0: Baseline

**Files:** none (records numbers in the scratchpad).

- [ ] **Step 1:** Run `bun run typecheck`, `bun run lint`, `bun test`; record pass/skip/fail and the test and file counts. Expected: 0 fail (a lone failure that passes when its file is re-run alone is the shared test DB; note it).
- [ ] **Step 2:** Record the compiled leasing CSS with the P2 script (`scratchpad/css.ts`, inputs `app/tailwind.css`, `@leasing/ui` `base.css`, `app/globals.css`).
- [ ] **Step 3:** Note the eval baseline from P2: kyc 35/36 (0 expired verified, 0 injection verified); contract-structure 27/27, 0 invalid.

### Task 1: `platform/` with kernel, ui, llm (`@platform/*`)

**Files:**
- Move (`git mv`): `packages/kernel` → `platform/kernel`, `packages/ui` → `platform/ui`, `packages/llm` → `platform/llm`
- Create: `platform/kernel/src/helper-runner.ts` (moved body of `packages/helpers/src/runner.ts`)
- Modify: each moved `package.json` (`name`), `packages/helpers/src/runner.ts` (re-export), every importer, root `package.json`, `tsconfig.json`, `apps/web/next.config.ts`, `spa/apps/web/next.config.ts`, the two app layouts and `tailwind.css` files, `scripts/check-domain-rules.ts` path constants, `spa/apps/web/test/no-other-module.test.ts`
- Test: `platform/kernel/test/kernel.test.ts` (add one case)

**Interfaces:**
- Produces: packages `@platform/kernel` (exports `.` and `./*`), `@platform/ui` (same export map as today), `@platform/llm`; `runHelper` and `RunRecord` exported from `@platform/kernel` (and still from `@leasing/helpers`).

- [ ] **Step 1: Failing test.** In `platform/kernel/test/kernel.test.ts` (after the move) add `test("runHelper is part of the kernel", …)` importing `runHelper` from `../src/index.ts`, running a helper that returns `{status:"ok",data:1,reasons:[],sourceDocIds:[]}` with a `z.number()` schema, expecting `result.status === "ok"` and `attempts === 1`.
- [ ] **Step 2:** `bun test platform/kernel` → FAIL (`runHelper` not exported).
- [ ] **Step 3:** `git mv` the three folders; set `"name"` to `@platform/kernel|ui|llm`; move the runner body to `platform/kernel/src/helper-runner.ts`, export it from the kernel index, and make `packages/helpers/src/runner.ts` `export { runHelper, type RunRecord } from "@platform/kernel/helper-runner";`. Remove `@leasing/core` from `platform/llm/package.json` (it is never imported).
- [ ] **Step 4:** Rename imports repo-wide with one script over `*.ts,*.tsx,*.css,*.json,*.mjs` outside `node_modules`/`.next`: `@leasing/kernel` → `@platform/kernel`, `@leasing/ui` → `@platform/ui`, `@leasing/llm` → `@platform/llm` (including `package.json` dependencies, `transpilePackages`, CSS `@import`, the layouts' `import "@…/base.css"`). In the S21 test remove the `@leasing/(ui|kernel)` exemption (the new names hold no leasing words).
- [ ] **Step 5:** Workspaces: `["apps/*","packages/*","platform/*","spa/apps/*","spa/packages/*"]`; `typecheck` uses `platform/ui/tsconfig.json`; root `tsconfig.json` includes `platform/*/src/**/*`, `platform/*/test/**/*` and excludes `platform/ui/**`. In `check-domain-rules.ts`/`domain-rules.ts` replace `packages/kernel/` with `platform/kernel/` (rule rewrite comes in Task 5).
- [ ] **Step 6:** `bun install`, delete `packages/{kernel,ui,llm}` leftovers, then `bun run typecheck && bun run lint && bun test platform packages/helpers` → all pass, new test included.
- [ ] **Checkpoint** (no commit).

### Task 2: Split adapters

**Files:**
- Create: `platform/adapters/{package.json,src/index.ts}`; move (`git mv`) `packages/adapters/src/{mail/nodemailer.ts,mail/types.ts,pdf/,storage/,esign/}` and `packages/adapters/test/{fixtures.ts,strip.test.ts}` into `platform/adapters/{src,test}/…`
- Modify: `packages/adapters/src/index.ts` (re-export the moved names from `@platform/adapters`), `packages/adapters/package.json` (depends on `@platform/adapters`), engine tests importing `../../../packages/adapters/test/fixtures.ts` (3 files)
- Test: `platform/adapters/test/strip.test.ts` (moved, unchanged)

**Interfaces:**
- Produces: `@platform/adapters` exporting exactly the moved names: `FakeMailer`, `MailConfig`, `NodemailerMailer`, mail types, `PdfBlock`, `renderPdf`, `PdfLogoError`, `PdfLogo`, `PdfLook`, `renderStyledPdf`, `StyledBlock`, `appendSignatureRecord`, `SignatureRecord`, `ImageType`, `LocalDiskStore`, `sniffImage`, `stripImageMetadata`, storage and esign types; subpath `@platform/adapters/test-fixtures` → `./test/fixtures.ts`. `@leasing/adapters` keeps every export it has today (Ejari, Telegram, mail templates, plus re-exports), so its 65 importers don't change.
- Deps: `platform/adapters` gets `nodemailer`, `pdf-lib`, `@types/nodemailer` at today's pinned versions and no `@leasing/*`.

- [ ] **Step 1:** Move the files; write `platform/adapters/src/index.ts` with the export list above.
- [ ] **Step 2:** `packages/adapters/src/index.ts`: replace the moved exports with `export { … } from "@platform/adapters";` (same names, same `type` modifiers). Any remaining file in `packages/adapters/src` that imported a moved file by relative path imports it from `@platform/adapters` instead.
- [ ] **Step 3:** Engine tests: `import { jpegWithExif } from "@platform/adapters/test-fixtures";`.
- [ ] **Step 4:** `bun install && bun run typecheck && bun run lint && bun test platform/adapters packages/adapters apps/engine/test/{units,move-out,tenancy}.test.ts` → all pass; `grep -r "@leasing" platform/` → no match.
- [ ] **Checkpoint.**

### Task 3: Leasing into `modules/leasing`

**Files:**
- Move (`git mv`): `apps/{engine,web,telegram-bot,ejari-mock}` → `modules/leasing/apps/`, `packages/{core,rulebook,db,copilot,helpers,adapters}` → `modules/leasing/packages/`
- Modify (root-crossing paths only):
  - every `--env-file=../../.env` in `modules/leasing/{apps,packages}/*/package.json` → `--env-file=../../../../.env` (engine ×6, web ×2, telegram-bot, ejari-mock, db migrate)
  - `modules/leasing/apps/engine/src/main.ts:32` repo root `new URL("../../..", …)` → `new URL("../../../../..", …)`; export it as `repoRoot` from a new `modules/leasing/apps/engine/src/repo-root.ts` and import it in `main.ts`
  - `modules/leasing/packages/db/drizzle.config.ts` `"../../.env"` → `"../../../../.env"`
  - `modules/leasing/apps/web/tsconfig.json` `extends` → `../../../../tsconfig.base.json`
  - root `package.json`: workspaces add `modules/leasing/apps/*`, `modules/leasing/packages/*` (drop `apps/*`, `packages/*`); `dev`/`dev:leasing` filter `./modules/leasing/apps/*`; `typecheck` path `modules/leasing/apps/web/tsconfig.json`
  - root `tsconfig.json` includes: `packages/*` → `modules/leasing/packages/*`, `apps/engine`… → `modules/leasing/apps/…`
  - `scripts/eval.ts` paths → `modules/leasing/packages/helpers/scripts/…`, `modules/leasing/apps/engine/src/evals/…`
- Test: create `modules/leasing/apps/engine/test/paths.test.ts`

**Interfaces:**
- Produces: `repoRoot: string` from `modules/leasing/apps/engine/src/repo-root.ts`.

- [ ] **Step 1:** Do the `git mv` moves only (no path edits yet).
- [ ] **Step 2: Failing test** `modules/leasing/apps/engine/test/paths.test.ts`:
  - `test("the engine's repo root is the workspace root")`: `JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).name === "leasing-agents"`.
  - `test("every --env-file in a leasing package.json points at the repo .env")`: for each `modules/leasing/{apps,packages}/*/package.json`, every `--env-file=X` in its scripts satisfies `resolve(dirname(pkgPath), X) === join(repoRoot, ".env")`.
- [ ] **Step 3:** `bun test modules/leasing/apps/engine/test/paths.test.ts` → FAIL (no `repo-root.ts`; env paths one level short).
- [ ] **Step 4:** Make the path edits listed under Files.
- [ ] **Step 5:** Delete old `apps/*` and `packages/*` leftovers (Global Constraints rule), `bun install`, then `bun run typecheck && bun run lint && bun test` → same counts as Task 0 plus the new tests.
- [ ] **Checkpoint.**

### Task 4: SPA into `modules/spa`

**Files:**
- Move: `spa/apps` → `modules/spa/apps`, `spa/packages` → `modules/spa/packages`
- Modify: `modules/spa/apps/web/tsconfig.json` `extends` → `../../../../tsconfig.base.json`; root workspaces `spa/*` → `modules/spa/apps/*`, `modules/spa/packages/*`; `spa:engine`/`spa:web`/`spa:*` scripts keep their names (filters by package name need no change); `typecheck` path; root `tsconfig.json` includes; `scripts/domain-rules.test.ts` real-tree glob `spa/**` → `modules/spa/**`
- `findRepoRoot` (marker `.env.spa.example`) needs no change.

- [ ] **Step 1:** Move, edit, delete the old `spa/` leftovers, `bun install`.
- [ ] **Step 2:** `bun run typecheck && bun run lint && bun test ./modules/spa ./scripts` → 31+ pass, 0 fail.
- [ ] **Checkpoint.**

### Task 5: Boundary rule for modules and platform

**Files:**
- Modify: `scripts/domain-rules.ts`, `scripts/check-domain-rules.ts`
- Test: `scripts/domain-rules.test.ts` (rewrite the boundary cases)

**Interfaces:**
- Produces: `ownerOf(file: string): "leasing" | "spa" | "platform" | "portal" | "root"` (by prefix `modules/leasing/`, `modules/spa/`, `platform/`, `apps/`, else root) and `importProblem(file: string, spec: string): string | null` with these rules:
  - `@leasing/*` only from `leasing` (and `root` scripts); `@spa/*` only from `spa` (and `root`); `@platform/*` from anyone.
  - `platform` may import only `@platform/*`, its own relative files and npm packages.
  - A relative import may not leave its owner (`root` excepted).
  - `portal` may import only `@platform/*` (it talks to engines over HTTP, S10).
- `check-domain-rules.ts` globs: DOMAIN = `platform/kernel/src`, `modules/*/packages/{core,rulebook,helpers}/src`, `modules/leasing/packages/copilot`, `modules/*/apps/engine/src/manager`, `modules/leasing/apps/engine/src/import`; TIME_EDGES = `platform/kernel/src/{clock,dates}.ts`; ALL_CODE/IMPORT_CODE cover `modules/**`, `platform/**`, `apps/**`, `scripts/**`; the `data/uploads` exemption path → `modules/leasing/packages/core/src/env.ts`.

- [ ] **Step 1: Failing tests** (replace the S1/kernel cases): `importProblem("modules/spa/apps/engine/src/app.ts","@leasing/core")` contains `"spa may not import @leasing/core"`; `("modules/leasing/apps/web/app/x.tsx","@spa/core")` not null; `("platform/kernel/src/x.ts","@leasing/core")` not null; `("platform/ui/src/x.tsx","@platform/kernel")` null; `("modules/spa/apps/web/lib/x.ts","@platform/ui/button")` null; `("modules/spa/apps/web/lib/x.ts","../../../../leasing/packages/core/src/index.ts")` not null; `("apps/portal/app/page.tsx","@leasing/core")` not null; `("scripts/eval.ts","@leasing/core")` null; the real-tree test over `modules/**` and `platform/**` finds no problem.
- [ ] **Step 2:** `bun test scripts` → FAIL.
- [ ] **Step 3:** Implement `ownerOf` and the rules; update the globs.
- [ ] **Step 4:** `bun test scripts && bun run lint` → pass; temporarily add `import "@leasing/core"` to a file under `modules/spa/` and confirm `bun scripts/check-domain-rules.ts` reports it, then remove it.
- [ ] **Checkpoint.**

### Task 6: Docs, instructions and decision S34

**Files:**
- Move: leasing docs to `docs/leasing/` (rename map); create `docs/platform/README.md` (what each `@platform/*` package holds, the boundary rule, how to add one).
- Modify with one path-mapping script (rename map, longest prefix first, skip text already prefixed with `modules/` or `platform/`): `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/leasing/**`, `docs/spa/**`, `docs/roadmap.md`, `.claude/skills/**`, `.claude/agents/**`, `.claude/settings.json`, and code comments in `modules/**` and `platform/**`. Leave `docs/superpowers/**` (history) untouched.
- Rewrite: `AGENTS.md` "Repo map" and "SPA module boundary" to the new layout and rule; add S34 to `docs/spa/decisions.md` (supersedes S1's folder layout and S32's subpath exception: shared readers stay in `@leasing/helpers` until P5/P6 move them to `platform/`); tick P2b in `docs/roadmap.md` and `docs/spa/task.md` (add the line under P2).
- Memory: update paths in `MEMORY.md` entries that name `packages/*` or `apps/*` (engine-watch, next-build).

- [ ] **Step 1:** Run the mapping script; then `grep -rnE "(^|[^/])(apps/(engine|web|telegram-bot|ejari-mock)|packages/(core|rulebook|db|copilot|helpers|adapters|kernel|ui|llm)|spa/(apps|packages))" AGENTS.md CLAUDE.md README.md docs/leasing docs/spa docs/roadmap.md .claude modules platform --include=*.md --include=*.ts --include=*.tsx --include=*.json` → no match except inside `node_modules`.
- [ ] **Step 2:** `grep -rn "@leasing/\(kernel\|ui\|llm\)" --exclude-dir=node_modules --exclude-dir=superpowers .` → no match.
- [ ] **Checkpoint.**

### Task 7: Verify and review

- [ ] **Step 1:** `ls apps packages spa 2>&1` → `apps` empty or absent, the others absent.
- [ ] **Step 2:** `bun run typecheck && bun run lint && bun test` → 0 fail; test count = Task 0 count + tests added in Tasks 1, 3, 5.
- [ ] **Step 3:** CSS comparison (Task 0 Step 2 script with the new paths) → identical rules.
- [ ] **Step 4:** `bun run eval -- kyc` and `bun run eval -- contract-structure` (not while tests run) → same as Task 0 Step 3.
- [ ] **Step 5:** `bun run dev:leasing` → `:4000/api/auth/demo-users` 200 and `:3000/login` 200; `bun run dev:spa` → `:4001/health` 200 (`ok:true`) and `:3001/sign-in` 200; sign in as one SPA role and see its rail. Stop all servers.
- [ ] **Step 6:** Run the `compliance-reviewer` subagent on the diff; fix what it finds.
