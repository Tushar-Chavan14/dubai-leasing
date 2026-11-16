# Emirate values for the generic tenancy contract (D74)

Defaults the generic template's placeholders take per emirate. Drafted 2026-11-16 from public summaries (law-firm and
press articles, not official portals). **Confirm every row with legal before real use.** Admins can change the
wording per emirate in Settings → Registration; the defaults live in `packages/core/src/registration-settings.ts`
(`DEFAULT_CONTRACT_WORDING`).

## From the lease's pinned rulebook (code)

| Placeholder | Dubai | Abu Dhabi | Sharjah | Ras Al Khaimah | Umm Al Quwain | Ajman | Fujairah |
|---|---|---|---|---|---|---|---|
| `{renewal notice days}` | 90 | 60 | 90 | 90 | 90 | no rulebook | no rulebook |
| `{repossession notice months}` | 12 | 12 | 12 (sources: 3 or 12) | 12 | 12 | no rulebook | no rulebook |
| `{late rent days}` | 30 | 30 | 15 | 30 | 30 | no rulebook | no rulebook |

## From Settings → Registration (contract wording)

| Emirate | `{registration system}` | `{registering authority}` | `{governing law}` | `{dispute body}` | `{utility provider}` | Confidence |
|---|---|---|---|---|---|---|
| Dubai | Ejari | Dubai Land Department (RERA) | Dubai Law No. 26 of 2007 as amended by Law No. 33 of 2008 | the Rental Disputes Centre in Dubai | DEWA | high |
| Abu Dhabi | Tawtheeq | Abu Dhabi Real Estate Centre (ADREC) | Abu Dhabi Law No. 20 of 2006 as amended | the Rental Disputes Settlement Committee of the Abu Dhabi Judicial Department | ADDC (AADC in Al Ain) | medium |
| Sharjah | Sharjah Municipality tenancy contract attestation | Sharjah Municipality | Sharjah Law No. 5 of 2024 on property leasing | the Rental Disputes Centre in Sharjah | SEWA | medium-high |
| Ajman | Tasdeeq | Ajman Municipality and Planning Department | the Ajman leasing law as amended by Emiri Decree No. 8 of 2014 | the Rent Disputes Committee of Ajman Municipality | Etihad Water and Electricity (confirm) | low-medium |
| Ras Al Khaimah | Ras Al Khaimah Municipality tenancy contract attestation | Ras Al Khaimah Municipality | the UAE Civil Transactions Law and the leasing regulations of Ras Al Khaimah (confirm) | the competent tenancy disputes committee or courts in Ras Al Khaimah (confirm) | Etihad Water and Electricity | low |
| Umm Al Quwain | Umm Al Quwain Municipality tenancy contract attestation | Umm Al Quwain Municipality | Umm Al Quwain Law No. 3 of 2008 as amended | the Tenancy Disputes Committee of Umm Al Quwain Municipality | Etihad Water and Electricity | low |
| Fujairah | Ejaar | Fujairah Municipality | Fujairah Law No. 1 of 2011 on leases | the Rent Disputes Committee of Fujairah Municipality | Etihad Water and Electricity | low-medium |

Notes for legal review: Sharjah freezes rent for the first 3 years and limits eviction before 3 years (residential)
or 5 years (commercial) to listed grounds; Abu Dhabi reports a 0% increase from June 2026 (single source); RAK's
current tenancy law is unclear in public sources.

Sources: tamimi.com (registration of tenancy contracts; RAK committee decree), zawya.com (northern emirates
registration), gulfnews.com and alsuwaidi.ae (Sharjah Law 5/2024), propertyfinder.ae (Sharjah, Abu Dhabi),
dubizzle.com (Abu Dhabi tenants' rights), houserent.ae (dispute centres).
