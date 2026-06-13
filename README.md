# Community Ride — Hyperlocal Ride-Hailing & Delivery Platform

> Full-stack production-architecture monorepo. Four apps. One shared database. Working auth, real push notifications, live order management.

Most South African townships have no Uber, no Mr D, no Bolt. This platform provides the full infrastructure for a community-operated ride-hailing and delivery service — customer app, driver app, merchant portal, and admin API — all sharing one Prisma schema and communicating through a typed REST API.

## Architecture

```
community-ride-app/
├── apps/
│   ├── api/              ← Next.js 16 REST API + Admin Dashboard   :3000
│   ├── merchant-portal/  ← Next.js 16 Merchant Web Portal          :3001
│   ├── customer-app/     ← Expo React Native — customer
│   └── driver-app/       ← Expo React Native — driver
└── packages/
    ├── db/               ← Prisma 7 schema + PostgreSQL client (shared)
    └── types/            ← Shared TypeScript interfaces
```

**Request flow:**
```
Customer App    ──→┐
Driver App      ──→┼──→  apps/api (Next.js 16 App Router)  ──→  PostgreSQL
Merchant Portal ──→┘            │
                                ↓
                       Expo Push Notifications
```

## Apps & Features

### `apps/api` — Backend API + Admin Dashboard
- Phone OTP authentication for all user roles (Customer, Driver, Merchant, Admin)
- REST endpoints: `/api/rides`, `/api/orders`, `/api/stores`, `/api/auth/otp`
- Admin dashboard: manage users, rides, orders, drivers, merchants
- Push notification dispatch on every status change

### `apps/merchant-portal` — Next.js 16 Merchant Web Portal
- Phone OTP login with cookie-based server session (no client JS auth)
- **Orders board**: live list grouped by status — Pending → Confirmed → Preparing → Ready → Delivered
- Action buttons trigger server actions + push notification to customer on each update
- **Store management**: open/close toggle per store, revenue stats, order counts
- **Overview dashboard**: real revenue metrics, store counts, recent orders

### `apps/customer-app` — Expo React Native Customer App
- Phone OTP login, persistent JWT via SecureStore
- Active ride banner on home screen, pull-to-refresh
- **Ride booking**: vehicle type picker, fare estimate, payment method selection
- Live ride status tracking with push notifications at every step

### `apps/driver-app` — Expo React Native Driver App
- Separate driver auth with driver profile and vehicle info
- **Online/offline toggle** — only online drivers appear in the feed
- Available rides feed with accept action
- Ride management: Accepted → En Route → Arrived → In Progress → Completed
- Push notification sent to customer at each status change

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | npm workspaces |
| Web (API + Portal) | Next.js 16, App Router, Turbopack, Server Actions |
| Mobile | Expo SDK + Expo Router v4 (React Native) |
| Language | TypeScript — strict mode throughout |
| Database | PostgreSQL (Docker) |
| ORM | Prisma 7 + `@prisma/adapter-pg` |
| Auth | JWT · Phone OTP · Cookie-based server sessions |
| Push Notifications | Expo Push Notification API |
| UI — Web | Tailwind CSS v4 + shadcn/ui |
| UI — Mobile | React Native StyleSheet |

## Database Schema (key models)

```
User        role: CUSTOMER | DRIVER | MERCHANT | ADMIN
Driver      isOnline · totalRides → Vehicle (licensePlate, type)
Store       isOpen · merchant → Products[]
Order       Store · Customer · items[] · status · deliveryAddress
Ride        Customer · Driver · pickup/dropoff · status · fare
OtpCode     phone · code · expiresAt
```

## Getting Started

### Prerequisites
- Node.js 20+
- Docker Desktop (for PostgreSQL)
- Expo Go app on a phone or Android emulator

### 1. Install
```bash
npm install
```

### 2. Environment variables
```bash
cp apps/api/.env.example apps/api/.env
cp apps/api/.env.example apps/merchant-portal/.env
# Required: DATABASE_URL, JWT_SECRET
```

### 3. Database
```bash
docker compose up -d
npm run db:generate
npm run db:push
npm run db:seed        # seeds demo merchant (+27 81 000 0001), driver (+27 82 000 0002), customer
```

### 4. Web servers
```bash
npm run dev            # api → :3000   merchant-portal → :3001
```

### 5. Mobile apps
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

OTP is logged to the API console in development — no SMS provider needed.

---

Built by [Dingaan Mahlatse Machethe](https://www.mahlontebe.org.za/portfolio) — Data Scientist · Full-Stack Engineer · Educator
