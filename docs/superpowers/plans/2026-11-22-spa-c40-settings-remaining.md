# SPA C40: remaining Settings pages (S72)

Approved by the user with the recommended answers. No schema change, no migration. Plan only; rulings are in `docs/spa/decisions.md` S72.

## Engine (`modules/spa/apps/engine`)
- `manager/settings-pages.ts` (new): `getCompany`, `saveCompany` (admin check, then `setCompany`), `getPolicyPage`, `savePolicyPage` (page allowlist `plans`, `signing`; strict body; merge onto latest; `publishPolicy` with an expected version inside its transaction), `getRulebookSettings` (allowlist of keys, pending without value, AML keys omitted, fee preview in fils from `registrationFee`), `listUsers`, `changeUser` (self-change and last-active-admin guards, locked rows, `USER_ROLE_CHANGED` / `USER_ACTIVE_SET`), `getModels`, `getIntegrations` (statuses only), `setDemoClock` (admin, 404 outside demo, `DEMO_CLOCK_SET`).
- `publishPolicy` gains an optional `expectVersion` (409 `stale_policy`).
- Routes in `app.ts`: `GET/PUT /api/settings/company`, `GET/PUT /api/settings/policy/:page`, `GET /api/settings/rulebook`, `GET /api/settings/users`, `PUT /api/settings/users/:id`, `GET /api/settings/models`, `GET /api/settings/integrations`, `POST /api/demo/clock`.
- `@spa/core` `STAFF_EVENTS`: the three new events. `main.ts` passes model tags (assistant, copilot) and integration states.

## Web (`modules/spa/apps/web`)
- Pages under `settings/`: `company`, `plans`, `signing`, `fees`, `users`, `models`, `integrations`, `demo-clock`; server actions read fixed fields and redirect with fixed codes; hub cards replace the placeholder.
- Compliance role names show neutrally on the Users page (no AML word on a page admin opens).

## Tests (TDD, each seen failing first)
Engine: role matrix (8 roles) for every route; rulebook (no write, pending without value, AML absent, version present, allowlist test); policy (page keys only, 422, 409, one version + one event per save); users (guards, audit, no hash); clock (404 outside demo); models and integrations (no URL, host or key). Web: form builders, pages per role through the real engine, word scan for all eight roles.

## Docs and checks
task.md line, S72, architecture routes, roadmap range S1-S72; `bun test ./modules/spa ./platform` once in the background; oxfmt; root tsc; lint; compliance-reviewer.
