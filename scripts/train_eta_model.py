#!/usr/bin/env python3
"""Train the ETA prediction model from BigQuery trip history.

Refuses to train below a minimum sample size. That refusal is the point of this
script existing in this form: the threshold is enforced in code rather than left
to whoever runs it remembering the rule. A model fitted to a handful of trips is
not a weak model, it is a number with a confidence interval wide enough to
contain any answer, delivered through infrastructure impressive enough that
people believe it.

Predicts the *residual* against the Google Maps ETA rather than the absolute
duration, so the model only has to learn what Maps systematically misses —
township road conditions, informal stops, taxi-rank congestion — instead of
relearning routing from scratch. On a small dataset that is a much easier
problem, and it degrades gracefully: a residual near zero returns the Maps
estimate unchanged.

Usage:
    python scripts/train_eta_model.py --project my-project --dataset ride_analytics

Nothing here deploys anything. It trains, evaluates against the Maps baseline,
and writes artefacts locally. Deploying a Vertex AI endpoint is a separate,
explicitly-approved step — see docs/vertex-ai-eta-model.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Minimum completed trips with both a prediction and an outcome.
MIN_TRIPS = 200

# Fraction held out for evaluation, split by time rather than at random.
TEST_FRACTION = 0.2

QUERY = """
SELECT
  occurred_at,
  distance_km,
  estimated_duration_minutes,
  actual_duration_minutes,
  pickup_area,
  dropoff_area,
  vehicle_type,
  EXTRACT(HOUR FROM occurred_at AT TIME ZONE 'Africa/Johannesburg') AS hour_of_day,
  EXTRACT(DAYOFWEEK FROM occurred_at AT TIME ZONE 'Africa/Johannesburg') AS day_of_week
FROM `{project}.{dataset}.trips`
WHERE status = 'COMPLETED'
  AND actual_duration_minutes IS NOT NULL
  AND estimated_duration_minutes IS NOT NULL
  AND distance_km > 0
  -- Required by the table's partition filter, and bounds the scan.
  AND occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 400 DAY)
