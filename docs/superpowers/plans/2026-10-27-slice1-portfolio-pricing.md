# Slice 1: Portfolio and pricing rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Units belong to companies and carry a category/subtype; a unit's allowed asking rent
comes from the company's rent rule (a % band around the SRI plus optional AED bounds), offer
cheque limits come from the company's contract rule, and admins manage companies and rules in a
new Settings screen. The demo seed is rebuilt around fictional companies.

**Architecture:** One pure function in `packages/core` (`allowedAskingRange`) computes the band;
the engine loads the matching rule and SRI row (`apps/engine/src/manager/pricing.ts`) and passes
the band into the unit state machine guard instead of the company policy. Rules are immutable
rows: an edit inserts a new row and deactivates the old one, so history is kept.

**Tech Stack:** Bun, TypeScript strict, Drizzle (Postgres), Hono, Zod, Next.js 16 (vanilla CSS
tokens, D18).

**Spec:** `docs/superpowers/specs/2026-10-27-contract-ai-redesign-design.md` §2–§4, §6
(Settings, Units), §8, §9 slice 1.

## Global Constraints

- Money is integer fils; percentages in rules are signed **basis points** (−500 = −5%).
- No `new Date()` / `Date.now()` in domain code; use `ctx.clock`.
- Every model/HTTP boundary is Zod-parsed.
- Admin-only writes for companies and rules; any staff may read.
- Fail closed: no rule, or a rule with no usable bound → no allowed range → `price_out_of_range`.
- Fictional company names only; must not match real Dubai developers ("Modon", "Emaar",
  "Nakheel", "Meraas", "Damac", "Sobha", "Azizi", "Danube" are out).
- UI copy: no em dashes, plain sentences, D18 tokens only, no new UI libraries.
- **Do not commit** (user preference). Where a task ends, run the checks and stop for review.
- Don't run `next build` while the dev server runs (memory: it breaks dev).
- Restart the engine after editing `packages/*` (memory: `--watch` keeps stale code).

## Review Focus

1. A unit with **no SRI row** for its community/category: the band uses AED bounds only; with no
   AED bounds either, the range is `null` and the price needs approval. Test in Task 1 and Task 3.
2. **Commercial/retail units without bedrooms** must pass the unit checklist and get a per-sqft
   band; a commercial unit with no `areaSqft` has no SRI band. Test in Task 1.
3. **Changing company, category, subtype or community** on a READY/LISTED unit can move the
   price out of range and must be refused like a rent change; a pending price approval is
   cancelled. Test in Task 3.
4. **Two rules equally specific** for the same unit: the newest active one wins, deterministically
   (`created_at desc, id desc`). Test in Task 3.
5. **Import without a company** must fail for the whole file (400), not create orphan units.
   Test in Task 6.

---

### Task 1: Core pricing and property types

**Files:**
- Create: `packages/core/src/portfolio.ts`
- Modify: `packages/core/src/index.ts` (export it), `packages/core/src/state/unit.ts`
- Test: `packages/core/test/portfolio.test.ts`, `packages/core/test/state.test.ts`

**Interfaces:**
- Produces:
  - `PropertyCategory = z.enum(["residential","commercial","retail"])`
  - `PropertySubtype = z.enum(["apartment","villa","townhouse","penthouse","office","shop","showroom","warehouse"])`
  - `SUBTYPES_BY_CATEGORY: Record<PropertyCategory, PropertySubtype[]>` (residential: apartment,
    villa, townhouse, penthouse; commercial: office, warehouse; retail: shop, showroom)
  - `propertyUsageFor(c: PropertyCategory): "residential" | "commercial"` (retail → commercial;
    used for Ejari, contract and rulebook own-use lock)
  - `RentRuleBounds = { minPctBp: number; maxPctBp: number; minRentFils: number | null; maxRentFils: number | null }`
  - `SriBasis = { avgAnnualRentFils: number | null; avgAnnualRentPerSqftFils: number | null; label: string }`
  - `PriceRange = { min: number; max: number; basis: { sriFils: number | null; bandMin: number | null; bandMax: number | null; aedMin: number | null; aedMax: number | null } }`
  - `allowedAskingRange(unit: { category: PropertyCategory; areaSqft: number | null }, sri: SriBasis | null, rule: RentRuleBounds | null): PriceRange | null`
  - `askingRentWithinRange(unit: { askingRentFils: number | null }, range: PriceRange | null): boolean` (moves here from `state/unit.ts`)
  - `ContractRuleLimits = { minCheques: number; maxCheques: number }` and
    `applyContractRule(policy: CompanyPolicy, rule: ContractRuleLimits | null): CompanyPolicy`
  - `UnitGuardContext` loses `policy`, gains `priceRange: PriceRange | null`; `UnitSnapshot`
    gains `category: PropertyCategory`.

