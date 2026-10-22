# Importing existing leases (CSV)

Staff app → **Import**, or `POST /api/import/leases` (admin or leasing manager) with a CSV body
or `{"csv": "..."}`. One row per lease, header row required. Each row is imported in its own
transaction; re-importing the same file skips rows already present (same unit and start date).

| Column | Required | Notes |
|---|---|---|
| `unit_code` | yes | Staff code, e.g. `MRN-1204`. Existing units are matched by code; empty fields are filled, never overwritten |
| `building`, `community`, `unit_no` | yes | |
| `dld_property_no`, `makani_no`, `dewa_premise_no` | no | Needed later for the unit checklist and Ejari |
| `bedrooms` | yes | 0 = studio |
| `area_sqft` | no | |
| `furnished` | yes | yes/no |
| `landlord_name`, `landlord_email` | name yes | |
| `tenant_name` | yes | English name exactly as on the ID |
| `tenant_email`, `tenant_phone`, `tenant_nationality` | no | |
| `tenant_emirates_id` | no | `784-YYYY-NNNNNNN-C`, check digit verified |
| `start_on`, `end_on` | yes | `YYYY-MM-DD`, Asia/Dubai calendar dates; end after start |
| `annual_rent_aed`, `deposit_aed` | yes | AED, e.g. `85000` or `85,000.00` (quote values containing commas) |
| `cheques` | yes | 1–12 |
| `ejari_no` | for running leases | |

State on import (from the dates, today in Asia/Dubai):

- ended before today → refused (history import is not supported yet)
- starts after today → `MOVE_IN` with an Ejari number, `REGISTRATION` without
- running → needs an Ejari number; `RENEWAL` from the T−5 months date, else `ACTIVE`

Running leases get their renewal milestones. Milestones already past are recorded as
`skipped`; a lease imported after its T−4 months date but on or before T−90 gets its renewal
notice drafted today. Rows imported after T−90 come back with a warning: no rent increase is
possible for that renewal.

# Importing units (CSV)

Staff app → **Import** → **Units** (or **Import units** on the Units list), or
`POST /api/import/units` (admin or leasing manager) with a CSV body or `{"csv": "..."}`. One row
per unit, header row required. A sample file is at `apps/web/public/samples/units-sample.csv`
(served as `/samples/units-sample.csv`).

Each row runs in its own transaction and goes through the same path as the unit form: the
`UnitFields` rules (code format, 10-digit Makani, ranges), state `PREP`, and a `UNIT_CREATED`
event by the importing user with `source: "import"`. A code that already exists is **skipped**
("unit already exists — edit it in Units"); imported rows never overwrite a unit. Problems are
reported per row by CSV column name; a bad row doesn't block the others.

| Column | Required | Notes |
|---|---|---|
| `unit_code` | yes | e.g. `MRN-1204`: letters, digits and dashes (upper-cased) |
| `building`, `community` | yes | |
| `unit_no` | no | |
| `kind` | no | `residential` (default) or `commercial` |
| `dld_property_no`, `makani_no`, `plot_no`, `dewa_premise_no` | no | Makani has 10 digits (spaces ignored). Needed later for the unit checklist |
| `bedrooms`, `bathrooms`, `parking_spaces` | no | whole numbers 0–10; 0 bedrooms = studio |
| `area_sqft` | no | 50–100,000 |
| `floor` | no | −5 to 200 |
| `furnished` | no | yes/no |
| `asking_rent_aed` | no | annual, e.g. `85000`, `"85,000"` or `AED 85,000`; price approval happens on the unit as usual |
| `description` | no | listing text |
| `virtual_tour_url` | no | must start with `https://` |
| `landlord_name`, `landlord_email` | no | email needs the name. Matched to an existing party by name + email (or name alone), else created |

Imported units start in Preparation. Add photos and a virtual tour link from each unit's edit
page (`/units/{id}/edit`), complete the checklist and get the price approved before listing.

The web upload goes through the route handler `apps/web/app/api/import/[kind]/route.ts`, not a
server action, so files over the 1 MB server-action body limit work; the engine accepts up to
2 MB per request.
