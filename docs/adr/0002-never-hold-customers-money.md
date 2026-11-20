# 0002. We never hold customers' money; operators owe us our fee

- Status: Accepted
- Decided: 4 November 2026

## Context

Operators own the vehicles; we own the app and take a share. Holding customers' money and
paying operators out brings payment regulation, and it builds the part of a system that
attackers target first. Customers pay in cash today.

## Decision

- Stage 1 (WIRED):
  - Passengers pay the operator, in cash or by EFT.
  - When a ride, delivery or group trip completes, a `FEE_DUE` ledger row records our share
    against the operator.
  - The operator pays that fee to us, and an admin records it as `FEE_PAID`.
- Stage 2 (PLANNED): a licensed payment provider that splits the payout, so the money still
  never rests with us.
- An operator who owes more than R500 cannot take new work until they settle.

## Alternatives considered

- **Collect everything and pay operators out.** Rejected for the regulation and the risk.
- **No limit on what is owed.** In a cash business, "owed" would then mean nothing.

## Consequences

- We carry the risk that an operator does not pay. The pause limit caps that risk for each
  operator.
- An operator could settle a trip off the platform to avoid the fee. The check-in code and
  the passengers' own requests keep a group trip visible to us either way (threat model PL-6).

## How we know it holds

- No route accepts card details or stores a balance. `Payment` rows are records, not money.
- In `group-trips.int.test.ts`, "boards by code, completes after departure, and records the
  fee once". `rides.int.test.ts` and `deliveries.int.test.ts` assert the `FEE_DUE` row.
- In `group-trips.int.test.ts`, "pauses an operator who owes more than the limit".
