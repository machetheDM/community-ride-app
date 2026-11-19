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
- The poster reader's schema has no status, price or action field, and a reading never
  publishes an event or sets its venue (ADR 0008). Do not add one. Its accuracy is never claimed
  without answers recorded from a live run; until then the evaluation says it is not measured.

---

## Architecture

| Component | Path | Local port | Notes |
|---|---|---|---|
| API | `apps/api` | 3000 | Next.js 16 route handlers. Request hook is `src/proxy.ts` (Next 16 renamed middleware), `/api` only |
| Public event pages | `apps/api/src/app/e` | 3000 | Server-rendered, headers in `apps/api/next.config.ts` (ADR 0005) |
| Merchant and admin portal | `apps/merchant-portal` | 3001 | Next.js 16, server actions |
| Customer app | `apps/customer-app` | — | Expo SDK 58, React Native 0.88, React 19.3.0 (exact) |
| Operator app | `apps/driver-app` | — | Drivers and scooter riders; same SDK |
| Database | `packages/db` | — | Prisma 7, Postgres schema `ride`, migrations in `prisma/migrations` |
| Shared crypto and audit | `packages/db/src/{crypto,audit}.ts` | — | `@ride/db/crypto`, `recordAudit` |
| Maps | `packages/maps-service` | — | Google Routes and Places (New), server key only |
| Push | `packages/push-service` | — | Expo and FCM |
| Analytics | `packages/analytics` | — | BigQuery, pseudonymised; no-op when unconfigured |
| Poster reader | `packages/poster-reader` | — | Gemini on Vertex AI, CONFIGURED (no GCP project); off unless `POSTER_READER_*` are set (ADR 0008). Evaluation in `eval/`, model card beside it |
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
- **Group-trip concurrency:** any change to which requests sit in an OPEN trip takes the pool's
  advisory lock (`lockPool`), then the operator's row lock; trip status changes are conditional
  writes. Keep that order, or two locks can deadlock.
- **Inside an interactive transaction, query one at a time.** `Promise.all` over `tx` overlaps
  queries on one pg connection (pg warns, and v9 will refuse).
- **The poster reader's prompt and schema carry a version** (`PROMPT_VERSION`,
  `packages/poster-reader/src/fields.ts`). Change either and bump it: answers recorded for the
  old version stop counting, and accuracy needs a new live run.
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
- `PRACTICES.md` has no TST rule: cite only IDs that exist (ALL, ML, DSO, DS, SEC, ARC).
- Jest finds no tests in a checkout whose path contains a dot folder (the agent worktrees
  under `.claude/worktrees/`): on Windows the backslash before `.claude` is read as a glob
  escape in `testMatch`. Run there with `-- "--testMatch=**/src/test/unit/**/*.test.ts"`.
  The main checkout is unaffected.
- A Dockerfile base image held in an `ARG` is invisible to Checkov (CKV_DOCKER_7) and to
  Dependabot; write the pinned digest on each `FROM` line.
- `next build` rewrites `.next/types`, which the Next apps' type-check reads through
  `next-env.d.ts`. Run in parallel, the type-check failed on half-written route types
  (seen after `/admin` was removed). `turbo.json` makes each package's `build` wait for
  its own `typecheck`.
- `python -I` hides the user site-packages, where Pillow is installed on the owner's machine.
  `packages/poster-reader/eval/make_posters.py` reads only the repository's own files, so it
  runs with plain `python`.

## Verification

```powershell
npx turbo typecheck lint test build
node scripts/audit-gate.mjs
npm run eval -w @ride/poster-reader
```

Terraform: `terraform -chdir=infra/gcp fmt -check; terraform -chdir=infra/gcp validate`.

## State (19 November 2026)

- Phases 0 and 1 of `docs/PLAN.md` done. Phase 2 done in code: server side, screens, and
  the Expo SDK 58 upgrade (2.1, merged into `feat/phase-2-delivery`). Neither app has run on
  a phone yet; the icon and splash artwork were never in the repo.
- Phase 3 built: public event pages (`apps/api/src/app/e`), offers, pooling, accept and
  counter, operator documents, the fee ledger and pause limit, check-in, share links
  (`apps/api/src/app/t`), and the event and group-trip screens in both apps. Left: seeing it
  on a phone, and a report button (threat model PL-4).
- Phase 4 started on `feat/phase-4-poster-reader`: the poster reader (4.3), its switch (4.4),
  per-call records and a day's cost (4.5), the synthetic and red-team set (4.1) with its
  evaluation in CI (4.6), the model card and NIST AI 600-1 table (4.8, in part). Not measured:
  the model's accuracy and cost (needs a GCP project) and the manual baseline (4.2, needs a
  person). Left: the Facebook post draft (4.7), the AICM and SP 800-218A tables.
- Decisions are in `docs/adr/` (0001 to 0008). Threat model: 68 rows DONE, 6 OPEN, 9 PLANNED.
- Tests: unit (`npx turbo test`) and integration against Postgres
  (`npm run test:integration -w @ride/api`, needs `TEST_DATABASE_URL` on localhost).
- Nothing deployed. No GCP project. No real users or data.

## Open

- FCM still uses a downloaded service-account key (threat model PU-2).
- Mobile tokens last 30 days with no refresh (AU-4); the portal's CSP allows inline scripts
  until a nonce is set per request; one database credential is shared by API and portal (IN-4).
- `TRUST_PROXY_HOPS=1` follows Google's documentation for Cloud Run; log the raw header once
  after the first deploy to confirm it.
- Area, expected numbers and the SMS provider: the owner's to supply.
