# C39 — Deal record sections (S71)

Approved with the recommended answers. No schema change, no migration, no new facts, no writes, no event.

## Engine (`modules/spa/apps/engine`)
- `RecordSection` gains `visibleTo?(role)` and `steps?: StepKey[]`. `getDealRecord` loads a section only if
  `appliesTo(deal)` (the step is in `stepsFor`), the deal has reached it (step status is not `upcoming`) and
  `visibleTo(role)`. A role that may not read a section never gets the key.
- Role-free views, wrapped by the existing routes (which keep their role checks): `amlCasesView`, `signingView`,
  `registrationsView`, `settlementView` (adds `balancesToZero`), `nocStatusView`, `paymentsView`, `agreementView`,
  `documentsView` (kind, masked party, uploaded date, read state; never file name, key, hash, mime or size).
- Sections: `documents` (all roles), `aml` (compliance_officer, mlro), `agreement`, `signing`, `noc`, `finance`,
  `settlement` (resale), `registration` (Oqood register / transfer). Roles follow each existing read route.
- Money in fils, dates Asia/Dubai, text masked again on output.

## Web (`modules/spa/apps/web`)
- `readSections` parses the new keys (absent stays absent); `DealRecord` renders them in design order, read only.
- New page `/compliance/deals/[id]` reuses `DealRecord` with the viewer's role (compliance roles); the case view links to it.

## Tests (each seen failing first)
Role matrix (8 roles x every key), AML word scan for non-compliance roles, planted ID/passport/phone masking, no file
fields in documents, section only when step applies and is reached, record load writes nothing, web components render
through the real engine per role, web source scan (no write route, no clock, no leasing word).

## Docs
task.md line 138, S71 in decisions.md, architecture.md section list, roadmap range S1–S71, compliance-reviewer on the diff.