- [ ] **Step 1: Write failing tests** in `portfolio.test.ts`:
  - `residential band`: sri 100_000_00 fils, rule −500/+1000 bp, no AED → `{min: 9_500_000, max: 11_000_000}`.
  - `band intersected with AED bounds`: same + `maxRentFils: 10_500_000` → max 10_500_000.
  - `rounds toward the narrower range`: sri 3_333_333, −333/+333 bp → min = ceil, max = floor.
  - `no SRI → AED bounds only`; `no SRI and no AED → null`; `rule null → null`.
  - `empty intersection → null` (band 9.5–11.0M, AED min 12M).
  - `commercial uses per-sqft × area`: per-sqft 12_000 fils, area 1_000, 0/+1000 bp → 12_000_000–13_200_000.
  - `commercial without area → AED bounds only`.
  - `askingRentWithinRange` true at both edges, false outside, false for null rent or null range.
  - `applyContractRule` overrides `minCheques`/`maxCheques` and clamps `offerDefaultCheques` into
    them; `null` rule returns the policy unchanged.
  - `propertyUsageFor("retail") === "commercial"`.
- [ ] **Step 2: Update `state.test.ts`**: the guard factory uses `priceRange` instead of
  `policy`; add `commercial unit without bedrooms passes the checklist` and
  `residential unit without bedrooms fails it`.
- [ ] **Step 3: Run** `bun test packages/core` → new tests FAIL (missing exports).
- [ ] **Step 4: Implement** `portfolio.ts`; in `state/unit.ts` drop `bedrooms` from the
  checklist when `category !== "residential"`, replace the policy range check in `readyGuard`
  with `askingRentWithinRange(unit, ctx.priceRange)`. Rounding: `min = ceil(sri*(10000+minBp)/10000)`,
  `max = floor(sri*(10000+maxBp)/10000)` using integer maths (`BigInt` not needed below 2^53).
- [ ] **Step 5: Run** `bun test packages/core` → PASS. `bun run typecheck` will fail in the
  engine until Task 3; that's expected.

### Task 2: Schema and migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0018_*.sql` (generated, then hand-edited)
- Test: `apps/engine/test/units.test.ts` (migration runs in `freshDatabase()`)

**Interfaces:**
- Produces tables/columns (Drizzle names in camelCase):
  - `companies`: `id, name, slug (unique), kind ("developer"|"realty"|"owner"), tradeLicenceNo, email, active (default true), createdBy, createdAt, updatedAt`
  - `units`: `companyId uuid not null → companies.id`, `category` (replaces `kind`, type
    `PropertyCategory`, default `residential`), `subtype` (nullable `PropertySubtype`),
    `emirate text not null default 'dubai'`, `country text not null default 'AE'`; index on `companyId`.
  - `sriAverages`: add `category` (not null, default `residential`), `bedrooms` nullable, add
    `avgAnnualRentPerSqftFils` nullable, `avgAnnualRentFils` nullable; check constraint: exactly
    one of the two rent columns is set; unique `(community, category, bedrooms, effectiveFrom)`
    with `NULLS NOT DISTINCT`.
  - `rentRules`: `id, companyId, category, subtype?, emirate, community?, minPctBp int, maxPctBp int, minRentFils?, maxRentFils?, active bool, supersedesId?, createdBy, createdAt`; check `minPctBp <= maxPctBp`; index `(companyId, category, active)`.
  - `contractRules`: `id, companyId, category, subtype?, tenures text[] (values "annual"|"short_term"), minCheques smallint, maxCheques smallint, clauseIds text[] default '{}', sampleDocumentId uuid?, active, supersedesId?, createdBy, createdAt`; check `1 <= minCheques <= maxCheques <= 12`.

