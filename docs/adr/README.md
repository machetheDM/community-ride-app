# Architecture decision records

Short records of the decisions that shape this codebase: what was decided, what else was on
the table, what it costs, and how we know it still holds (PRACTICES ARC-1). The long form
lives in [`docs/PLAN.md`](../PLAN.md) §3 and [`docs/threat-model.md`](../threat-model.md).

Records 0001 to 0004 and 0007 were written on 19 November 2026 from decisions already in the
plan of 4 November. 0005 and 0006 were written when they were made, during Phase 3. A new
decision gets a new record at the time it is made.

| # | Decision | Status | Decided |
|---|---|---|---|
| [0001](0001-one-platform-two-lanes.md) | One platform, two lanes, one customer app and one operator app | Accepted | 4 Nov 2026 |
| [0002](0002-never-hold-customers-money.md) | We never hold customers' money; operators owe us our fee | Accepted | 4 Nov 2026 |
| [0003](0003-money-as-events.md) | Money is recorded as events; balances are derived | Accepted | 4 Nov 2026, built 19 Nov 2026 |
| [0004](0004-negotiated-event-trips.md) | Passengers offer for event trips, above a server floor, with one counter | Accepted | 4 Nov 2026, built 19 Nov 2026 |
| [0005](0005-public-event-pages-in-the-api-app.md) | The API app serves the public event pages; no `apps/web` yet | Accepted | 19 Nov 2026 |
| [0006](0006-posters-in-postgres.md) | Posters live in Postgres, stripped of metadata, until there is a bucket | Accepted | 18 Nov 2026 |
| [0007](0007-gcp-only.md) | GCP is the only cloud; Meta is the only outside service | Accepted | 4 Nov 2026 |

## Template

```markdown
# NNNN. Title as a statement

- Status: Proposed | Accepted | Superseded by NNNN
- Decided: date

## Context
## Decision
## Alternatives considered
## Consequences
## How we know it holds
```
