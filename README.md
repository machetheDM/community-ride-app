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
                    │   REST API + WebSocket │
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
│   └── db/               ← Prisma 7 schema + shared PostgreSQL client
└── .github/workflows/    ← CI/CD
```

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
- **Known advisories** — `npm audit` reports outstanding issues in build-time
  tooling only (Expo CLI's `tar`, the Prisma CLI's `@hono/node-server`,
  `@xmldom/xmldom`). Clearing them requires an Expo SDK major upgrade. No
  advisory affects shipped runtime code. This is disclosed, not hidden.

### Testing & CI
- **53 Jest unit tests** covering validation schemas, pagination bounds, the rate
  limiter, JWT signing/verification, sanitization and response envelopes
- **GitHub Actions pipeline**: lint → type-check → test → build, with lint
  enforced at `--max-warnings 0` and type-checking across all four apps
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
- `POST /api/auth/request-otp` — request 6-digit OTP
- `POST /api/auth/verify-otp` — verify OTP and receive JWT
- `GET /api/stores` — list approved stores with search & filters
- `GET /api/rides` — list rides with pagination & active filter
- `POST /api/rides` — book a ride
- `GET /api/orders` — list orders with pagination & status filter
- `POST /api/orders` — place a marketplace order
- `GET /api/drivers` — list drivers with online/approved filters

All endpoints return consistent JSON and validate input with Zod.

### `apps/merchant-portal` — Merchant Dashboard
- Phone OTP login with cookie-based server session
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
- Delivery assignments for riders

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
- Node.js 20+
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
EXPO_ACCESS_TOKEN="your-expo-token"        # optional for push
```

### 3. Database setup

The schema is namespaced under a Postgres schema called `ride`. If your database
does not have it yet, create it first:

```bash
npm run db:create-schema -w @ride/db
```

Then generate the client, push the schema and seed demo data:

```bash
npx prisma generate --schema=packages/db/prisma/schema.prisma
npx prisma db push --schema=packages/db/prisma/schema.prisma
npm run db:seed        # creates demo merchant, stores, driver, customer
```

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

| Role | Phone |
|---|---|
| Merchant | +27 81 000 0001 |
| Driver | +27 82 000 0002 |
| Customer | +27 83 000 0003 |

OTP is printed to the API console in development (`POST /api/auth/request-otp`).

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