- [ ] **Step 1:** Edit `schema.ts`, then run `bun run --cwd packages/db generate`.
- [ ] **Step 2:** Hand-edit the generated SQL so it works on a populated database, in this order:
  create `companies`; `INSERT` a row `('Default company','default','owner')` **only if** `units`
  has rows; add `company_id` nullable, `UPDATE units SET company_id = <default>`, then
  `SET NOT NULL`; `ALTER TABLE units RENAME COLUMN kind TO category`; add the other columns.
  Make sure the rename is a rename, not drop + add.
- [ ] **Step 3:** Run `bun run db:migrate` on the dev database and `bun test apps/engine/test/units.test.ts`
  → the migration applies; tests fail to compile on `kind` (fixed in Task 3).

### Task 3: Engine pricing and unit changes

**Files:**
- Create: `apps/engine/src/manager/pricing.ts`
- Modify: `apps/engine/src/manager/units.ts`, `advance.ts` (unit guard, line ~139),
  `availability.ts`, `sri.ts`, `gate-rules.ts` (`PriceProposal`), `contracts.ts`
  (`kind: unit.kind` → `propertyUsageFor(unit.category)`), every other `units.kind` reader
  (`grep -rn "units.kind\|unit.kind\|u.kind"`)
- Test: `apps/engine/test/pricing.test.ts` (new, DB), `apps/engine/test/units.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; Task 2 tables.
- Produces (in `pricing.ts`):
  - `findRentRule(tx: Tx, unit: UnitRow): Promise<RentRuleRow | null>`: active rules for
    `unit.companyId` + `unit.category` + `unit.emirate`; keep rules whose `subtype` is null or
    equal and whose `community` is null or equal; rank by `community` set (2) + `subtype` set
    (1), then `createdAt desc, id desc`.
  - `findSri(tx: Tx, unit: UnitRow, today: CalendarDate): Promise<SriBasis & { id: string } | null>`:
    latest row `effectiveFrom <= today` for `community`, `category`, and `bedrooms` (residential)
    or `bedrooms IS NULL` (others).
  - `priceRangeFor(tx: Tx, unit: UnitRow, today: CalendarDate): Promise<{ range: PriceRange | null; ruleId: string | null; sriId: string | null; sriLabel: string | null }>`
  - `offerPolicyFor(tx: Tx, unit: UnitRow, today: CalendarDate): Promise<CompanyPolicy>`:
    `applyContractRule(policy, matching active contract rule)`; same matching as rent rules
    without community.
- `PriceProposal` becomes: `unitId, unitCode, category, bedrooms (nullable), askingRentFils,
  rangeMinFils?, rangeMaxFils?, ruleId?, sriId?, policyVersion?`. Old pending rows must still
  parse: make the new fields `.optional()`, `category` `.default("residential")`.

- [ ] **Step 1: Write failing tests** in `pricing.test.ts` (use the harness's `freshDatabase`
  and insert rows directly):
  - picks the community rule over the subtype rule over the category rule;
  - newest of two equal rules wins;
  - ignores inactive rules and rules of another company;
  - residential SRI matched by bedrooms; commercial SRI matched with `bedrooms IS NULL`;
  - `offerPolicyFor` returns the contract rule's cheque range.
- [ ] **Step 2: Add to `units.test.ts`:**
  - `MARK_READY` allowed when the rent sits in the rule band, refused (reason "asking rent
    outside company range and not approved") without a rule;
  - `requestPriceApproval` proposal carries `ruleId`, `sriId` and the band; reason text names
    the band, e.g. `AED 120,000 a year is outside the allowed range AED 95,000 to AED 110,000
    (rent rule for Silverline Properties, residential, SRI Dubai Marina 1-bed).`;
  - updating `companyId`, `category`, `subtype` or `community` on a LISTED unit to a value whose
    band excludes the rent is refused; a pending price approval is cancelled when any of them changes.
- [ ] **Step 3: Run** `bun test apps/engine/test/pricing.test.ts apps/engine/test/units.test.ts` → FAIL.
- [ ] **Step 4: Implement:** `pricing.ts`; in `units.ts` treat `companyId | category | subtype |
  community | emirate | areaSqft | askingRentFils | bedrooms` as `priceInputsChanged` (replaces
  `rentChanged`); `unitActions` returns `priceRange` from `priceRangeFor` plus `priceBasis`
  (`ruleId`, `sriLabel`); `advanceUnit` passes `priceRange`; `availability.priceSettled` becomes
  `async (tx, u, today)`; `listedUnits` filters `category = 'residential'` (the chat stays
  residential until slice 3); `lookupSri` (renewals) filters `category = 'residential'`.
  `UnitFields`: replace `kind` with `category`, add `companyId: z.string().uuid()`,
  `subtype: PropertySubtype.nullable()` (must be in `SUBTYPES_BY_CATEGORY[category]`, refine),
  `emirate: z.literal("dubai").default("dubai")`. `IDENTITY_FIELDS`: `kind` → `category`.
- [ ] **Step 5:** Add `POST /api/units/price-range` (any staff) in `api/units.ts`: body
  `{ companyId, category, subtype, community, bedrooms, areaSqft }` → `{ range, sriLabel }`, for
  the unit form preview.
- [ ] **Step 6: Run** `bun test apps/engine` and `bun run typecheck` → PASS (web may still fail
  on `kind`; fixed in Task 7).

### Task 4: Offer limits from contract rules

**Files:**
- Modify: `apps/engine/src/manager/applications.ts` (`unitAndPolicy`), `advance.ts` (~line 200, `offerProblems` call)
- Test: `apps/engine/test/applications.test.ts`

**Interfaces:** Consumes `offerPolicyFor` (Task 3).

- [ ] **Step 1: Failing test:** with a contract rule `minCheques 1, maxCheques 2` for the unit's
  company, the first offer proposes 2 cheques, and a counter for 4 cheques creates an
  `offer_out_of_limits` approval whose reason says `4 cheques is outside the allowed 1–2.`
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** `unitAndPolicy` returns `policy: await offerPolicyFor(tx, unit, today)`; the
  `OFFER_REVISED` check in `advance.ts` uses the same.
- [ ] **Step 4: Run** `bun test apps/engine/test/applications.test.ts` → PASS.

### Task 5: Portfolio API (companies, rent rules, contract rules)

**Files:**
- Create: `apps/engine/src/api/portfolio.ts`, `apps/engine/src/manager/portfolio.ts`
- Modify: `apps/engine/src/api/app.ts` (register routes)
- Test: `apps/engine/test/portfolio-api.test.ts`

**Interfaces:**
- Routes (under `/api`, `requireRole(user, ["admin"])` on writes):
  - `GET /companies` → `{ id, name, slug, kind, active, unitCount }[]`
  - `POST /companies`, `PATCH /companies/:id` (name, kind, tradeLicenceNo, email, active; slug
    is set on create from the name, `^[a-z0-9-]{2,40}$`, unique → 409 `slug_taken`)
  - `GET /rent-rules?companyId&category` (active only unless `history=1`)
  - `POST /rent-rules` → new row; `PUT /rent-rules/:id` → inserts a replacement with
    `supersedesId`, deactivates the old one in one transaction; `DELETE /rent-rules/:id` → deactivate
  - same three verbs for `/contract-rules` (`clauseIds` must be valid `ContractClauseId`s for now)
  - `GET /sri` gains `category` and `avgAnnualRentPerSqftFils` in its rows
- Zod: `RentRuleInput` (bp in −5000…+5000, `minRentFils <= maxRentFils` when both set, at least
  one of band or AED bounds meaningful), `ContractRuleInput` (cheques 1–12, `tenures` non-empty).

- [ ] **Step 1: Failing tests:** officer gets 403 on every write; admin creates a company and a
  rule; `PUT` leaves exactly one active row and the old row has `active=false`; invalid bp
  (min > max) is 422; duplicate slug is 409.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** `bun test apps/engine/test/portfolio-api.test.ts` → PASS.

### Task 6: Company-aware import

**Files:**
- Modify: `apps/engine/src/import/unit-row.ts`, `apps/engine/src/import/lease-row.ts`,
  `apps/engine/src/manager/import.ts`, `apps/engine/src/api/app.ts` (`importRoute`), `docs/import.md`
- Test: `apps/engine/test/api.test.ts` (import cases)

**Interfaces:** `importUnitsCsv(ctx, csv, actor, companyId: string)` and
`importLeasesCsv(ctx, csv, actor, companyId: string)`; routes read `?company=<slug>`.

- [ ] **Step 1: Failing tests:** no `company` → 400 `company_required`; unknown slug → 404;
  units import with `category=retail,subtype=shop` stores both and the company; `subtype=villa`
  with `category=commercial` is a row error `subtype villa isn't a commercial type`; the old
  `kind` column is still accepted as an alias for `category`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement; existing units matched by code keep their
  company (a different company in the request is a row error `unit belongs to another company`).
