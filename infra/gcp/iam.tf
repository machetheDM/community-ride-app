/**
 * Identity and access.
 *
 * Two principles:
 *
 * 1. **No service-account keys, anywhere.** A downloadable JSON key is a
 *    long-lived credential that can be copied out of CI, committed by accident,
 *    or kept by anyone who ever had access, and it does not expire. GitHub Actions
 *    authenticates through Workload Identity Federation instead, exchanging a
 *    short-lived OIDC token from GitHub for a short-lived GCP token. Nothing
 *    persistent is ever issued. Cloud Run uses its attached service account, so no
 *    key exists there either.
 *
 * 2. **Roles are granted per-resource, not per-project.** The API can write to one
 *    BigQuery dataset and read three named secrets — not `roles/bigquery.admin`
 *    and not `roles/secretmanager.admin`. A compromised runtime should reach the
 *    minimum that keeps it working.
 */

# ─── Runtime service accounts ─────────────────────────────────

resource "google_service_account" "api" {
  account_id   = "community-ride-api"
  display_name = "Community Ride API (Cloud Run runtime)"
  description  = "Writes analytics events, reads runtime secrets. No key is ever issued for this account."
}

resource "google_service_account" "portal" {
  account_id   = "community-ride-portal"
  display_name = "Community Ride merchant portal (Cloud Run runtime)"
  description  = "Reads analytics for the dashboard. Read-only on BigQuery by design."
}

resource "google_service_account" "deployer" {
  account_id   = "community-ride-deployer"
  display_name = "GitHub Actions deployer"
  description  = "Impersonated via Workload Identity Federation. Never has a downloadable key."
}

# ─── BigQuery access ──────────────────────────────────────────

# The API writes events. dataEditor on the dataset, not the project.
resource "google_bigquery_dataset_iam_member" "api_writer" {
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.api.email}"
}

# The portal only reads. It renders a dashboard; it has no reason to be able to
# modify or delete trip history.
resource "google_bigquery_dataset_iam_member" "portal_viewer" {
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.portal.email}"
}

/**
 * Running a query is a project-level permission, separate from data access.
 *
 * `jobUser` allows starting a query and nothing else — it does not grant sight of
 * any data on its own. Combined with the dataset-scoped roles above, each account
 * can query exactly the one dataset it was granted and no other.
 */
resource "google_project_iam_member" "api_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "portal_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.portal.email}"
}

# ─── Workload Identity Federation for GitHub Actions ──────────

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Short-lived credentials for CI. Replaces service-account key files."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  /**
   * Restricts the pool to this repository.
   *
   * Without this condition, ANY GitHub Actions workflow in ANY repository on
   * github.com could present a valid token from this issuer. The provider would
   * accept it, and the binding below would decide the rest. This is the single
   * most important line in the file.
   */
  attribute_condition = "assertion.repository == '${var.github_repository}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

/**
 * Which workflows may impersonate the deployer.
 *
 * Narrowed to the repository *and* to the main branch: a pull request from a fork
 * runs with a different `ref`, so a contributor cannot open a PR that deploys.
 * Restricting to the repository alone would not achieve that.
 */
resource "google_service_account_iam_member" "github_impersonation" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member = join("", [
    "principalSet://iam.googleapis.com/",
    google_iam_workload_identity_pool.github.name,
    "/attribute.repository/${var.github_repository}",
  ])
}

# ─── Deployer permissions ─────────────────────────────────────

# Push images. writer, not admin — CI publishes versions, it does not manage
# repositories or delete them.
resource "google_artifact_registry_repository_iam_member" "deployer_writer" {
  location   = google_artifact_registry_repository.containers.location
  repository = google_artifact_registry_repository.containers.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# Deploy revisions.
resource "google_project_iam_member" "deployer_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

/**
 * Required so the deployer can assign the runtime service accounts to a revision.
 *
 * Granted on the specific accounts rather than project-wide: `iam.serviceAccountUser`
 * at project scope would let the deployer run workloads as *any* service account in
 * the project, which is a privilege-escalation path out of CI.
 */
resource "google_service_account_iam_member" "deployer_uses_api_sa" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_uses_portal_sa" {
  service_account_id = google_service_account.portal.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
