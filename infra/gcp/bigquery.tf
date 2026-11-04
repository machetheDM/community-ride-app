/**
 * BigQuery — trip and order analytics.
 *
 * Schemas come from packages/analytics/schema/*.json so there is exactly one
 * definition. A drift between the table and the TypeScript event shape does not
 * error — BigQuery streaming silently drops unknown fields — so it would show up
 * as quietly missing columns rather than a failure. Reading the same files here
 * removes the opportunity.
 */

resource "google_bigquery_dataset" "analytics" {
  dataset_id                 = var.bigquery_dataset_id
  location                   = var.bigquery_location
  description                = "Completed trip and order events. Identifiers are pseudonymised before insertion."
  delete_contents_on_destroy = false

  # Dataset-level access is granted through additive IAM members in iam.tf rather
  # than `access` blocks here. An `access` block replaces the dataset's default
  # access list wholesale, which silently removes the project owners' own
  # permissions — easy to do and confusing to diagnose.

  labels = {
    component = "analytics"
    contains  = "pseudonymised-movement-data"
  }

  depends_on = [
    google_project_service.required,
    google_billing_budget.monthly,
  ]
}

/**
 * Trips.
 *
 * Partitioned by day on `occurred_at` so every date-bounded query scans one
 * partition instead of the table — this is what keeps the 1 TiB/month free query
 * tier intact as the table grows. Clustered on `pickup_area` because every
 * dashboard query groups or filters by township.
 */
resource "google_bigquery_table" "trips" {
  dataset_id          = google_bigquery_dataset.analytics.dataset_id
  table_id            = "trips"
  description         = "One row per completed or cancelled trip"
  deletion_protection = true

  time_partitioning {
    type                     = "DAY"
    field                    = "occurred_at"
    expiration_ms            = var.analytics_table_expiration_days * 24 * 60 * 60 * 1000
    require_partition_filter = true
  }

  clustering = ["pickup_area"]

  schema = file("${path.module}/../../packages/analytics/schema/trips.json")

  depends_on = [google_billing_budget.monthly]
}

resource "google_bigquery_table" "orders" {
  dataset_id          = google_bigquery_dataset.analytics.dataset_id
  table_id            = "orders"
  description         = "One row per delivered or cancelled marketplace order"
  deletion_protection = true

  time_partitioning {
    type                     = "DAY"
    field                    = "occurred_at"
    expiration_ms            = var.analytics_table_expiration_days * 24 * 60 * 60 * 1000
    require_partition_filter = true
  }

  clustering = ["delivery_area"]

  schema = file("${path.module}/../../packages/analytics/schema/orders.json")

  depends_on = [google_billing_budget.monthly]
}