- [ ] **Step 4: Run** → PASS. Update `docs/import.md` (columns `category`, `subtype`, `emirate`;
  the company comes from the import screen).

### Task 7: Demo seed around companies

**Files:**
- Modify: `packages/core/src/demo-units.ts`, `apps/engine/src/demo/seed.ts`,
  `apps/ejari-mock/src/db.ts` (only if `DEMO_PROPERTIES` shape changes)
- Test: `apps/engine/test/demo-seed.test.ts`

**Interfaces:**
- Produces in `demo-units.ts`:
  - `DEMO_COMPANIES: { slug: string; name: string; kind: "developer"|"realty"|"owner" }[]`:
    `silverline` "Silverline Properties" (developer), `qamar-realty` "Qamar Realty" (realty),
    `al-noor-holdings` "Al Noor Family Holdings" (owner).
  - `DemoListedUnit` gains `company: string` (slug), `category`, `subtype`; `bedrooms` becomes
    `number | null`.
  - `DEMO_LISTED_UNITS`: replaced with 14 units over Dubai Marina, Jumeirah Village Circle,
    Business Bay, Arabian Ranches and Al Barsha: 8 residential (5 apartments, 2 villas,
    1 townhouse), 3 commercial offices (Business Bay), 3 retail shops (Al Barsha, Dubai Marina).
    Every unit's rent sits inside its company band.
  - `DEMO_SRI`: rows for every community × category (and bedrooms for residential) used above.
  - `DEMO_RENT_RULES`: per company, one category rule per category it holds (for example
    Silverline residential −500/+1000 bp; Qamar retail 0/+1500 bp with AED floor), plus one
    community rule (Silverline, Dubai Marina, −300/+800 bp) so specificity shows in the demo.
  - `DEMO_CONTRACT_RULES`: one per company (residential 1–4 cheques; commercial/retail 1–2; tenures `["annual"]`).
