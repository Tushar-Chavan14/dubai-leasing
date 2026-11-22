# Demo rehearsal (docs/specs.md §9)

Run before a pitch. Setup: `bun run dev`, Ollama running with the `.env` models, the simulated
Ejari running, `DEMO_MODE=true`. Start clean with **Demo clock → Reset demo data** (admin, type
RESET), or keep your data and use **Demo clock → Add missing demo leases**. All people and IDs
are fictional. Tick each step; note anything slow or wrong.

| # | Step | Where / what to click | Expect |
|---|---|---|---|
| 1 | Telegram enquiry | Message the bot: "1-bed in Dubai Marina under 90k", give an email, pick a unit, book a slot | Intent tagged on **Enquiries**; units offered at asking rent only; viewing on **Applicants** |
| 2 | KYC | On the applicant: record attended → upload a specimen from `packages/helpers/src/kyc/evals/specimens/` | Fields read; checks shown; verified or a `kyc_review` approval |
| 3 | Offer → contract | Offer link → Accept; record the reservation; **Lease → Prepare contract** → approve in **Approvals** → sign both links | Signed PDF with signature page |
| 4 | Ejari | Optional: **Demo clock → Reject the next Ejari submission** first; approve the submission | Name-typo rejection → one auto-fix → issued (or the review approval) |
| 5 | Move-in | Lease page: tick DEWA / keys / cards, a photo per room → Complete move-in | ACTIVE; instalments and milestones listed |
| 6 | Renewal | **Demo clock → fast-forward** to T−4 months (MRN-1204: 10 then 31 days) → approve the notice → tenant clicks Renew | Notice with the rulebook cap; sent by T−100 |
| 7 | Complaint | Tenant portal → Report an issue: "AC leaking near the socket", tick "anyone at risk" | `safety_complaint` approval with probabilities; acknowledgement email |
| 8 | Move-out | **Demo clock → Tenant gives notice** (JLT-2205) → lease page: photos per room, **Compare with move-in photos**, confirm damage, complete → tenant accepts (deposit link in the demo inbox) → finance **Record refund paid** → fast-forward to the move-out date | Statement emailed; refund recorded; Ejari cancelled; lease CLOSED; unit PREP |
| 9 | Copilot | "Which leases need attention this week?" → "Why is MRN-1204 waiting?" → "Prepare the formal reminder" (after a bounced cheque: **Demo clock → Bounce the next cheque** twice, with fast-forwards) | Answers with links; proposal card → Confirm → pending approval for the manager |
| + | Dispute | Lease page **Dispute case** → Export case pack; copilot "Prepare an RDC case summary for …" | Zip with timeline, documents, photos, manifest; summary draft on the lease |
| + | Metrics | **Metrics** | Five KPIs with their rows |

Known limits: copilot answers take 20–45 s on a 4 GB GPU; the copilot often reads the case pack
without saving the summary (ask again: "save it as a draft").