ORDER BY occurred_at
"""


def fetch(project: str, dataset: str):
    """Pull training rows. Imports are local so --help works without the SDK."""
    from google.cloud import bigquery  # noqa: PLC0415

    client = bigquery.Client(project=project)
    return client.query(QUERY.format(project=project, dataset=dataset)).to_dataframe()


def build_features(df):
    """Assemble the feature matrix and the residual target.

    Every feature is knowable at booking time. Nothing derived from the outcome
    appears here — a feature computed from the actual duration would produce an
    excellent score and a useless model.
    """
    import pandas as pd  # noqa: PLC0415

    features = pd.DataFrame(
        {
            "distance_km": df["distance_km"].astype(float),
            "estimated_duration_minutes": df["estimated_duration_minutes"].astype(float),
            "hour_of_day": df["hour_of_day"].astype(int),
            "day_of_week": df["day_of_week"].astype(int),
            "is_weekend": df["day_of_week"].isin([1, 7]).astype(int),
            # Morning and evening commutes, when Gauteng traffic diverges most
            # from a free-flow estimate.
            "is_peak": df["hour_of_day"].isin([6, 7, 8, 16, 17, 18]).astype(int),
            "implied_speed_kmh": (
                df["distance_km"].astype(float)
                / (df["estimated_duration_minutes"].astype(float) / 60).clip(lower=0.01)
            ),
        }
    )

    for column in ("pickup_area", "dropoff_area", "vehicle_type"):
        dummies = pd.get_dummies(df[column].fillna("unknown"), prefix=column)
        features = pd.concat([features, dummies], axis=1)

    # Residual: how many minutes Maps was wrong by, signed.
    target = (
        df["actual_duration_minutes"].astype(float)
        - df["estimated_duration_minutes"].astype(float)
    )

    return features, target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="GCP project id")
    parser.add_argument("--dataset", default="ride_analytics")
    parser.add_argument("--output", default="artifacts/eta-model", type=Path)
    parser.add_argument(
        "--min-trips",
        type=int,
        default=MIN_TRIPS,
        help=f"Refuse to train below this many trips (default {MIN_TRIPS})",
    )
    args = parser.parse_args()

    print(f"Fetching completed trips from {args.project}.{args.dataset}…")
    df = fetch(args.project, args.dataset)
    n = len(df)
    print(f"  {n} usable trips (completed, with both a prediction and an outcome)")

    # ── The refusal ──────────────────────────────────────────
    if n < args.min_trips:
        print(
            f"\nREFUSING TO TRAIN: {n} trips is below the {args.min_trips}-trip threshold.\n"
            "\n"
            "This is deliberate, not a failure. Below this volume the model would fit\n"
            "noise, and its error bars would be wide enough to contain any answer while\n"
            "looking authoritative. The Google Maps ETA remains the estimate in use, and\n"
            "it is a strong baseline.\n"
            "\n"
            f"Collect {args.min_trips - n} more completed trips and run this again.\n"
            "Current progress is on the merchant portal's Analytics page.",
            file=sys.stderr,
        )
        return 1

    import numpy as np  # noqa: PLC0415
    from sklearn.metrics import mean_absolute_error  # noqa: PLC0415
    from xgboost import XGBRegressor  # noqa: PLC0415

    features, target = build_features(df)

    # Time-based split. A random split leaks future traffic patterns into
    # training and yields an optimistic score that will not survive production.
    split = int(len(features) * (1 - TEST_FRACTION))
    x_train, x_test = features.iloc[:split], features.iloc[split:]
    y_train, y_test = target.iloc[:split], target.iloc[split:]
    print(f"  train {len(x_train)} · test {len(x_test)} (split by time, not at random)")

    model = XGBRegressor(
        n_estimators=300,
        max_depth=4,  # Shallow on purpose: a small dataset overfits deep trees.
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
    )
    model.fit(x_train, y_train)

    predicted_residual = model.predict(x_test)
    maps_estimate = x_test["estimated_duration_minutes"].to_numpy()
    actual = maps_estimate + y_test.to_numpy()
    model_estimate = maps_estimate + predicted_residual

    baseline_mae = mean_absolute_error(actual, maps_estimate)
    model_mae = mean_absolute_error(actual, model_estimate)
    improvement = (baseline_mae - model_mae) / baseline_mae * 100 if baseline_mae else 0.0

    print("\nEvaluation (held-out, most recent trips)")
    print(f"  Google Maps baseline MAE : {baseline_mae:.2f} min")
    print(f"  Model MAE                : {model_mae:.2f} min")
    print(f"  Improvement              : {improvement:+.1f}%")

    # ── The ship criterion ───────────────────────────────────
    if model_mae >= baseline_mae:
        print(
            "\nMODEL DOES NOT BEAT THE BASELINE. Not saving.\n"
            "\n"
            "Google's ETA is already accurate on this data. That is a legitimate\n"
            "finding, not a failure — deploying a model that performs worse than a\n"
            "call already being made would add cost, latency and a failure mode for\n"
            "nothing.",
            file=sys.stderr,
        )
        return 2

    args.output.mkdir(parents=True, exist_ok=True)
    model.save_model(args.output / "model.json")

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_trips": int(n),
        "n_train": int(len(x_train)),
        "n_test": int(len(x_test)),
        "baseline_mae_minutes": float(baseline_mae),
        "model_mae_minutes": float(model_mae),
        "improvement_percent": float(improvement),
        "target": "residual_vs_maps_estimate",
        "data_source": "bigquery_production_trips",
        "features": list(features.columns),
        "top_features": {
            str(k): float(v)
            for k, v in sorted(
                zip(features.columns, model.feature_importances_),
                key=lambda kv: kv[1],
                reverse=True,
            )[:10]
        },
    }
    (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2))

    print(f"\nSaved to {args.output}/")
    print(
        "\nNot deployed. Deploying a Vertex AI endpoint is a separate step with real\n"
        "ongoing cost — see docs/vertex-ai-eta-model.md, including the scale-to-zero\n"
        "429 behaviour that requires a Maps fallback on the booking path."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
