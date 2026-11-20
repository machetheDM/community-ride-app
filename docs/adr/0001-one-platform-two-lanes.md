# 0001. One platform, two lanes, one customer app and one operator app

- Status: Accepted
- Decided: 4 November 2026

## Context

The business has two lanes: rides (now, and group trips to events) and local delivery from
shopping complexes. The same person uses both, and the same operators, fee ledger, sign-in and
notifications serve both. There is one builder.

## Decision

- One monorepo: `apps/api`, `apps/merchant-portal`, `apps/customer-app`, `apps/driver-app`,
  with shared `packages/db` (schema, lifecycle rules, trip rules, crypto, audit).
- One customer app with ride, events and shop screens; one operator app whose home screen
  depends on what the operator drives (car or minibus, or scooter).

## Alternatives considered

- **Two products, or four apps.** Doubles CI, infrastructure and security work for one
  person, and splits the ledger that an operator working both lanes owes against.

## Consequences

- A change to a shared rule (a lifecycle transition, the price floor) changes both lanes at
  once. That is the point, and it is why those rules are pure functions with their own tests.
- The operator app carries screens a scooter rider never sees.

## How we know it holds

- The API and the portal both import `packages/db/src/lifecycle.ts` and
  `packages/db/src/trips.ts`; neither keeps its own copy.
- `apps/driver-app/app/(tabs)/index.tsx` picks the rider or driver home from the role.
