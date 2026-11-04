/**
 * Secret containers — values are NOT managed here.
 *
 * Terraform creates the secret and grants access to it. It never receives the
 * value, because anything passed through a Terraform variable is written to the
 * state file in plaintext. State lives in a bucket, gets copied to laptops, ends
 * up in CI caches — it is a much softer target than Secret Manager, and putting a
 * secret in it while calling the result "managed secrets" is worse than not
 * bothering.
 *
 * `lifecycle.ignore_changes` on nothing here: there is no version resource to
 * drift. Add versions out of band, before the first Cloud Run deploy:
 *
 *   printf '%s' "$KEY" | gcloud secrets versions add google-maps-server-key --data-file=-
 *   printf '%s' "$SALT" | gcloud secrets versions add analytics-hash-salt --data-file=-
 *   gcloud secrets versions add firebase-service-account --data-file=./sa.json
 *
 * `printf` rather than `echo`: echo appends a newline, which becomes part of the
 * secret and produces authentication failures that look nothing like a trailing
 * whitespace problem.
 */

locals {
  secret_ids = [
    "google-maps-server-key",
    "analytics-hash-salt",
    "firebase-service-account",
    "database-url",
    "jwt-secret",
  ]
}

resource "google_secret_manager_secret" "runtime" {
  for_each  = toset(local.secret_ids)
  secret_id = each.value

  replication {
    auto {}
  }

  labels = {
    component = "runtime-config"
  }

  depends_on = [
    google_project_service.required,
    google_billing_budget.monthly,
  ]
}

/**
 * The API reads all of them.
 *
 * `secretAccessor` grants reading the value and nothing else — not listing
 * secrets, not adding versions, not deleting. Granted per secret, so adding an
 * unrelated secret to the project does not silently widen what the API can read.
 */
resource "google_secret_manager_secret_iam_member" "api_access" {
  for_each  = google_secret_manager_secret.runtime
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

/**
 * The portal reads only what it actually needs.
 *
 * It renders a dashboard from BigQuery and authenticates merchants. It has no use
 * for the Maps server key, the Firebase credentials, or the analytics salt — and
 * the salt in particular is what makes the pseudonymised ids in BigQuery
 * non-reversible, so the service that can *read* those ids is deliberately not
 * given the means to correlate them back.
 */
resource "google_secret_manager_secret_iam_member" "portal_access" {
  for_each  = toset(["database-url", "jwt-secret"])
  secret_id = google_secret_manager_secret.runtime[each.value].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.portal.email}"
}
