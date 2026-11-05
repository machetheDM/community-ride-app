# Community Ride: the plan

**Drafted 4 November 2026** from an audit of commit `d345ea0` (branch `feat/gcp-infra`) and the
owner's description of the business the same day. Nothing in the code was changed to write it.

Rule IDs in brackets (ALL-1, ML-4, DSO-3 and so on) come from `../PRACTICES.md`. Gap numbers
(§5 item 2 and so on) come from `../CAREER-TARGET.md`.

**This repository is public.** The owner decided on 5 November 2026 to commit this plan and
the threat model once Phase 1 had closed the holes in section 2.

## Progress

| Phase | State | Where |
|---|---|---|
| 0. A clean start | Done, 5 November 2026 | Pull request #6 |
| 1. Close the security holes | Done, 5 November 2026: all eleven holes in section 2 closed, 48 of the threat model's rows DONE | The Phase 1 pull request; `docs/threat-model.md` names the commit for each |
| 2 onwards | Not started | — |

Section 2 below is the audit as it was found on 4 November, kept as the record of what Phase 1
fixed.

---

## 1. What this is

A platform for small townships and rural towns that ride-hailing companies do not serve. **We do
not own vehicles.** Independent operators own them; we own the app, the matching and the
intelligence, and we take a small share of every trip and delivery.

Two lanes, one platform:

| Lane | What the customer does | Who serves it |
|---|---|---|
| **1. Community Ride** | Books a ride now, or joins a group trip to an event at a price they offer | Independent car, bakkie and minibus operators |
| **2. Local delivery** | Orders from a store in the nearby shopping complex or mall | Scooter riders |

**The growth engine is events.** We partner with resorts, clubs and event venues. When a venue
has an event, it sends us the poster. We publish it on our website and Facebook page and pay
Meta to promote it. People who want to go are offered transport: they say what they can pay,
operators accept or counter, and the first operator to accept secures the trip. We take our
share of what the group pays.

**The second market is the new shopping complexes** being built in townships and rural areas.
None of them offers delivery or ride-hailing. Once the platform runs, we sell it to them.

**Scale it is sized for (an estimate, to be replaced by pilot numbers):** one district, up to
about 50 operators, 2 to 3 complexes with about 20 stores, a few events a month, and at most a
few thousand trips and orders a month in the first year. Not a city, and not a national
network.

---

## 2. Where the code stands today

### Solid, and kept

- A clean monorepo: Next.js 16 API and merchant portal, two Expo apps, shared packages
  (`packages/db`, `maps-service`, `push-service`, `analytics`, `types`).
- **132 unit tests pass**, and lint and type-check pass across all nine packages (run on this
  laptop, 4 November 2026). CI runs lint, type-check, tests, build, `terraform validate` and a
  Docker build.
- Fares are priced on the server from routed distance (`apps/api/src/lib/fare.ts`), not taken
  from the app.
- JWT secret fails closed in production (`apps/api/src/lib/auth.ts`). OTPs use the CSPRNG.
- BigQuery analytics pseudonymise ids with a salted hash and never break a trip
  (`packages/analytics`).
- The GCP Terraform is careful work: no service-account keys, Workload Identity Federation
  limited to this repository and `main`, per-dataset IAM, a budget first (`infra/gcp/`).
- The ETA training script refuses to train below 200 trips and refuses to save a model that
  does not beat the Google Maps baseline (`scripts/train_eta_model.py`).
- The README is mostly honest about what is and is not provisioned.

### Security holes (fix before anything new is built)

None of these was ever exploitable, because nothing was deployed and there was no real data.
Each would have been on day one of a pilot. **All eleven were closed in Phase 1** (5 November
2026), each with a test shown to fail against the old code; the threat model cites the commits.

