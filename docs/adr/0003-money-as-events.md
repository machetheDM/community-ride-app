# 0003. Money is recorded as events; balances are derived

- Status: Accepted
- Decided: 4 November 2026, following ADR 0003 in the sibling `funeral-suite`. Built 19 November
  2026.

## Context

What an operator owes changes with every trip, payment and correction. A stored balance is
right until the first correction, and after that nobody can say why it is what it is.

## Decision

- **Ledger rows.** There are three kinds of `LedgerEntry` row: `FEE_DUE`, `FEE_PAID` and
  `ADJUSTMENT`. An adjustment is signed and carries a reason. No model has a balance column.
- **Derived balance.** What an operator owes is `owedBalance(rows)` in
  `packages/db/src/trips.ts`, computed on each read.
- **Recorded once.** The ledger is unique on kind, source type and source id. A retried
  completion therefore cannot charge a fee twice, and a payment form submitted twice records
  one payment.

## Alternatives considered

- **A balance column updated in the same transaction.** Faster to read, but it creates a
  second source of truth.

## Consequences

- Every read of a statement sums the operator's rows. At township volumes that is a few
  hundred rows per operator, and it has not needed a cache.

## How we know it holds

- `prisma/schema.prisma` has no balance field on any model.
- `trips.test.ts` tests what an operator owes.
- `group-trips.int.test.ts` checks the statement's derived figure after a fee and a payment.
