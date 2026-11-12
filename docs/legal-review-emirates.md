# Legal review checklist: emirates

A UAE property lawyer works through this before a real client uses an emirate other than Dubai (and
before Dubai goes live). Phase 4 of the multi-emirate work (`docs/roadmap.md`, D52, D55, D56).

**Status of the values.** Non-Dubai rulebook values are demo values. Each source line reads "From the
general data available: ...". Confidence is low to medium. They are seed data
(`apps/engine/src/demo/emirate-rulebooks.ts`), not code versions: a real install stays fail-closed
(409 `no_rulebook`) for these emirates until an admin publishes a reviewed rulebook. Registration
fee rules, registration settings and standard contract wording are in code and ship as they are, so
they need the same review.

**How to apply a confirmed value**

- Rulebook value (law, notice, repossession, lock, late rent, cap, dispute body): publish a new
  rulebook version in Settings. A published version never changes; leases keep the version pinned on them.
- Registration system, portal name and URL, instructions, required documents, reference format:
  edit Settings -> Registration (per emirate, admin, audited). Code defaults live in `packages/core/src/registration-settings.ts`.
- Registration fee rule: change `packages/rulebook/src/fees.ts` (code-versioned schedule with a new
  `effectiveFrom`; add tests).
- Standard contract wording: `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts`.
- Then fill the "Confirmed by" and "Date" columns here and update `docs/architecture.md` if a rule changed.

Cap rule note: demo rulebooks use one flat band (`gapUpTo: 100`) plus the above-band value.

## Dubai

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | dubai-2025-01 (code) | `packages/rulebook/src/dubai/2025-01.ts` | Code; Dubai guide + decrees |  |  |
| Governing law cited | Law 26/2007 as amended by Law 33/2008 (Art. 14, Art. 25); Decree 43/2013; SRI (DLD, Jan 2025) | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 90 | rulebook `renewalNoticeDays` | General data |  |  |
| Company send day (days before end) | 100 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months; by notary or registered mail, handled by a person (never email) | rulebook `repossessionNoticeMonths`; delivery is product rule | General data / assumed |  |  |
| Own-use lock (residential / commercial) | 2 yrs / 3 yrs | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 30 | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | SRI bands: gap up to 10% = 0%, 20% = 5%, 30% = 10%, 40% = 15%, above 40% = 20%. Middle bands: confirm with legal (guide states only the two ends) | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | Ejari (Dubai REST / DLD); flat AED 177.75 | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | Ejari (Dubai REST / DLD), https://dubailand.gov.ae | Settings -> Registration (`portalName`, `portalUrl`) | General data |  |  |
| Required documents | Signed contract, tenant ID, tenant visa, title deed, landlord trade licence | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `SIM-2026-0000123`; `^(SIM-\d{4}-\d{7}\|[A-Za-z0-9-]{4,30})$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under Dubai law." Registration line: "registered in Ejari after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | Rental Disputes Centre (RDC) | rulebook `sources` (text only) | General data |  |  |

## Abu Dhabi

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | abu_dhabi-2026-06 (demo seed) | `apps/engine/src/demo/emirate-rulebooks.ts` | Demo seed |  |  |
| Governing law cited | Law 20/2006 as amended (Laws 6/2009, 4/2010) | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 60 | rulebook `renewalNoticeDays` | General data |  |  |
| Company send day (days before end) | 70 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months (assumed); person-handled, not email | rulebook `repossessionNoticeMonths`; delivery is product rule | General data / assumed |  |  |
| Own-use lock (residential / commercial) | 1 yr / 1 yr (assumed) | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 30 (assumed) | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | 0%: ADREC freeze from 2 Jun 2026 (temporary; ADGM communities excluded) | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | Tawtheeq (TAMM); flat AED 50 | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | Tawtheeq (TAMM), https://www.tamm.abudhabi | Settings -> Registration (`portalName`, `portalUrl`) | General data |  |  |
| Required documents | Signed contract, tenant ID, title deed, landlord trade licence | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `SIM-TWQ-2026-0000123`; `^(SIM-TWQ-\d{4}-\d{7}\|[A-Za-z0-9-]{4,30})$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under the laws of the Emirate of Abu Dhabi." Registration line: "registered in <system name> after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | Not recorded in code | rulebook `sources` (text only) | General data |  |  |

