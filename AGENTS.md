# AGENTS.md: Community Ride operating manual

Read this before changing anything. `CLAUDE.md` imports this file, so every agent reads the
same rules. The parent folder's `CAREER-TARGET.md` and `PRACTICES.md` also apply; this file
wins where they disagree.

## Maintaining this file

Update it **in the same commit** as any change that affects it, without being asked: a new
app, package or service goes in the architecture table; a convention learned the hard way
goes under Footguns; a phase finished goes under State; a deliberate refusal goes under
Refusals, so a later session does not undo it.

---

## What this is

A ride and delivery platform for small South African townships and rural towns that the big
ride-hailing companies do not serve. **We do not own vehicles.** Independent operators own
them; we own the app, the matching and the intelligence, and take a small share of each trip
and delivery.

- **Lane 1, Community Ride:** rides now, and group trips to events at a price the passengers
  offer. Events come from partner venues (resorts, clubs, halls), are published on our site
  and promoted on Facebook.
- **Lane 2, local delivery:** orders from stores in the new shopping complexes, delivered by
  scooter riders.

The full plan, phases and business risks: `docs/PLAN.md`. The threat model:
`docs/threat-model.md`.

Built by Dingaan Mahlatse Machethe. It also serves his applications for AI engineering, ML
engineering and cloud security roles: when two approaches are close, take the one that leaves
evidence (a test that fails the build, a measured number, a written decision).

## Non-negotiables

1. **Honesty over impressiveness.** Never claim a technology that is not wired up. Tag claims
   WIRED, CONFIGURED, DOCS ONLY or PLANNED with a file that proves it (PRACTICES ALL-1).
   Nothing is deployed and no GCP project exists; say so wherever it matters.
2. **We never hold customers' money.** Cash or EFT to the operator first, with our fee
   recorded as owed; later, a licensed provider that splits the payout.
3. **Money is recorded as events.** Fee due, fee paid. Balances are derived, never stored as
   truth.
4. **A person approves everything a model produces** before it is published.
5. **GCP only** for cloud services (this project's assigned cloud). Meta is the one outside
   service, because Facebook is where the customers are.
6. **POPIA.** ID numbers are encrypted (`packages/db/src/crypto.ts`) and only the last four
   are ever shown. Consent for trip messages and consent for marketing are separate. No
   tracking pixel or customer list goes to Meta without consent.
7. **Authorisation is checked on every request, from the database.** Use
   `requireActiveUser(req, ...roles)` (`apps/api/src/lib/auth.ts`), never the token's role
   claim. Every state change is a conditional write on the expected current state.

**Stop and ask the owner before:** creating anything billable; any action needing a
credential (GCP, SMS provider, Meta, payment provider); merging to `main`; anything touching
real personal data.

## Refusals (deliberate, do not "fix")

- Seed data never contains a realistic 13-digit ID number; it uses `DEMO-…` values.
- `POST /api/rides` never accepts a price from the client.
- An OTP request in production with no SMS provider answers 503; it never pretends a code
  was sent.
- No model is trained below its data threshold (`scripts/train_eta_model.py` refuses under
  200 trips).

---

## Architecture

| Component | Path | Local port | Notes |
|---|---|---|---|
| API | `apps/api` | 3000 | Next.js 16 route handlers. Request hook is `src/proxy.ts` (Next 16 renamed middleware) |
| Merchant and admin portal | `apps/merchant-portal` | 3001 | Next.js 16, server actions |
| Customer app | `apps/customer-app` | — | Expo SDK 52 (upgrade is Phase 2.1) |
| Operator app | `apps/driver-app` | — | Drivers and scooter riders |
| Database | `packages/db` | — | Prisma 7, Postgres schema `ride`, migrations in `prisma/migrations` |
| Shared crypto and audit | `packages/db/src/{crypto,audit}.ts` | — | `@ride/db/crypto`, `recordAudit` |
| Maps | `packages/maps-service` | — | Google Routes and Places (New), server key only |
| Push | `packages/push-service` | — | Expo and FCM |
| Analytics | `packages/analytics` | — | BigQuery, pseudonymised; no-op when unconfigured |
| Infrastructure | `infra/gcp` | — | Terraform, **never applied** |
| ML | `scripts/train_eta_model.py` | — | Waits for 200 trips |

## Conventions

- **The owner works in PowerShell on Windows.** Commands handed to him are PowerShell: `;`
  not `&&`, `$env:VAR = "x"`. Git Bash is for scripts.
- **Line endings are LF** (`.gitattributes`). A working copy checked out before that rule can
  still hold CRLF; scripted edits must cope with both.
- **Schema changes are migrations**, never `db push`. The generated client is not committed;
  turbo runs `prisma generate` first.
- **Tests never reach the network.** `apps/api/src/test/setup.ts` stubs `fetch`; libraries
  with their own HTTP stack (the BigQuery client) are replaced by injected stand-ins.
- **Tests that need Postgres use a throwaway Docker container on 127.0.0.1** and refuse any
  other host. The root `.env` points at a real Supabase database: never migrate, seed or test
  against it.
- **CI:** `ci.yml` (lint, type-check, test, build, Terraform validate, image build) and
  `security.yml` (Gitleaks full history, the npm audit gate, Checkov, CodeQL). Every action
  is pinned to a commit and the API image to a digest. Accepted advisories live in
  `security/audit-exceptions.json` with an expiry; accepted Checkov findings are skipped
  inline in the Terraform with their reason; reviewed Gitleaks false positives are listed by
  fingerprint in `.gitleaksignore`.
- **Git:** Conventional Commits; cite the PRACTICES rule ID a change follows; every change
  reaches `main` through a pull request whose checks ran (DSO-1).
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using
  an unfamiliar API.

## Footguns found the hard way

- `packages/push-service/src/index.ts` once held raw NUL bytes, so git called it binary and
  no pull request showed its changes. Use the `\u0000` escape.
- The seed referenced fields that did not exist and had never run against the schema. Run it
  against a throwaway database after any schema change.
- An analytics test reached Google's metadata server behind the fetch stub and crashed Jest
  after teardown.
- Docker Desktop is not always running; start it before the database tests.
- Gitleaks 8.30's `[[allowlists]]` did not match as documented; `.gitleaksignore`
  fingerprints did.
- Jest finds no tests in a checkout whose path contains a dot folder (the agent worktrees
  under `.claude/worktrees/`): on Windows the backslash before `.claude` is read as a glob
  escape in `testMatch`. Run there with `-- "--testMatch=**/src/test/unit/**/*.test.ts"`.
  The main checkout is unaffected.
- A Dockerfile base image held in an `ARG` is invisible to Checkov (CKV_DOCKER_7) and to
  Dependabot; write the pinned digest on each `FROM` line.

## Verification

```powershell
npx turbo typecheck lint test build
node scripts/audit-gate.mjs
```

Terraform: `terraform -chdir=infra/gcp fmt -check; terraform -chdir=infra/gcp validate`.

## State (5 November 2026)

- Phase 0 (clean start) and Phase 1 (close the security holes) of `docs/PLAN.md` in progress.
- Pull requests #1 to #5 merged.
- Nothing deployed. No GCP project. No real users or data.

## Open

- The owner decides whether `docs/PLAN.md` and `docs/threat-model.md` are committed to this
  public repository, or the repository goes private with a public showcase.
- FCM still uses a downloaded service-account key (threat model PU-2).
- Area, expected numbers and the SMS provider: the owner's to supply.
