# 0004. Passengers offer for event trips, above a server floor, with one counter

- Status: Accepted
- Decided: 4 November 2026. Built 19 November 2026.

## Context

The owner's model: people who want to go to an event say what they can pay, and operators
decide whether that is worth the drive. Without rules, three things go wrong:

- offers fall below the cost of fuel;
- two operators claim the same trip;
- counter-offers go back and forth indefinitely.

## Decision

- **A floor, enforced by the server.**
  - A seat costs at least R1.20 per road km, never less than R20, rounded up to the next R5.
  - Road distance is the straight-line distance times 1.3.
  - An offer below the floor gets a 400 (threat model PL-1).
- **Pooling.** Requests are grouped by event, direction and pickup point into trips of at
  most 15 seats. Each pool has its own Postgres advisory lock.
- **The first valid acceptance wins.** Booking is a write conditional on the trip still being
  OPEN.
- **Counter-offers.**
  - A trip can have one counter, and an operator can hold one counter at a time.
  - A counter is one price per seat for everyone. Passengers have 30 minutes to answer.
  - A passenger who already offered at least the counter price counts as agreeing.
  - Once everyone has answered, the trip is booked at the counter price with those who agreed.
  - If not everyone answers within the 30 minutes, the counter lapses and the trip reopens.

## Alternatives considered

- **The rate card for event trips too.** Rejected because it is not the owner's product.
- **Unlimited counters.** Rejected because one operator could hold every trip on the board.
- **Charging passengers who offered more than the counter their own offer.** Rejected: they
  pay the counter price like everyone else.

## Consequences

- The floor values are starting numbers. Measured acceptance rates will replace them
  (PLAN.md 7.2).
- If some passengers decline a counter, the operator who made it may end up with fewer
  passengers than they countered for. They see the seat count before departure.

## How we know it holds

`group-trips.int.test.ts` covers each rule:

- "refuses an offer below the floor and stores nothing";
- "puts nine requests from one pickup point into one trip";
- "gives exactly one of two operators accepting at once the trip";
- the counter, decline and lapse tests.
