variable "project_id" {
  description = "GCP project ID, e.g. community-ride-prod"
  type        = string
}

variable "project_number" {
  description = "GCP project number (numeric). Required by the budget filter, which takes a number rather than an ID."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID, e.g. 01ABCD-234567-89EFGH"
  type        = string
}

variable "region" {
  description = "Primary region. africa-south1 (Johannesburg) keeps latency low for Gauteng users and keeps trip data in-country."
  type        = string
  default     = "africa-south1"
}

variable "monthly_budget_usd" {
  description = <<-EOT
    Monthly spending alert threshold in USD.

    Deliberately low. Expected spend at current volume is $0 — Maps SDK rendering
    and session-token autocomplete are free at unlimited volume, FCM is free, and
    BigQuery sits far inside the free tier. This is sized to catch a leaked key or
    a retry loop, not to accommodate growth. Raise it when real revenue justifies
    real spend.
  EOT
  type        = number
  default     = 25

  validation {
    condition     = var.monthly_budget_usd > 0 && var.monthly_budget_usd <= 500
    error_message = "Budget must be between 1 and 500 USD. A higher ceiling should be a deliberate, reviewed decision rather than a typo."
  }
}

variable "budget_notification_channels" {
  description = "Optional Cloud Monitoring notification channel IDs for budget alerts. Billing account admins are notified regardless."
  type        = list(string)
  default     = null
}

variable "bigquery_dataset_id" {
  description = "BigQuery dataset for trip and order analytics"
  type        = string
  default     = "ride_analytics"
}

variable "bigquery_location" {
  description = "BigQuery dataset location. Cannot be changed after creation without recreating the dataset."
  type        = string
  default     = "africa-south1"
}

variable "analytics_table_expiration_days" {
  description = <<-EOT
    Partition expiry for analytics tables.

    A retention limit rather than unlimited storage: these rows describe real
    people's movements, so keeping them forever is a liability that grows on its
    own. Long enough for year-on-year comparison, bounded enough to be defensible.
  EOT
  type        = number
  default     = 400
}

variable "github_repository" {
  description = "owner/repo allowed to deploy via Workload Identity Federation, e.g. machetheDM/community-ride-app"
  type        = string
}

variable "cloud_run_min_instances" {
  description = <<-EOT
    Minimum Cloud Run instances.

    0 during the growth phase: the service scales to zero and costs nothing when
    idle. The trade-off is a cold start on the first request after a quiet period,
    which on the driver-matching path is user-visible. Raise to 1 once traffic is
    consistent enough that cold starts outweigh the idle cost — see
    docs/cloud-run-deployment.md.
  EOT
  type        = number
  default     = 0
}

variable "cloud_run_max_instances" {
  description = "Maximum Cloud Run instances. A ceiling on both load and spend."
  type        = number
  default     = 4
}

variable "api_image" {
  description = "Fully-qualified container image for the API. Set after the first push to Artifact Registry."
  type        = string
  default     = ""
}
