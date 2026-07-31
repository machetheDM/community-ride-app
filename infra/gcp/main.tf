/**
 * Community Ride — GCP infrastructure.
 *
 * NOT YET APPLIED. No GCP project exists and nothing here has been provisioned.
 *
 * Two conventions run through this configuration and should be preserved:
 *
 * 1. The budget is created FIRST, and every billable resource carries
 *    `depends_on` on it. Terraform's dependency graph is otherwise free to
 *    create a Cloud Run service before the spending alert that is supposed to
 *    warn about it — leaving a window, however short, where cost can accrue
 *    unwatched. Ordering it explicitly costs nothing and closes that window.
 *
 * 2. Secrets are NEVER passed through Terraform. A value supplied as a variable
 *    lands in the state file in plaintext, and state is far easier to leak than
 *    Secret Manager. Terraform creates the secret *containers* and grants access
 *    to them; the versions are added out of band with `gcloud`. See README.md.
 */

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# ─── APIs ─────────────────────────────────────────────────────

/**
 * Services this project uses.
 *
 * `disable_on_destroy = false` deliberately: tearing down this configuration
 * should not disable APIs that other resources — or a future re-apply — depend
 * on. Disabling a service is a far wider blast radius than deleting the
 * resources Terraform created.
 */
resource "google_project_service" "required" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    # Maps and Places are billed per request; see docs/maps-platform-cost-estimate.md
    "routes.googleapis.com",
    "places.googleapis.com",
    "geocoding-backend.googleapis.com",
    "maps-android-backend.googleapis.com",
    "maps-ios-backend.googleapis.com",
    # Enabled now so the ETA model can be trained later without a config change.
    # Enabling a service costs nothing; only using it does.
    "aiplatform.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# ─── Budget — created before anything billable ────────────────

/**
 * Spending alert.
 *
 * This is an *alert*, not a cap: GCP has no hard spend limit, and anything
 * claiming otherwise is a script that reacts after the fact. Thresholds are set
 * low deliberately. At current volume the expected spend is $0 — Maps SDK
 * rendering and session-token autocomplete are free at unlimited volume, FCM is
 * free, and BigQuery sits far inside the free tier. So anything reaching even
 * 50% of this budget is a signal that something is wrong (a leaked key, a retry
 * loop), not that the business grew overnight.
 */
resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "community-ride-monthly"

  budget_filter {
    projects = ["projects/${var.project_number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  # 50% and 80% on actual spend give warning; the forecast rule fires when the
  # trend implies an overrun even if current spend is still low, which is the one
  # that catches a runaway early.
  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.8
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  dynamic "all_updates_rule" {
    for_each = var.budget_notification_channels != null ? [1] : []
    content {
      monitoring_notification_channels = var.budget_notification_channels
      disable_default_iam_recipients   = false
    }
  }

  depends_on = [google_project_service.required]
}