- The 7 lease/prep units (MRN-1204 … MRN-1502, JVC-0412) stay (other tests rely on them), are
  assigned to `silverline` and `al-noor-holdings`, and stay in `DEMO_PROPERTIES`.

- [ ] **Step 1: Update `demo-seed.test.ts`:** companies seeded; every unit has a company; every
  LISTED unit's rent is inside `priceRangeFor(...)` (not `askingRentRangeFils`); the registry
  test still finds every unit; at least one commercial and one retail unit are LISTED.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** Rebuild the seed: insert companies, SRI, rules, then import leases with the
  company, then walk the listed units to LISTED through the Manager as today.
- [ ] **Step 4: Run** `bun test apps/engine/test/demo-seed.test.ts` → PASS, then
  `DEMO_MODE=true bun run demo:reset` on the dev DB and check the output has no `error` rows.

### Task 8: Settings screen and unit form

**Files:**
- Create: `apps/web/app/(staff)/settings/layout.tsx` (tab bar), `settings/page.tsx` (redirects
  to `companies`), `settings/companies/{page.tsx,actions.ts,company-form.tsx}`,
  `settings/rent-rules/{page.tsx,actions.ts,rule-form.tsx}`,
  `settings/contracts/{page.tsx,actions.ts,rule-form.tsx}`, `apps/web/components/settings-tabs.tsx`
