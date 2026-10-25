# Public chat, public listings, more demo units: plan

> Run with superpowers:subagent-driven-development. No commits (user instruction). Spec: the user's request of 2026-10-23 plus `docs/superpowers/specs/2026-10-23-customer-chat-design.md`, which this plan supersedes where they conflict.

**Goal:** `/chat` becomes public and works like the Telegram bot: it asks for an email first, and the email can be changed later. Customer sign-in is removed. Visitors get public property pages with a self-service enquiry form and a floating chat popover. The Ejari mock knows every demo unit, and the demo data gets more units.

## Rulings (controller)

- **P1. Public routes.** The public listing lives at `/properties`, because `/units` is already the staff route. Detail pages are at `/properties/[id]`.
- **P2. Visitor identity.** The web app sets an httpOnly random `leasing_visitor` cookie (UUIDv4, 180 days). The web server relays chat to the engine at `POST /channel/web/updates` with the shared `CHANNEL_SECRET`, exactly like the Telegram bot. The browser never calls the engine directly. Conversation: `channel "web"`, `external_chat_id` = visitor id.
- **P3. Contact first.** As on Telegram: the email is required (Zod) and the phone is optional with Skip. A "Change email" button is always available. Booking asks for the name, as Telegram does.
- **P4. Telegram flow only.** The web chat handles enquiries, viewings and general questions. It shows no lease or application records, takes no document uploads and does no email verification. Uploads happen only through the emailed portal links. The `existing_tenant` intent gets a fixed reply pointing to the "My tenancy" email link (EN and AR), with no handoff.
- **P5. Remove customer accounts.** Drop the `/account/*` pages, the customer session and cookie, and the `/api/customer/*` routes. Also drop the chat records and upload code, the login codes and the demo sign-in-email list. The new migration drops `customer_accounts`, `customer_login_codes` and `conversations.customer_account_id`.
- **P6. Public endpoints.** Every public engine route is secret-gated (called by the web server only) and rate-limited per IP: the web forwards the client IP as on Telegram. The Ruling R19 deployment note still applies.
- **P7. Enquiry form.** Fields: name, email, phone (optional) and a viewing slot from the unit's free slots. It calls `createApplication(..., source "web_form", viewingAt)` with actor `visitor:<visitorId>`, and the invitation email goes out as usual. If the unit is no longer bookable or the slot is taken, it returns a 409 with a clear message. Rent comes from code only.
- **P8. No photos in the seed.** Cards without a photo show a generated placeholder (CSS gradient plus building name). No stock images.
- **P9. Ejari mock.** The registry lists every demo unit the seed creates, including MRN-1502, so registration never fails with PROPERTY_NOT_FOUND for seeded units. The intentional name-case rejection (Lena) stays.
- **P10. Demo reset.** Run at the end, after the user explicitly asked: `bun run demo:reset`. That drops all tables and reseeds, then the Ejari mock is reset through its demo route.

## Tasks

1. **Engine: public web channel (P2–P6).**
   - Relay route and conversations keyed by visitor.
   - Contact-first flow on web, change-email, name at booking.
   - Remove the customer accounts, chat records, chat uploads and login-code code, and add the migration.
   - Update the tests: rewrite web-chat for visitors, delete customer-records, customer-upload, customer-auth and customer-api, and add relay-route tests.
2. **Engine: public listings and enquiry (P6, P7).**
   - `GET /public/units` (bookable only, with card facts and a photo path), `GET /public/units/:id`, `GET /public/units/:id/photos/:photoId`, `GET /public/units/:id/slots`, `POST /public/enquiries`.
   - Tests: bookable filter, rent formatting, slot taken (409), unit gone (409), rate limit, secret required.
3. **Seed and Ejari (P8, P9).**
   - About 6 more fictional listed units across 3–4 communities: studio to 3-bed, mixed furnished, prices inside the company range, with descriptions.
   - Registry rows for every seeded unit number in `apps/ejari-mock/src/db.ts`.
   - Tests: ejari-mock knows every seeded DLD number, and seed or reset produces N listed units.
4. **Web: public site (P1, P2, P8).**
   - Remove `/account/*` and the customer cookie code.
   - Public layout: header with the brand, "Properties" and a "Tenant portal" note, in the style of the reference (large image cards, title, short description, arrow).
   - `/properties` grid and `/properties/[id]` detail with an "Enquire" form and slot picker.
   - A floating chat button on public pages opens the chat in a modal. `/chat` stays as a full-page public chat.
   - Relay server actions set the visitor cookie and forward the IP.
   - Remove the staff `/login` "Customer sign-in" link, or point it to `/properties`.
5. **Docs, review, reset.**
   - D31 (amends D30), AGENTS.md rule 10 wording, architecture §8 and roadmap.
   - Run the compliance-reviewer, the full suite, the final review and `demo:reset`.
   - Browser check of `/properties`, the enquiry, the chat popover and an Ejari registration on a new unit.
