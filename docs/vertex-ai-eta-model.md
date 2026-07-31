# Vertex AI — ETA prediction model

**Status: designed, not deployed.** No Vertex AI endpoint exists. No model has been trained. This
document describes the architecture and the conditions under which it gets built.

## Why it is not deployed

The brief was explicit: *"if trip volume is still below the 200-trip threshold, document the model
architecture and defer live deployment until sufficient data exists — do NOT deploy a live endpoint
on insufficient/synthetic data."*

The database currently holds **one** completed trip, seeded in
`packages/db/prisma/seed.ts` with `distanceKm: 4.2` hardcoded. That is 0.5% of the threshold.

A model trained on that would not be a model. It would be a number with a confidence interval wide
enough to contain any answer, presented through infrastructure impressive enough that people would
believe it. Deferring is the correct engineering decision, and the threshold is enforced in code —
`scripts/train_eta_model.py` refuses to train below 200 completed trips rather than leaving it to
discipline.

Live readiness is visible on the merchant portal's **Analytics** page, which reports the current
sample size against the threshold.

## The baseline it has to beat

The Google Maps Route Matrix ETA already predicts trip duration, and it is good. Any model that
does not beat it is worse than free.

Both numbers are already being captured, deliberately as separate columns:

| Column | Meaning |
|---|---|
| `estimated_duration_minutes` | What Maps predicted at booking time |
| `actual_duration_minutes` | What the trip actually took (`startedAt` → `completedAt`) |

The `etaAccuracy` query in `packages/analytics/src/query.ts` reports the baseline's mean absolute
error and bias over any window. **That number is the bar.** If MAE is already low, this model
should not be built — the honest outcome of this investigation may be "Google's ETA is good enough,"
and that is a finding, not a failure.

## Model design

**Target:** `actual_duration_minutes`

**Features**, all available at booking time — nothing that leaks the outcome:

| Feature | Source |
|---|---|
| `distance_km` | Routes API |
| `estimated_duration_minutes` | Route Matrix baseline — the strongest single feature |
| `hour_of_day`, `day_of_week` | `occurred_at`, Africa/Johannesburg |
| `is_weekend`, `is_peak` | Derived |
| `pickup_area`, `dropoff_area` | Coarse suburb labels, target-encoded |
| `vehicle_type` | One-hot |
| Historical median duration for the area pair | Rolling aggregate |

**Model:** XGBoost regressor. Chosen over a neural network because the dataset will be small and
tabular for a long time, and because SHAP values on a tree model give a per-prediction explanation
— useful when a driver disputes an ETA.

**Framing:** predict the *residual* against the Maps estimate rather than the absolute duration.
The model then only has to learn what Google systematically misses — township road conditions,
informal stops, taxi-rank congestion — instead of relearning routing from scratch. With a small
dataset this is a much easier problem, and it degrades gracefully: a residual near zero returns the
Maps estimate.

**Validation:** time-based split, not random. A random split leaks future traffic patterns into the
training set and produces an optimistic score that will not survive contact with production.

**Ship criterion:** the model must beat the Maps baseline MAE on a held-out time period by a margin
that exceeds the noise. If it does not, it does not ship.

## Deployment, when the threshold is met

A live endpoint is genuinely justified here — unlike batch-only ML in the other portfolio projects,
ETA prediction is on the ride-booking request path and needs sub-second synchronous responses.

**Scale-to-zero is available but has a sharp edge.** `min_replica_count = 0` is supported via
`DedicatedResources` on the `v1beta1` API, and is **not available on shared public endpoints** — a
dedicated endpoint is required. Critically, a request arriving at a scaled-down endpoint receives a
**429 and is dropped** while replicas start.

On a ride-booking path that is a user-visible failure, so the integration must:

1. Treat a 429 as "cold start", not as an error
2. Fall back to the Maps ETA immediately — never block the booking on the model
3. Retry asynchronously to warm the endpoint

The fallback is the important part. **The Maps ETA remains the source of truth for the customer's
quote**; the model refines it when available. That way a cold, failed, or withdrawn endpoint
degrades to today's behaviour rather than breaking bookings.

Expected cost with scale-to-zero and low traffic: a few dollars a month, dominated by the minimum
billing increment during warm periods. This is the one component of the GCP stack that will
genuinely cost money, and it should not be provisioned until the data justifies it.

## Secondary model — demand forecasting

Predict rider demand by area and time window, to support driver positioning and incentives.

Needs materially more data than the ETA model — a demand forecast requires enough history to
separate weekly seasonality from trend, realistically several months of consistent volume across
multiple townships. Deferred until then; noted here so the BigQuery schema keeps the columns it
would need (`pickup_area`, `occurred_at`, cancellation status).

## Before any of this runs

Nothing here is provisioned. When the threshold is met, deployment requires an explicit go-ahead —
this is the one part of the GCP work with meaningful ongoing cost.