- Modify: `apps/web/components/nav.tsx` (add "Settings"; keep the rest until slice 2),
  `apps/web/components/unit-form.tsx`, `units/new/page.tsx`, `units/[id]/edit/page.tsx`,
  `units/[id]/page.tsx`, `units/page.tsx` (company/category filters), `apps/web/lib/types.ts`,
  `apps/web/app/globals.css` (tab bar, rule rows), `rules/page.tsx`, `sri/page.tsx`,
  `import/page.tsx` + `import-form.tsx`, `demo/page.tsx` (render `SettingsTabs` on top)

**Interfaces:** Consumes the Task 5 routes and `POST /api/units/price-range`.

Layout and copy:
- Tabs: **Companies · Rent rules · Contracts · Rent index · Rulebook · Import · Demo** (Demo only in
  demo mode). Rent index, Rulebook, Import and Demo link to the existing routes, which show the
  same tab bar; the routes move in slice 2.
- Rent rules: category segmented control (Residential / Commercial / Retail) as in the sketch;
  one row per rule: company, type (subtype or "All types"), area (community or "All areas"),
  "SRI −5% to +10%", "AED 80,000 to 140,000" or "No AED limits", Edit / Remove. "Add rule" opens
  an inline form (labels above inputs, errors below). Percent inputs take whole or one-decimal
  percents; convert to bp in the action.
- Contracts: same shape; columns type, tenure, cheques "1 to 4"; no upload yet (slice 3).
- Companies: name, kind, units count, active toggle; "Add company".
- Unit form: Company select (required), Category segmented control, Type select filtered by
  category, bedrooms hidden for commercial/retail; below the rent input a live line
  "Allowed: AED 95,000 to AED 110,000 (Silverline residential rule, SRI Dubai Marina 1-bed)" or
  "No rule covers this unit yet. Setting a price will need a manager's approval."
- Import: company select above the file input; sends `?company=`.

- [ ] **Step 1:** Build pages and forms; `bun run typecheck` → PASS.
- [ ] **Step 2:** `bun run lint` → PASS.
- [ ] **Step 3:** Use the `run` skill to start the app; as `admin@demo.example` add a rent rule,
  edit it (old row disappears from the list), create a unit, see the live range line; as the
  officer the Settings writes are hidden or refused. Check light and dark.

### Task 9: Docs, compliance review, full verification

**Files:** `docs/decisions.md` (D32: companies, category/subtype, rent bands vs SRI, contract
rules for cheque limits, rules immutable and superseded; `askingRentRangeFils` kept in the
policy schema but unused, marked deprecated), `docs/architecture.md` §3 Unit + §4 + §10,
`.claude/skills/dubai-leasing/` (pricing section), `docs/roadmap.md` (new "Phase 7 – Contract
AI" with slice 1 ticked), `AGENTS.md` repo map line for `packages/core` unchanged.

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run the `compliance-reviewer` subagent on the diff (pricing gate, offer limits,
  Ejari usage mapping for retail) and fix what it finds.
- [ ] **Step 3:** `bun run typecheck && bun run lint && bun test` → all PASS (not while a
  copilot eval is running: shared test DB).
- [ ] **Step 4:** Report to the user, including that no model tags or pinned versions changed.