## Sharjah

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | sharjah-2025-01 (demo seed) | `apps/engine/src/demo/emirate-rulebooks.ts` | Demo seed |  |  |
| Governing law cited | Law 5/2024 (landlord and tenant); RDRC under Law 6/2024 | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 90 | rulebook `renewalNoticeDays` | General data |  |  |
| Company send day (days before end) | 100 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months (sources say 3 or 12); person-handled, not email | rulebook `repossessionNoticeMonths`; delivery is product rule | See Known conflicts |  |  |
| Own-use lock (residential / commercial) | 3 yrs / 5 yrs | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 15 | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | 0% (no increase in the first 3 years of a tenancy) | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | Sharjah Municipality attestation (manual); 4% of rent, min AED 500, plus AED 100 | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | Sharjah Municipality attestation (Smart Services / Tasheel), https://www.shjmun.gov.ae (unverified) | Settings -> Registration (`portalName`, `portalUrl`) | Unverified |  |  |
| Required documents | Signed contract, tenant ID, landlord trade licence, title deed, previous registration cancelled | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `ATT-2026-123456`; `^[A-Za-z0-9/-]{4,30}$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under the laws of the Emirate of Sharjah." Registration line: "registered in <system name> after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | RDRC (Law 6/2024) | rulebook `sources` (text only) | General data |  |  |

## Ajman

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | ajman-2025-01 (demo seed) | `apps/engine/src/demo/emirate-rulebooks.ts` | Demo seed |  |  |
| Governing law cited | Law 3/2009 | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 90 (assumed) | rulebook `renewalNoticeDays` | Assumed |  |  |
| Company send day (days before end) | 100 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months (assumed); person-handled, not email | rulebook `repossessionNoticeMonths`; delivery is product rule | General data / assumed |  |  |
| Own-use lock (residential / commercial) | 2 yrs / 2 yrs (assumed) | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 30 (assumed) | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | 0% (old rule: no rise before 3 years) | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | Tasdeeq (manual); 2% of rent, min AED 400 | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | Tasdeeq (Ajman Municipality & Planning Department), no URL | Settings -> Registration (`portalName`, `portalUrl`) | Unverified |  |  |
| Required documents | Signed contract, tenant ID, landlord trade licence, title deed, previous registration cancelled | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `TSD-2026-123456`; `^[A-Za-z0-9/-]{4,30}$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under the laws of the Emirate of Ajman." Registration line: "registered in <system name> after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | Not recorded in code | rulebook `sources` (text only) | General data |  |  |

## Ras Al Khaimah

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | ras_al_khaimah-2025-01 (demo seed) | `apps/engine/src/demo/emirate-rulebooks.ts` | Demo seed |  |  |
| Governing law cited | Amiri Decree 1/2008 (low confidence) | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 90 (assumed) | rulebook `renewalNoticeDays` | Assumed |  |  |
| Company send day (days before end) | 100 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months (low confidence); person-handled, not email | rulebook `repossessionNoticeMonths`; delivery is product rule | General data / assumed |  |  |
| Own-use lock (residential / commercial) | 2 yrs / 2 yrs (assumed) | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 30 (assumed) | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | 5% residential (low confidence) | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | RAK Municipality (manual); AED 25 + 5% of rent (medium confidence) | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | RAK Municipality tenancy registration, https://www.rak.ae (unverified) | Settings -> Registration (`portalName`, `portalUrl`) | Unverified |  |  |
| Required documents | Signed contract, tenant ID, landlord trade licence, title deed, previous registration cancelled | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `RAK-2026-123456`; `^[A-Za-z0-9/-]{4,30}$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under the laws of the Emirate of Ras Al Khaimah." Registration line: "registered in <system name> after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | Not recorded in code | rulebook `sources` (text only) | General data |  |  |

## Fujairah

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | fujairah-2025-01 (demo seed) | `apps/engine/src/demo/emirate-rulebooks.ts` | Demo seed |  |  |
| Governing law cited | No law cited in the rulebook (no primary text found) | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 90 (assumed) | rulebook `renewalNoticeDays` | Assumed |  |  |
| Company send day (days before end) | 100 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months (assumed); person-handled, not email | rulebook `repossessionNoticeMonths`; delivery is product rule | General data / assumed |  |  |
| Own-use lock (residential / commercial) | 2 yrs / 2 yrs (assumed) | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 30 (assumed) | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | 5% a year (low confidence) | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | Ejaar (manual); AED 300 if rent < AED 15,000, else 2% | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | Ejaar (Fujairah Municipality), https://www.fujmun.gov.ae (unverified) | Settings -> Registration (`portalName`, `portalUrl`) | Unverified |  |  |
| Required documents | Signed contract, tenant ID, title deed, landlord trade licence | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `EJR-2026-123456`; `^[A-Za-z0-9/-]{4,30}$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under the laws of the Emirate of Fujairah." Registration line: "registered in <system name> after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | Not recorded in code | rulebook `sources` (text only) | General data |  |  |