| # | Hole | Evidence | What an attacker gets |
|---|---|---|---|
| 1 | Ride and order lists return **every** customer's records when called without a token | `apps/api/src/app/api/rides/route.ts:15-21`, `orders/route.ts:10-16` | Every trip's addresses, driver names and phones |
| 2 | A single ride can be read with no token at all | `apps/api/src/app/api/rides/[id]/route.ts:15` | Customer phone, driver details, last location |
| 3 | Driver records, including **SA ID numbers and licence numbers**, are returned to anyone | `apps/api/src/app/api/drivers/route.ts:16` (`include` returns every column; `idNumber` at `schema.prisma:126`) | Identity documents of every driver |
| 4 | Any signed-in user can set any ride to any status, and set the final fare | `apps/api/src/app/api/rides/[id]/route.ts:46-60` | Cancel strangers' rides, complete a trip at R0, two drivers accept one ride |
| 5 | Any signed-in user can change any order's status | `apps/api/src/app/api/orders/[id]/status/route.ts:15-30` | Mark any order delivered or cancelled |
| 6 | The merchant portal signs in with **a phone number only**, no OTP | `apps/merchant-portal/src/lib/actions.ts:24-33` | Any merchant's account, from the phone number on their store |
| 7 | The portal's session cookie is plain JSON, not signed | `apps/merchant-portal/src/lib/session.ts:17` | Forge a cookie and become any merchant |
| 8 | Portal "admin" pages show all users, drivers and payments to **any merchant** | `apps/merchant-portal/src/app/dashboard/users/page.tsx` and siblings | The whole platform's personal data |
| 9 | The API's `/admin` page has no sign-in at all | `apps/api/src/middleware.ts:52` covers `/api` only | Recent customers and platform counts |
| 10 | OTP brute force: codes stored in plain text, no attempt limit, and the rate limit trusts a header the caller writes | `rate-limit.ts:43`, `verify-otp/route.ts:14` | Sign in as anyone by guessing a 6-digit code |
| 11 | `next` 16.2.4 has a critical advisory | `npm audit`, 4 November 2026; fixed in 16.4.5 | Depends on the advisory; patch regardless |

### Product gaps

- **Lane 2 cannot finish a delivery.** Nothing ever assigns a scooter rider to an order:
  `Delivery.riderId` is written only by the seed. The status route then refuses every rider.
- **OTP is never sent.** There is no SMS provider; the code is printed to the console in
  development. Nobody could sign in to a deployed build.
- **No events, venues, group trips or negotiated prices.** The whole growth engine is new work.
- **No shopping complex in the data model.** Stores exist; the thing we sell to does not.
- **No commission ledger.** `PricingConfig.platformFeePercent` exists; nothing records what we
  earned or are owed. `User.walletBalance` is stored as a number, not derived from events.
- **No operator verification.** Licence and ID fields exist; nothing checks them.

### Out of date or missing practice

- README claims a WebSocket layer (`README.md:25`), OTP sign-in for the portal (`:246`) and
  rider delivery assignments (`:262`). None exists (ALL-1).
- Expo SDK 52 in both apps; current is 58. The critical `tar` advisory clears with the upgrade.
- No secret scanning or dependency gate in CI (ALL-4, DSO-2). Actions are pinned by tag, not
  commit (DSO-3). No threat model (ALL-2). No decision records (ARC-1).
