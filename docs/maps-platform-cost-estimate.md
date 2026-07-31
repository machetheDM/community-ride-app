# Google Maps Platform — cost model

Prices in USD, current as of the March 2025 billing change. Verify against
[the pricing page](https://developers.google.com/maps/billing-and-pricing/pricing)
before relying on any figure here for a budget decision.

## The $200 credit no longer exists

Plenty of tutorials — and the brief this work started from — assume a recurring $200/month
Google Maps credit that covers a small app entirely. **That credit was retired on 1 March 2025.**
It was replaced by a free monthly allowance attached to each individual SKU, and those allowances
**do not pool**: 10,000 unused Geocoding calls cannot subsidise Routes usage.

This is mostly good news at our volume, because two of the SKUs we depend on most are now free at
*any* volume.

| SKU | Free / month | Price after | Where we use it |
|---|---:|---:|---|
| Maps SDK for Android / iOS | **Unlimited** | — | Every map view in both apps |
| Places Autocomplete — **Session** | **Unlimited** | — | Address entry, when session-tokened |
| Places Autocomplete — Per Request | 10,000 | $2.83 / 1k | What we'd pay *without* session tokens |
| Geocoding | 10,000 | $5.00 / 1k | Address → coordinates fallback |
| Routes — Compute Routes | 10,000 | $5.00 / 1k | Trip route + polyline |
| Routes — Compute Route Matrix | 10,000 | $5.00 / 1k | ETA, driver matching |

## Two decisions that follow directly from that table

**Session tokens are not optional.** Autocomplete billed *per session* is free without limit;
billed *per request* it costs $2.83 per 1,000 past the first 10,000. A single address entry is
roughly one request per keystroke, so "Orlando West" is ~12 billable events one way and part of one
free session the other. `packages/maps-service/src/core.ts` requires a `sessionToken` on every
autocomplete call, `validate.ts` rejects a request without one, and `AddressAutocomplete` mints one
per entry and reuses it through the final place resolution. That is the entire difference.

**Rendering maps is free, so we render freely.** The Maps SDK SKU has no cap. There is no cost
argument against showing a map on the booking screen, the ride screen and the driver screen — the
only billable part was the Routes call that produced the polyline, and that happens once per ride.

## What a ride actually costs

Per completed ride, assuming the customer picks both addresses from autocomplete:

| Call | Billable events |
|---|---:|
| Autocomplete, pickup + dropoff | 0 (session SKU) |
| Place resolution ×2 | 0 (same sessions) |
| Fare quote (`/api/rides/quote` → Route Matrix) | 1 |
| Route polyline for the preview map | 1 |
| Ride creation ETA (`POST /api/rides`) | 1 |
| Route polyline on the ride screen (customer) | 1 |
| Route polyline on the ride screen (driver) | 1 |
| **Total** | **5** |

Geocoding is 0 on this path — it is the fallback for when an address was typed rather than
selected. At 5 billable events per ride, spread across two SKUs each with a 10,000 free allowance,
the free tier covers roughly **2,000 rides a month** before a cent is charged. Past that the
marginal cost is about **$0.025 per ride** (~R0.46), against a minimum fare of R25.

Maps Platform cost is therefore immaterial relative to revenue at every volume we can currently
foresee. It scales linearly, sub-1% of fare.

## Controls in the code

- **Server-side proxy** (`apps/api/src/app/api/maps/*`) — the billable key never enters an app
  binary. All four routes require authentication.
- **Rate limits** (`mapsLimiter`, 20/min; `autocompleteLimiter`, 100/min) — sized for cost, not
  abuse. A runaway client loop cannot spend unbounded money.
- **Geocode cache** (24h TTL, `apps/api/src/lib/maps.ts`) — hyperlocal traffic geocodes the same
  taxi ranks and mall entrances repeatedly. Process-local, so behind multiple Cloud Run instances
  the hit rate drops but correctness does not.
- **Fetch-once route geometry** — the ride screens poll every 5s. Fetching the polyline on each
  poll would be ~720 billable calls/hour for one open ride and would exhaust the free tier in half
  a day. A `routeFetchedFor` ref pins it to one call per ride.
- **One quote covers all five vehicle types** — switching between Sedan and Minivan re-prices
  locally off a single Route Matrix response.

## Budget

Set a Cloud Billing budget alert on the project. The brief suggested $150 "to stay under the free
credit" — with no credit to stay under, that number no longer means anything. **$20–30/month** is
the right starting figure: high enough not to page on noise, low enough that anything approaching
it signals a genuine problem (a leaked key, a retry loop) long before it becomes an expensive one.

At current volume the expected Maps spend is **$0**.