## Umm Al Quwain

| Item | Current value | Where it lives | Source / confidence | Confirmed by | Date |
|---|---|---|---|---|---|
| Rulebook version | umm_al_quwain-2025-01 (demo seed) | `apps/engine/src/demo/emirate-rulebooks.ts` | Demo seed |  |  |
| Governing law cited | Law 3/2008 as amended by Law 2/2011 | rulebook `sources` | General data; verify against the gazette |  |  |
| Rent-change notice (days) | 90 (from 3 months' notice) | rulebook `renewalNoticeDays` | General data |  |  |
| Company send day (days before end) | 100 | rulebook `renewalSendAtDays` | Notice + 10 days (product choice) |  |  |
| Repossession notice + delivery | 12 months (assumed); person-handled, not email | rulebook `repossessionNoticeMonths`; delivery is product rule | General data / assumed |  |  |
| Own-use lock (residential / commercial) | 2 yrs / 2 yrs (assumed) | rulebook `ownUseLockYears` | General data / assumed |  |  |
| Late rent days after formal reminder | 30 (assumed) | rulebook `lateRentDaysAfterFormalReminder` | General data / assumed |  |  |
| Rent cap | 10% a year with 3 months' notice | rulebook `rentCapBands`, `aboveLastBandMaxIncrease` | Low to medium |  |  |
| Registration system + fee rule | UAQ Municipality, in person (manual); 2% of rent plus AED 40 | `packages/rulebook/src/fees.ts`; mode in registration settings | Low to medium (fee: general data) |  |  |
| Portal name + URL | UAQ Municipality tenancy registration, no URL | Settings -> Registration (`portalName`, `portalUrl`) | Unverified |  |  |
| Required documents | Signed contract, tenant ID, landlord trade licence, title deed, previous registration cancelled | Settings -> Registration (`requiredDocuments`) | General data |  |  |
| Reference format (example; pattern) | `UAQ-2026-1234`; `^[A-Za-z0-9/-]{3,30}$` | Settings -> Registration (`referenceExample`, `referencePattern`) | Invented shape, not a government format |  |  |
| Standard contract wording (law line; registration line) | Law line: "...under the laws of the Emirate of Umm Al Quwain." Registration line: "registered in <system name> after both parties sign." | `requiredTerms(emirate)` in `packages/helpers/src/contract/template.ts` | Product wording; lawyer to approve |  |  |
| Dispute body | Not recorded in code | rulebook `sources` (text only) | General data |  |  |

## Known conflicts

- **Sharjah repossession notice:** sources say 3 months or 12 months; 12 used. Pick the right one for Law 5/2024.
- **Abu Dhabi rent freeze:** the 0% cap (ADREC, from 2 Jun 2026) is temporary and ADGM communities are excluded. Decide what the cap becomes when it ends and how ADGM units are handled.
- **Ajman cap:** "no rise before 3 years" is the old rule (Law 3/2009); check whether a newer rule applies.
- **RAK registration fee:** AED 25 + 5% of annual rent (medium confidence) versus an earlier figure of 2%.
- **Fujairah law:** Law 1/2007 versus Law 1/2011; no law is cited in the rulebook until this is settled.
- **Portal URLs unverified:** Sharjah, RAK and Fujairah URLs are guesses at the municipal home pages.
- **No portal URL:** Ajman (Tasdeeq) and Umm Al Quwain have none.
- **Dubai middle bands:** the 5%, 10% and 15% bands follow Decree 43/2013; the guide states only 0% and 20%.
- **Assumed values:** every "assumed" cell above has no source at all; treat it as an open question.
