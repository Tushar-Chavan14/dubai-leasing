# C37 — Portal launcher (P10 first line, S69) plan

Goal: `apps/portal` (:3100), a module chooser. Two tiles ("Leasing", "Sales (SPA)"), each a link. No sign-in, no cookies, no schema change.

## Parts
1. **`apps/portal`** (`@portal/launcher`, Next.js; imports `@platform/*` only; reaches modules by URL):
   `lib/env.ts` (S25 style: reads only `.env.portal.local`; `PORTAL_PORT`, `PORTAL_LEASING_URL`, `PORTAL_SPA_URL`,
   `PORTAL_LEASING_ENGINE_URL`, `PORTAL_SPA_ENGINE_URL`, `PORTAL_SUMMARY_KEY`, `PORTAL_SHOW_COUNTS`), `lib/tiles.ts` (fetch `/summary`, 2 s timeout,
   zod-checked integers; any failure = "Not available"), `components/portal-home.tsx`, `app/`, `scripts/next.ts`.
2. **`GET /summary`** in both engines: header `x-portal-key` == `PORTAL_SUMMARY_KEY` (shared helper `portalKeyOk`, constant time);
   key unset or wrong = the same 404; answer = `{ openWork, waitingApprovals }` integers only. SPA leaves compliance gates out of the count. Reads only its own database.
3. **Leasing web**: "Portal" link in the avatar menu (`LEASING_PORTAL_URL`, default `http://localhost:3100`); SPA header link (`SPA_PORTAL_URL`) unchanged.
4. **Root**: `apps/*` workspace, `dev:all`, `dev:portal`, portal tsconfig in `typecheck`; `check-domain-rules`: portal imports no module package, nothing outside the portal imports from `apps/portal` (`@portal/*` or by path).
5. **Docs**: S69 (amends S10: counts hidden until sign-in), task.md P10 line 1, AGENTS.md repo map, architecture §2, roadmap S1–S69.

## Order (TDD, each test seen failing first)
kernel `portalKeyOk` -> boundary rules -> SPA summary -> leasing summary -> portal env/tiles/page -> leasing Portal link + no-other-module test -> scripts test -> docs -> one full background run -> oxfmt, tsc, lint.

## Not built
Portal sign-in or shared cookies (stage 2), counts per user, any other module's text in either app (S21).
