# C38 Shared sign-in (portal stage 2, S70)

Approved with the recommended answers. Needs approval (database schema, more than three packages): given.

## Rulings

- The portal proves who a person is and nothing else. Own `portal` database (`portal_accounts`, argon2id), Drizzle
  migrations in `apps/portal`. No self sign-up: `portal:create-account` CLI. Wrong email and wrong password: one answer.
- Hand-off token: EdDSA, exp 60 s, `jti`, claims `sub`, `email`, `aud` (leasing | spa). No role claim: a token that
  carries one is refused. Modules hold only the public key (`LEASING_PORTAL_PUBLIC_KEY`, `SPA_PORTAL_PUBLIC_KEY`).
- `POST /api/auth/portal-exchange` in each engine: verify, take the `jti` once, find an active user by lower-case email
  in the module's own table, issue the module's own session. No match: 403, one body. Never creates a user or a role.
  `?check=1`: same checks, no session, no `jti` taken, answers `{ active }`.
- Cookies: `portal_session` (portal), `spa_session`, `leasing_session`. Signing out of an app clears its own only.
- Tiles and counts show only for modules whose engine says the email has an active user there (amends C37).
- Demo mode and each app's own sign-in stay. No public key set: nothing changes.
- Exchange is rate limited per IP and per email. Wall clock only for token expiry; the rest uses the engine Clock.

## Schema

- Portal db: `portal_accounts` (id, email unique + lower-case CHECK, password_hash, active, created_at).
- Leasing 0047 and SPA 0064: `portal_handoffs` (jti primary key, used_at), append-only trigger, no delete or truncate.

## Steps (test first, see it fail, then build)

1. Kernel: `portal-token.ts` (sign, verify), `rate-limit.ts`, `portal-exchange.ts` (the shared decision, injected store).
2. db: `portal_handoffs` schema + migration + trigger tests, both modules.
3. Engines: env key, route, tests per review focus (aud, role claim, replay, expiry, no-user 403, secrets, rate limit, check).
4. Portal: env, db, accounts, sign-in, `portal_session`, tiles by access, hand-off redirect, sign-out, CLIs, tests.
5. Web apps: `/auth/portal` hand-off route per app, tests of the pure helper.
6. Docs (task, S70, AGENTS repo map, architecture §2, roadmap), format, typecheck, lint, one full test run, compliance review.