- Schema changes go through `prisma db push`; there is no migration history.
- Four pull requests (#2 to #5) were open, stacked, and green in CI; only #1 was merged. All
  four were merged on 5 November 2026.

---

## 3. Decisions (each becomes a record in `docs/adr/`, ARC-1)

| Decision | Alternative, and why not |
|---|---|
| **One platform with two lanes**, as modules in this monorepo: `rides` (with events and offers) and `deliveries` (with complexes and stores), sharing identity, operators, dispatch, notifications and the ledger | Two separate products. Rejected: the same customer uses both (a person going to an event orders food), operators and the fee ledger are shared, and two codebases double the CI, infrastructure and security work for one builder |
| **One customer app** with Ride, Events and Shop tabs; **one operator app** whose screens depend on the vehicle (car or minibus operator, or scooter rider) | Four apps. Rejected for the same reason |
| **Two pricing modes.** On-demand rides use the rate card. Event trips are negotiated: the passenger offers, operators accept or counter once | Rate card everywhere. Rejected: the owner's model is that people say what they can pay, and group trips to an event are a different product from a ride now |
| **A price floor on every offer**, derived from the rate card | No floor. Rejected: lowball offers waste operators' time and can fall below what covers our fee |
| **We never hold customers' money.** Stage 1: cash or EFT to the operator, and our fee recorded as owed. Stage 2: online payment through a licensed provider that splits the payout | Collect all money into our account and pay operators out. Rejected: holding other people's money brings regulation, and a payout system is the part attackers target |
| **Money is recorded as events** (fee due, fee paid). Balances are derived, never stored as truth | A balance column. Rejected: sibling rule from `funeral-suite`, and the only way to audit a dispute |
| **A person approves everything the AI produces** before it is published | Auto-publish extracted events. Rejected: a poster is untrusted input (ML-5) |
| **GCP only** (this project's assigned cloud, `CAREER-TARGET.md` §2b). Meta is the one outside service, because Facebook is where the customers are | Mixing clouds. Rejected by the one-cloud rule |

---

## 4. How the product works

### Lane 1a: rides now

As today, made safe: book, a fare from the rate card, nearby approved operators alerted, the
first to accept wins (one atomic database update, so two operators cannot both accept), live
status, rating.

### Lane 1b: event trips (the growth engine)

1. **Venue partner.** An admin records the venue (resort, club, hall), its owner's contact and
   the agreement: they send us every event's poster.
2. **Event.** The venue sends a poster. An admin uploads it, fills in or reviews the details
   (Phase 4: the AI reads them off the poster), and publishes. The event gets a public page on
   our website with the poster as its share image, so a Facebook post previews properly.
3. **Promotion.** The admin posts the event to our Facebook page with a tracked link and boosts
   it in Meta Ads Manager. The amount spent on Meta is recorded against the event. (Posting by
   the Graph API needs Meta app review and a page token; manual first.)
4. **"I'm going, get me a ride."** The visitor signs in with their phone, picks a pickup point
   (a published one such as a taxi rank or plaza, or their own), the number of seats, and the
   price per seat they can pay. The app shows the floor and a suggested range.
5. **Pooling.** Requests for the same event, near the same pickup point and time, are grouped
   into one group offer: "9 seats, Plaza to the resort, Saturday 18:00, R80 a seat, R720 in
   all." Rules, not AI (ML-6).
6. **Operators decide.** Verified operators whose vehicle has enough seats see the offer. They
   accept, or counter once. The first valid acceptance secures the trip.
7. **Confirmed.** Passengers see the operator, vehicle and plate, and confirm any counter. A
   return trip can be booked the same way.
8. **On the day.** A check-in code at pickup, a "share my trip" link, completion.
9. **Our share.** The platform fee is recorded on the completed trip. For cash trips it is
   owed by the operator and settled weekly; an account above a limit is paused.
10. **Measured.** For each event: page views by channel, interest, offers, trips, seats,
    commission earned, Meta spent. The question this answers (DS-1): *does promoting an event
    on Facebook earn more in fees than it costs?* The decision it informs: keep or stop
    promoting that venue's events.

**Later:** event tickets bought with the ride, at a discount negotiated with the host. This
needs the stage 2 payment provider and a written agreement with each host.

### Lane 2: local delivery

1. **Complex.** A shopping complex or mall is a record of its own; its stores belong to it, and
   it has a delivery zone and fee.
2. **Order.** The customer orders from a store. Prices come from the server, every product must
   belong to that store, and the order is saved in one transaction.
3. **Store prepares.** The merchant confirms and prepares in the portal.
4. **Scooter dispatch.** When the order is ready, nearby online approved riders are offered it;
   the first to accept is assigned (atomic, like rides).
5. **Handover.** The customer gives the rider a 4-digit code, so "delivered" cannot be claimed
   without the customer.
6. **Fee.** Our share of the delivery fee is recorded on the ledger.

**Small extension:** send a parcel from one person to another. The same dispatch, with no store.

### How we earn

| Stream | When |
|---|---|
| Commission on each completed ride and event trip | From the pilot |
| Commission on each delivery | From the pilot |
| Monthly fee from a complex that uses the platform | Once a complex sees its own figures (Phase 8) |
| Featured placement of a venue's events | Once the events page has an audience |
| Margin on ticket-and-ride bundles | Stage 2 payments, with host agreements |

---

## 5. Risks the business must settle (these are not code)

| Risk | Why it matters | What to do |
|---|---|---|
| **Operating licences** | South African law requires passenger transport operators, e-hailing included, to hold operating licences, and drivers a professional driving permit. Our operators are independent, but a platform that knowingly dispatches unlicensed operators carries risk | Confirm the current rules with an attorney before the pilot. The app records each operator's documents and an admin verifies them (Phase 3) |
| **Taxi associations** | Minibus routes are controlled by associations, and e-hailing drivers in South Africa have faced violence over routes | Talk to the local association before the first event trip. Offering their members the event trips may turn competitors into operators |
| **POPIA and direct marketing** | Electronic direct marketing needs opt-in consent. Sharing customer lists with Meta, or a tracking pixel, is processing personal data | Consent to be contacted about a trip and consent to marketing stored separately. No Meta pixel or custom audience without consent (Phase 6) |
| **Meta spend** | Every boosted event costs money before it earns any | Spend recorded per event; the funnel shows whether it paid (section 4, step 10) |
| **Passenger safety and insurance** | Group trips at night to events | Verified operators, trip sharing, ratings, a way to report. Insurance requirements to confirm with the attorney |
| **Holding money** | Collecting group payments and paying operators would make us hold money | Decided against (section 3). Stage 2 uses a licensed provider's split payouts |

---

## 6. Phases

Effort is an estimate in working days. A phase is finished when every check in it passes.

### Phase 0: a clean start (about 1 day, no cloud cost)

| # | Work | The check | Rule |
|---|---|---|---|
| 0.1 | Merge pull requests #2 to #5 in order (**needs the owner's yes**) | `main` contains `d345ea0`; CI green on `main` | DSO-1 |
| 0.2 | A project `CLAUDE.md`, the operating manual the sibling projects have | File exists and names the phases, rules and refusals | — |
| 0.3 | `security.yml`: Gitleaks over full history, an `npm audit` gate on runtime dependencies, Trivy over the filesystem and its config scanner over the Terraform and Dockerfile, CodeQL; weekly as well as on every pull request | A fake secret planted in a throwaway branch turns the job red | ALL-4, DSO-2, §5 item 6 |
| 0.4 | Pin every action by commit; Dependabot, grouped weekly to save Actions minutes | A search finds no `uses: …@v` tag | DSO-3 |
| 0.5 | Correct the README's three false claims | Each claim has a file behind it, or is gone | ALL-1 |
| 0.6 | Prisma migrations replace `db push`, from a baseline migration | `prisma migrate status` reports no drift on a fresh database | — |

### Phase 1: close the security holes (3 to 4 days, no cloud cost)

| # | Work | The check | Rule |
|---|---|---|---|
| 1.1 | `docs/threat-model.md`: the adversaries (a curious customer, a rogue operator, a competing operator, a scraper, a dishonest merchant, an insider admin), STRIDE per flow, mapped to the OWASP API Security Top 10 | File exists; each hole in section 2 has a row and a mitigation | ALL-2 |
| 1.2 | An authorisation layer: one policy function per resource and action, and response shapes that never carry ID numbers, licence numbers or phone numbers unless the caller needs them | **A test per hole in section 2, each shown to fail against the old code** | SEC-3 |
| 1.3 | Ride and order state machines; every transition one conditional update | A test where two operators accept one ride: exactly one wins | — |
| 1.4 | Portal sign-in by OTP through the shared auth code; a signed, encrypted, `Secure` session cookie; an `ADMIN` role separate from `MERCHANT`; admin pages behind it; the API's `/admin` page guarded or removed | A forged cookie is refused; a merchant is refused the users page | SEC-3 |
| 1.5 | OTP: hashed at rest, five attempts per code, a lockout per phone, the rate limit keyed on the address Cloud Run's front end adds rather than one the caller writes, and an SMS interface with a console transport | A test makes six guesses and is locked out | — |
| 1.6 | ID numbers encrypted in the application before they reach the database; only a verified flag and the last digits shown | A database read shows ciphertext | POPIA |
| 1.7 | An audit table: who did what, when, for admin actions and anything touching money | A staged admin action is found in it | SEC-4 |
| 1.8 | `next` to 16.4.5 or later; every runtime advisory cleared or written down with its reason | `npm audit --omit=dev` shows no high or critical | DSO-2 |

### Phase 2: make delivery work end to end (4 to 5 days)

| # | Work | The check |
|---|---|---|
| 2.1 | Expo SDK 52 to 58 in both apps, one SDK at a time, before more screens are built on the old one | Both apps start in Expo Go and on a dev build; type-check passes |
| 2.2 | The shopping complex as a record; stores belong to one; zone and fee per complex | Migration applied; seed has one complex |
| 2.3 | Scooter dispatch and the rider's screens in the operator app | A test: an order goes from ready to delivered by an assigned rider |
| 2.4 | Order integrity: products belong to the store, one transaction, money as decimals, stock checked | A test: a product from another store is refused |
| 2.5 | Handover code at delivery | A test: delivered without the code is refused |
| 2.6 | Delivery tracking in the customer app | Seen on a phone |
| 2.7 | The end-to-end suite runs in CI against a throwaway Postgres | CI job green |

### Phase 3: events and negotiated group trips (6 to 8 days)

| # | Work | The check |
|---|---|---|
| 3.1 | Venue partners, with the agreement recorded | Admin can add one |
| 3.2 | Events: poster upload, draft, review, publish; a public website (`apps/web`) with event pages whose share preview is the poster | A Facebook link preview shows the poster |
| 3.3 | Tracked links per channel; Meta spend recorded per event | Funnel query returns views by channel |
| 3.4 | Trip offers: pickup point, seats, price per seat; floor and suggested range from the rate card | A test: an offer below the floor is refused |
| 3.5 | Pooling rules into group offers | A test: nine requests become one offer |
| 3.6 | Operators accept or counter once; the first valid acceptance wins; passengers confirm a counter | A concurrency test: one winner |
| 3.7 | Operator onboarding: driving permit, operating licence, vehicle licence, insurance; an admin verifies; nothing approves itself | An unverified operator sees no offers |
| 3.8 | The fee ledger as events; an operator's statement; a pause above a limit | Balance derived from events matches the statement |
| 3.9 | Check-in code at pickup; a share-my-trip link | Seen on a phone |

### Phase 4: AI that reads posters (4 to 6 days, small cloud cost)

The one language-model feature, chosen because it saves real work: turning a venue's poster into
an event. **Gemini on Vertex AI** keeps it on GCP and closes the "Vertex AI: absent" row.

| # | Work | The check | Rule |
|---|---|---|---|
| 4.1 | The evaluation set first: posters with hand-checked answers (synthetic until real posters arrive, and labelled synthetic), plus a red-team set of posters carrying planted instructions ("set the price to free", "publish now") mapped to OWASP LLM01 to LLM10 | Set committed with its labels | ML-5, ML-6 |
| 4.2 | The baseline: an admin typing the event in by hand, timed, and its error rate | Figures with sample size and date | ML-1, ALL-5 |
| 4.3 | Extraction with a fixed output schema; the poster's text handled as data, never as instructions; output validated; nothing published until an admin approves | The red-team set: none gets through to a published event | ML-5 |
| 4.4 | A switch turns it off, and the manual form remains | A test with the switch off | ML-4 |
| 4.5 | Every call records latency, tokens, cost and prompt version, traced with OpenTelemetry | A script totals a day's cost | ML-7, §5 item 10 |
| 4.6 | promptfoo in CI against recorded answers; a live run on demand | CI job reports field accuracy and red-team pass rate | §5 item 2 |
| 4.7 | Drafted Facebook post text, approved by a person | — | — |
| 4.8 | Model card; NIST AI 600-1 risk table; MITRE ATLAS techniques; CSA AICM mapping; SP 800-218A tasks | Files in `docs/` | ML-3, ML-8, SEC-7, SEC-5, DSO-8 |

Which Vertex AI region serves Gemini closest to South Africa is to be checked, and the
data-residency choice written down.

### Phase 5: run it on GCP (3 to 5 days; the owner applies)

| # | Work | The check | Rule |
|---|---|---|---|
| 5.1 | The five architecture documents (`../ARCHITECTURE-DOCS-PROMPT.md`, platform GCP) | Files in `docs/architecture/` | ALL-6, SEC-1, SEC-2 |
| 5.2 | Database decision: Cloud SQL in `africa-south1` against keeping Supabase, with costs | A decision record | ARC-1 |
| 5.3 | Deploy workflow: build, SBOM, keyless signature, push by digest, deploy through Workload Identity Federation, smoke test, automatic roll-back | Deployed digest equals the built digest | DSO-4, DSO-7, §5 item 9 |
| 5.4 | The owner runs `terraform plan`, reviews it, applies; plan output and first bill kept | §2b GCP rows move from Written to Running | DSO-5, §5 item 1 |
| 5.5 | Uptime check with an alert to a phone; audit logs; Security Command Center | An alert seen arriving | SEC-4 |
| 5.6 | Backups and a timed restore drill against a stated target | A dated note with the measured time | ALL-3 |

### Phase 6: pilot with one venue and one complex (real users)

| # | Work | The check |
|---|---|---|
| 6.1 | POPIA: privacy notice, operator agreement, separate consents for trip messages and marketing | Documents exist; consent stored per person |
| 6.2 | Attorney's answers on licences, e-hailing rules and insurance; a meeting with the taxi association | Written note of each answer |
| 6.3 | Before-launch baseline: how people reach events now, and what they pay | Survey results with sample size |
| 6.4 | One event run end to end; the funnel reported with sample sizes | A dated pilot report |

### Phase 7: analytics and models on real data

| # | Work | Waits for |
|---|---|---|
| 7.1 | dbt on BigQuery: the event funnel, commission, Meta spend against earnings per event, a complex's own figures | Pilot data. Closes §5 item 13 |
| 7.2 | A suggested-price model: the chance an operator accepts an offer at a given price. Baseline: the rate-card range | About 500 offers with outcomes |
| 7.3 | The ETA residual model (script exists) | 200 completed trips |
| 7.4 | Seats needed per event, for planning operators | About 20 events |
| 7.5 | Training and the model registry on Vertex AI once a threshold is met | The above |

### Phase 8: sell to complexes

A complex owner's dashboard (orders, trips to the complex, revenue), a one-page pitch built from
real pilot figures, featured event placement, then ticket-and-ride bundles once stage 2
payments exist.

### Phase 9: owning it

The routine in `CAREER-TARGET.md` ("Owning it"): a system map from memory, decisions explained
without notes, three requests traced through the code, changes made by hand, a mock interview
per target role. This project is not cited to a recruiter until then.

### Practice tier (built once to learn, then switched off)

- An MCP server for operations staff ("which events this weekend have unfilled seats?"). §5 item 3.
- Offer and location events through Pub/Sub into BigQuery. §5 item 11.

---

## 7. AI and ML, honestly

| Feature | What it is | State |
|---|---|---|
| Fares | Rules (a rate card) | Exists |
| Price floor and suggested range | Rules | Phase 3 |
| Pooling requests into group offers | Rules | Phase 3 |
| Reading posters into events | A language model (Gemini on Vertex AI), human-approved | Phase 4 |
| Drafting the Facebook post | A language model, human-approved | Phase 4 |
| Suggested price from acceptance history | A trained model | Waits for about 500 offers |
| ETA correction | A trained model | Waits for 200 trips |
| Seats needed per event | A forecast | Waits for about 20 events |

Nothing rule-based is called AI (ML-6).

---

## 8. What this closes in `CAREER-TARGET.md` §5

| Gap | Where |
|---|---|
| 1. One applied stack per cloud (GCP has nothing running) | Phase 5 |
| 2. LLM evaluation and red-team harness | Phase 4 |
| 3. MCP | Practice tier |
| 6. IaC scanning in CI | Phase 0 |
| 9. Model signing and an SBOM | Phase 5 |
| 10. Tracing | Phase 4 |
| 11. One real stream | Practice tier |
| 13. dbt on a warehouse, and BigQuery | Phase 7 |
| GCP table: Vertex AI absent | Phase 4 |

---

## 9. Needs the owner

| What | When |
|---|---|
| ~~Yes to merging pull requests #2 to #5~~ | Given and done, 5 November 2026 |
| ~~Whether this plan and the threat model are committed to the public repository~~ | Decided 5 November 2026: committed once Phase 1 closed the holes |
| The district and towns, and the expected numbers, to replace the estimate in section 1 | Before Phase 3 |
| An SMS provider account (a credential) | Before anyone outside can sign in |
| A GCP project with billing, and running `terraform apply` | Phase 4 (Vertex AI) and Phase 5 |
| A Facebook page and Meta ad account | Phase 3 |
| An attorney on licences and insurance; a conversation with the taxi association | Before the pilot |
| A licensed payment provider with split payouts | Stage 2 payments |
