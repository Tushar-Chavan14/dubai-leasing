# Importing existing leases (CSV)

Staff app → **Import**, or `POST /api/import/leases?company=<slug>` (admin or leasing
manager) with a CSV body or `{"csv": "..."}`. The company (slug) is required: a missing
`company` is 400 `company_required`, an unknown or inactive one is 404. A unit code that
belongs to another company is a row error (`unit belongs to another company`). One row per
lease, header row required. Each row is imported in its own transaction; re-importing the
same file skips rows already present (same unit and start date).

| Column | Required | Notes |
|---|---|---|
| `unit_code` | yes | Staff code, e.g. `MRN-1204`. Existing units are matched by code; empty fields are filled, never overwritten |
| `building`, `community`, `unit_no` | yes | |
| `dld_property_no`, `makani_no`, `dewa_premise_no` | no | Needed later for the unit checklist and Ejari |
| `bedrooms` | yes | 0 = studio |
| `area_sqft` | no | |
| `furnished` | yes | yes/no |
| `landlord_name`, `landlord_email` | no | Ignored since D44: the unit's company is the landlord |
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

Staff app → **Import** → **Units** (or **Import units** on the Units list), or `POST
/api/import/units?company=<slug>` (admin or leasing manager) with a CSV body or `{"csv":
"..."}`. The company (slug) is required: a missing `company` is 400 `company_required`, an
unknown or inactive one is 404. Units are created under that company, and a code that
already belongs to another company is a row error (`unit belongs to another company`; the
same applies to the lease import). One row per unit, header row required. A sample file is
at `apps/web/public/samples/units-sample.csv` (served as `/samples/units-sample.csv`).

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
| `category` | no | `residential` (default), `commercial` or `retail`. `kind` is accepted as an alias; if both are present and differ, the row is an error |
| `subtype` | no | Must fit the category: residential `apartment`, `villa`, `townhouse`, `penthouse`; commercial `office`, `warehouse`; retail `shop`, `showroom`. Otherwise `subtype X isn't a <category> type` |
| `emirate` | no | Only `dubai` for now (default); anything else is a row error |
| `dld_property_no`, `makani_no`, `plot_no`, `dewa_premise_no` | no | Makani has 10 digits (spaces ignored). Needed later for the unit checklist |
| `bedrooms`, `bathrooms`, `parking_spaces` | no | whole numbers 0–10; 0 bedrooms = studio |
| `area_sqft` | no | 50–100,000 |
| `floor` | no | −5 to 200 |
| `furnished` | no | yes/no |
| `asking_rent_aed` | no | annual, e.g. `85000`, `"85,000"` or `AED 85,000`; price approval happens on the unit as usual |
| `description` | no | listing text |
| `virtual_tour_url` | no | must start with `https://` |
| `company` | yes (or `?company=`) | Name or slug of the company that owns the unit and is its landlord. Unknown or inactive company is a row error. The upload's `?company=` is the default for rows without one |

Imported units start in Preparation. Add photos and a virtual tour link from each unit's edit
page (`/units/{id}/edit`), complete the checklist and get the price approved before listing.

The web upload goes through the route handler `apps/web/app/api/import/[kind]/route.ts`, not a
server action, so files over the 1 MB server-action body limit work; the engine accepts up to
2 MB per request.

# Importing companies (CSV)

Staff app → **Import** → **Companies**, or `POST /api/import/companies` (**admin only**) with a CSV
body or `{"csv": "..."}`. No `?company=` is used. A sample file is at
`apps/web/public/samples/companies-sample.csv`. The company is the landlord (D44), so this loads
landlord details in bulk. Rows are matched by `slug`, else by name (case-insensitive):

- **New company**: created with its party row (`COMPANY_CREATED`); `kind` is required.
- **Existing company**: only the legal fields the row provides are changed, an empty cell never
  erases a saved value; `name`, `slug` and `kind` of an existing company are not changed. No
  change is a `skipped` row.
- The legal record is saved whole through the same audited update as the Companies form
  (`COMPANY_LEGAL_UPDATED`, field names only). A row that gives any legal field must leave the
  merged record complete (legal name, licence number, authority, expiry, address, email,
  signatory name, title, email, ID number), otherwise the row is an error and nothing is saved
  for it. Expiry dates must be in the future.
- Error messages name columns, never values; ID numbers never reach messages, logs or events.

| Column | Notes |
|---|---|
| `name` | required |
| `slug` | optional; letters, digits, dashes; default is made from the name |
| `kind` | `developer`, `realty` or `owner`; required for a new company |
| `categories` | `residential`, `commercial`, `retail` separated by `;` or `,`. Validated, not stored (companies have no category column) |
| `legal_name_en`, `legal_name_ar`, `trade_licence_no`, `licence_authority`, `trade_licence_expires_on`, `rera_orn` | legal details; expiry `YYYY-MM-DD` |
| `registered_address`, `email`, `phone`, `cheque_payee` | |
| `signatory_name`, `signatory_title`, `signatory_email`, `signatory_id_no`, `signatory_id_expires_on` | ID is an Emirates ID (`784-YYYY-NNNNNNN-C`) or, if not of that shape, a passport number |

There is no preview step in the import framework; each row commits on its own.

## Filling legal details on a demo database

`bun run demo:fill-legal` (`DEMO_MODE=true` only) fills the missing legal fields of every company
with fictional values (the demo set for the seeded slugs, derived from the name otherwise),
through the audited update as actor `system:demo`. Filled values are never overwritten; a second
run changes nothing. It prints the field names filled per company, never ID numbers.
