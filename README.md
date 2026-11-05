# Community Ride — Hyperlocal Ride-Hailing & Delivery Platform

[![CI](https://github.com/machetheDM/community-ride-app/actions/workflows/ci.yml/badge.svg)](https://github.com/machetheDM/community-ride-app/actions/workflows/ci.yml)

A production-oriented monorepo for a community-owned ride-hailing and on-demand delivery network. It mirrors the Uber / Bolt / Mr D model: a **Customer App** requests rides or deliveries, a **Driver App** accepts rides, a **Merchant Portal** manages stores & orders, and a shared **REST API** coordinates everything in real-time.

Built to showcase full-stack TypeScript architecture, clean API design, security best practices, automated testing, and CI/CD — suitable for recruiters and GitHub portfolio presentation.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Community Ride                           │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│  Customer App │  Driver App   │ Merchant      │     Admin       │
│   (Expo/RN)   │   (Expo/RN)   │   Portal      │     API         │
│               │               │  (Next.js)    │  (Next.js 16)   │
└───────┬───────┴───────┬───────┴───────┬───────┴────────┬────────┘
        │               │               │                │
        └───────────────┴───────┬───────┴────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   REST API + push      │
                    │   • Auth (OTP/JWT)     │
                    │   • Rate limiting      │
                    │   • Zod validation     │
                    │   • Push notifications │
                    └───────┬────────────────┘
                            │
                    ┌───────▼──────────┐
                    │  PostgreSQL      │
                    │  (Prisma 7 ORM)  │
                    └──────────────────┘
```

## Monorepo Structure

```
community-ride-app/
├── apps/
│   ├── api/              ← Next.js 16 REST API                      :3000
│   ├── merchant-portal/  ← Next.js 16 web portal for merchants     :3001
│   ├── customer-app/     ← Expo React Native customer app
│   └── driver-app/       ← Expo React Native driver / rider app
├── packages/
│   ├── db/               ← Prisma 7 schema + shared PostgreSQL client
│   ├── types/            ← Shared domain types
│   ├── maps-service/     ← Google Maps Platform integration (3 subpath exports)
│   ├── push-service/     ← Push notifications: Expo + FCM dual transport
│   └── analytics/        ← BigQuery event streaming + dashboard queries
├── infra/gcp/            ← Terraform: budget, Cloud Run, BigQuery, IAM, WIF
├── scripts/              ← ETA model training
├── docs/                 ← Architecture and cost documentation
└── .github/workflows/    ← CI/CD
```

## Google Cloud

Five GCP services, in varying states of readiness — the distinction is stated, not blurred:

| Service | Code | Provisioned |
|---|---|---|
| Maps Platform | ✅ | ❌ |
| Firebase Cloud Messaging | ✅ | ❌ |
| BigQuery | ✅ | ❌ |
| Cloud Run | ✅ Dockerfile + Terraform | ❌ |
| Vertex AI | Documented, **deliberately deferred** | ❌ |

**No GCP project exists and nothing has been provisioned.** The app runs without any of it: no Maps
key means `/api/maps/*` returns 503 and everything else works; no Firebase credentials means Expo
Push handles notifications alone; no BigQuery dataset means analytics writes are no-ops and the
dashboard says so. A portfolio project that only runs against a live cloud account is one nobody can
review.

Vertex AI is deferred because the database holds **one** completed trip against a 200-trip
threshold. `scripts/train_eta_model.py` enforces that in code rather than leaving it to discipline,
and refuses to save a model that fails to beat the Google Maps baseline.

- [`docs/gcp-architecture.md`](docs/gcp-architecture.md) — architecture diagram, security posture, cost-scaling narrative
- [`docs/maps-platform-cost-estimate.md`](docs/maps-platform-cost-estimate.md) — cost model, and why the $200 credit no longer exists
- [`docs/cloud-run-deployment.md`](docs/cloud-run-deployment.md) — image, cold starts, when to raise `min_instances`
- [`docs/vertex-ai-eta-model.md`](docs/vertex-ai-eta-model.md) — model design and the deferral
- [`infra/gcp/README.md`](infra/gcp/README.md) — ordered provisioning steps

## Key Production Practices

### API Layer
- **Zod validation** on every request body and query string
- **Standardized JSON responses**: `{ success, data, meta?, error, errors? }`
- **Custom error classes** with proper HTTP status codes and structured error messages
- **Global error handling** wrapper on every route
- **Rate limiting** per IP with stricter limits on auth endpoints
- **Security headers**: HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and a `Permissions-Policy` denying camera/mic/geolocation
- **Structured request logging** with timing and status codes
- **Pagination** helpers for every list endpoint

### Security posture
- **Fail-closed secrets** — `JWT_SECRET` falls back to a development value only
  outside production. In production a missing secret, or the published dev
  fallback, raises rather than silently signing forgeable tokens.
- **CSPRNG one-time passwords** — OTPs come from `crypto.randomInt`, not
  `Math.random()`.
- **Bounded pagination** — non-numeric `?page` / `?pageSize` fall back to
  defaults instead of reaching the database as `NaN`.
- **Process-local rate limiting** — the limiter is an in-memory fixed window,
  which is per-instance by design. A multi-instance deployment would need a
  shared store; this is stated rather than implied.
- **Known advisories, gated** — CI fails on any high or critical advisory unless
  [`security/audit-exceptions.json`](security/audit-exceptions.json) accepts it
  with a reason and an expiry date (`scripts/audit-gate.mjs`). Six are accepted
  today, all in Expo SDK 52 and React Native build tooling, until the SDK upgrade;
  none is present in the API's deployable build (checked 5 November 2026).

### Google Maps Platform

Routing, geocoding and address autocomplete run through `packages/maps-service`, which exposes
three deliberately separate entry points:

| Import | Contents | Consumed by |
|---|---|---|
| `@ride/maps-service` | Server-side Google client | API only |
| `@ride/maps-service/client` | Fetch client for the API proxy | Both Expo apps |
| `@ride/maps-service/native` | `AddressAutocomplete`, `RouteMap` | Both Expo apps |

The split is load-bearing twice over. The API is on React 19 while Expo pins 18.3.1, so React must
not appear in the package's main entry. And the server client holds the billable API key, so it
must be impossible to import it from a mobile bundle by accident.

**Two keys, not one.** The Maps SDK render key ships inside the app binaries — that is unavoidable
and harmless, because the Maps SDK for Android/iOS SKU is free at unlimited volume. Geocoding,
Routes and Places all bill per request, so those calls go through authenticated, rate-limited proxy
routes at `/api/maps/*` using a server-only key restricted to the API's egress IP. A bundle-ID
restriction would not protect a billable key: the restriction is asserted by the caller, and the key
can be extracted from any APK.

Uses the **Routes API** and **Places API (New)** rather than Directions, Distance Matrix and legacy
Places Autocomplete, which moved to Legacy status in the March 2025 pricing change.

Cost model, and why the widely-cited $200 monthly credit no longer exists:
[`docs/maps-platform-cost-estimate.md`](docs/maps-platform-cost-estimate.md).

### Push notifications — two transports

`packages/push-service` sends over **Expo Push** and **Firebase Cloud Messaging**, choosing per
message by the shape of the token. Expo Go builds register an `ExponentPushToken[…]` and relay
through FCM automatically; a development or EAS build issues a native FCM token that goes direct.
Both paths are live code, so Expo Go keeps working today and FCM takes over the moment a dev build
ships — no migration step.

`User.fcmToken` was renamed to `pushToken` (with `@map` preserving the column) because it never
held an FCM token. `pushProvider` records which transport a stored token belongs to, but the send
path re-derives it per message, so a device switching build types is routed correctly immediately.

Both Next.js apps share this package. They previously kept separate copies, and the merchant
portal's dropped any token not starting with `ExponentPushToken[` — once FCM tokens existed,
merchant-triggered order notifications would have gone nowhere while still reporting success.

Nothing in the transport throws. A push is a courtesy on top of an operation that already
succeeded; a ride is still accepted whether or not the notification lands.

**Triggers:** driver assigned · driver arriving (ETA threshold) · trip started · new ride request →
drivers · order picked up · order delivered.

### BigQuery analytics

`packages/analytics` streams a row when a trip or an order reaches a terminal state, and provides
the read queries behind the **Analytics** page in the merchant portal (trips per day by area,
demand by township, peak hours, cancellation rate, and Maps ETA accuracy).

Two rules govern it:

- **Analytics never breaks the business operation.** Writes resolve rather than reject, are not
  awaited into the response path, and are bounded by a timeout. A BigQuery outage, an expired
  credential or a schema drift cannot fail a ride.
- **Unconfigured is a valid state.** With `BIGQUERY_DATASET` unset every write is a no-op, so CI
  and local development are unaffected.

**Identifiers are pseudonymised before they leave the operational database.** None of the questions
this dataset answers need to identify a person, so customer and driver ids are stored as a salted
SHA-256 — enough to count distinct riders, useless for looking someone up. Without
`ANALYTICS_HASH_SALT` those columns are written as `NULL` rather than as an unsalted hash, which
over a known id space would be reversible and a false assurance of anonymity. Addresses are reduced
to a suburb label, never the street line.

The dashboard distinguishes **not configured**, **configured but empty**, and **has data**.
Collapsing the first two into "0 trips" would present an unconfigured system as a quiet one. There
is no sample data on the page: with one seeded trip it renders near-empty, which is correct.

Every query is date-bounded, selects named columns, and caps `maximumBytesBilled` — BigQuery's free
tier is 1 TiB of query processing per month and `SELECT *` on a growing events table is how that
gets spent.

### Fares are calculated server-side

Ride fares are derived by the API from the routed distance and duration, priced against the
`PricingConfig` table. The customer app previously computed the fare itself from a hardcoded 5 km
and posted it as `fareEstimate`, which the API stored verbatim — so the quoted price bore no
relation to the actual trip, and a crafted request could book a R0 ride. `POST /api/rides` no longer
accepts a price from the client.

### Testing & CI
- **371 Jest unit tests** (5 November 2026), covering among others the ride, order and
  delivery lifecycles, the authorisation policy, the response views (a test serialises each
  one and searches it for ID numbers, licence numbers and push tokens), one-time passwords,
  portal sessions, JWT algorithm, issuer and audience, the client address behind a proxy,
  field encryption, fares, the Maps client, push transport selection and analytics privacy
- **66 integration tests against a real Postgres** (`npm run test:integration -w @ride/api`,
  and a CI job with a Postgres service container): the route handlers called in-process with
  real SQL, transactions and migrations. One test for each access-control hole found in the
  November 2026 audit, and two drivers accepting the same ride at once (exactly one wins).
  Each route was put back to its old version and the tests run against it: 56 of the 66
  failed, including every test for a hole. The suite refuses any database host but
  localhost.
- **No unit test touches the network.** `src/test/setup.ts` replaces `global.fetch`
  with a stub that throws. This was added after a maps test whose module mock
  silently failed to apply fell through to the real client and issued a live
  request to Google — the suite was reaching the internet and nothing said so.
- **GitHub Actions pipeline**: lint → type-check → test → build, with lint
  enforced at `--max-warnings 0` and type-checking across all four apps
- **Security workflow, every pull request and weekly** (`.github/workflows/security.yml`):
  Gitleaks over the full git history, the dependency gate above, Checkov over the
  Terraform and the Dockerfile, and CodeQL. Every job blocks. Every action is
  pinned to a commit, and the API image to a digest; Dependabot proposes updates.
- **End-to-end HTTP tests** for `/api/auth` and `/api/stores` live in
  `apps/api/src/test/e2e`. They require a running server and a seeded database,
  so they are deliberately excluded from CI and run on demand via
  `npm run test:e2e -w @ride/api`

### Mobile & Web
- Tailwind CSS + Lucide icons for the merchant portal
- Expo SDK for React Native apps
- JWT stored securely with Expo SecureStore
- Push notifications via Expo Push API

## Apps & Features

### `apps/api` — REST API
- `POST /api/auth/request-otp` — request a 6-digit code (South African mobiles; capped per
  phone; 503 in production until an SMS provider is configured, never a false "sent")
- `POST /api/auth/verify-otp` — verify the code and receive a JWT (five wrong guesses burn a
  code; repeated failures lock the phone out)
- `POST /api/auth/logout-all` — revoke every token issued to the caller
- `GET /api/stores` — list approved stores with search & filters
- `GET /api/rides` — the caller's own rides (a customer's, or a driver's assigned ones)
- `GET`, `PATCH /api/rides/[id]` — read or move a ride; only its parties, one checked
  lifecycle step at a time (two drivers accepting the same ride: one wins, one gets 409)
- `POST /api/rides` — book a ride (server-priced, coordinates resolved)
- `POST /api/rides/quote` — fare + ETA preview across every vehicle type
- `POST /api/maps/geocode` — address → coordinates (cached)
- `POST /api/maps/route` — route with polyline
- `POST /api/maps/eta` — travel time and distance
- `POST /api/maps/autocomplete` — address suggestions; `PUT` resolves the selection
- `PATCH /api/deliveries/[id]/status` — rider-side delivery lifecycle
- `GET /api/orders`, `GET /api/orders/[id]` — orders scoped to the caller (customer,
  store's merchant, assigned rider, or admin)
- `POST /api/orders` — place an order: priced on the server in one transaction, products
  must belong to the store, stock checked
- `GET /api/drivers` — the operator roster, ADMIN only

All endpoints return consistent JSON and validate input with Zod. Every route that reads or
changes someone's data checks the caller's role and status in the database on each request
(`requireActiveUser`), and responses are built from explicit field lists
(`apps/api/src/lib/views.ts`), so ID numbers, licence numbers and push tokens never leave the
API.

### `apps/merchant-portal` — Merchant Dashboard
- Sign-in by phone and one-time code, with an HMAC-signed, `Secure`, `httpOnly` session cookie
  that is re-checked against the database on every request
- **Two roles:** a merchant sees only their own stores and orders; platform-wide pages
  (users, drivers, riders, stores, payments, settings, analytics) are ADMIN only, and every
  view of personal data on them is written to the audit log
- Security headers and a Content-Security-Policy on every page
- **Overview**: revenue metrics, open stores, pending orders, recent activity
- **Orders**: live order board with status actions (confirm, prepare, ready, deliver, cancel)
- **My Store**: open/close toggle, store details, ratings
- **Admin pages**: Stores, Drivers, Riders, Users, Payments, Settings

### `apps/customer-app` — Customer App
- Phone OTP login
- Active ride/order banners
- Book a ride with vehicle type, pickup/dropoff, fare estimate
- Browse stores, place orders, live status tracking

### `apps/driver-app` — Driver / Rider App
- Driver online/offline toggle
- Available rides feed with one-tap accept
- Status flow: Accepted → En Route → Arrived → In Progress → Completed
- Delivery status updates by the assigned scooter rider (assigning a rider to an order is not built yet)

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces |
| Web | Next.js 16, App Router, Turbopack, Tailwind CSS v4 |
| Mobile | Expo SDK, Expo Router v4, React Native |
| Language | TypeScript (strict) |
| Database | PostgreSQL (Supabase) |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Validation | Zod |
| Auth | JWT, Phone OTP, Cookie sessions |
| Push | Expo Push Notification API |
| CI/CD | GitHub Actions |

## Database Schema

```
User         role: CUSTOMER | DRIVER | RIDER | MERCHANT | ADMIN
Driver       isOnline · isApproved · totalRides → Vehicle
Rider        isOnline · isApproved · totalDeliveries → Vehicle
Merchant     isApproved → Store[]
Store        isOpen · isApproved → Category[] · Product[] · Order[]
Order        status · items[] · delivery · payment
Ride         status · pickup · dropoff · driver · payment
Payment      amount · method · status
PricingConfig baseFare · perKmRate · perMinuteRate · platformFeePercent
```

## Getting Started

### Prerequisites
- Node.js 24 (the version CI and the API image use)
- PostgreSQL (Supabase or local/Docker)
- Expo Go for mobile preview

### 1. Install
```bash
npm install
```

### 2. Environment
```bash
# Root .env
DATABASE_URL="postgresql://postgres:password@host:5432/postgres"
DIRECT_URL="postgresql://postgres:password@host:5432/postgres"
JWT_SECRET="your-secret-key"
EXPO_PUSH_ACCESS_TOKEN="your-expo-token"   # optional for push
# The full list, with what each secret protects: .env.example
```

### 3. Database setup

The schema is namespaced under a Postgres schema called `ride`. If your database
does not have it yet, create it first:

```bash
npm run db:create-schema -w @ride/db
```

Then generate the client, apply the migrations and seed demo data:

```bash
npm run db:generate -w @ride/db
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
npm run db:seed        # demo merchant, stores, driver, rider, customer, admin
```

Schema changes go through migrations in `packages/db/prisma/migrations`, not
`db push`. A database created earlier with `db push` is brought under migrations
once, by marking the baseline as already applied:
`npx prisma migrate resolve --applied 0_init --schema=packages/db/prisma/schema.prisma`.
The generated Prisma client is not committed; turbo regenerates it before
type-check, lint, test and build.

### 4. Run web apps
```bash
npx turbo run dev
# api           → http://localhost:3000
# merchant-portal → http://localhost:3001
```

### 5. Run mobile apps
```bash
cd apps/customer-app && npx expo start
cd apps/driver-app   && npx expo start
```

## Demo Accounts

Created by `npm run db:seed` (`packages/db/prisma/seed.ts`). Placeholder numbers for a local
database only. The seed does not check which database it is pointed at, so never run it
against a real one.

| Role | Phone | Signs in to |
|---|---|---|
| Admin | +27 81 000 0000 | Merchant portal (platform pages) |
| Merchant | +27 81 000 0001 | Merchant portal (own stores) |
| Driver | +27 82 000 0002 | Driver app |
| Scooter rider | +27 82 000 0003 | Driver app |
| Customer | +27 83 000 0004 | Customer app |

In development the one-time code is printed to the server console and returned by
`POST /api/auth/request-otp`; in production neither happens.

## Testing

Unit tests — no database or running server required. This is what CI runs:

```bash
npx turbo test
```

End-to-end HTTP tests — need the API running and the database seeded:

```bash
npm run test:e2e -w @ride/api
```

Point them elsewhere with `API_BASE_URL` (defaults to `http://localhost:3000`).

Lint and type-check the whole monorepo:

```bash
npx turbo lint typecheck
```

## License

MIT — Built by [Dingaan Mahlatse Machethe](https://www.mahlontebe.org.za/portfolio) for portfolio and showcase purposes.
