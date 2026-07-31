/**
 * Artifact Registry and Cloud Run.
 *
 * Cloud Run is the scaling story for this platform: pay per request, scale to zero
 * when idle, scale up automatically as ride volume grows across new townships.
 * During the growth phase `min_instances = 0` means an idle service costs nothing
 * — the trade-off being a cold start on the first request after a quiet period.
 * See docs/cloud-run-deployment.md for when to change that and why.
 */

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "community-ride"
  description   = "Container images for the API and merchant portal"
  format        = "DOCKER"

  # Untagged images accumulate on every rebuild and are billed as storage
  # indefinitely. Nothing depends on an untagged layer after a week.
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  cleanup_policies {
    id     = "keep-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  depends_on = [
    google_project_service.required,
    google_billing_budget.monthly,
  ]
}

/**
 * The API service.
 *
 * Created only once `api_image` is set — on a first apply there is no image to
 * deploy yet, and Cloud Run cannot create a service without one. Push an image,
 * then set the variable and apply again. See infra/gcp/README.md.
 */
resource "google_cloud_run_v2_service" "api" {
  count = var.api_image != "" ? 1 : 0

  name     = "community-ride-api"
  location = var.region

  # Requests only reach the container through Google's front end.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    containers {
      image = var.api_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # CPU is throttled between requests rather than always allocated. On a
        # request/response API this is the cheaper mode; it would be wrong only if
        # background work had to continue after a response was sent.
        cpu_idle = true
      }

      ports {
        container_port = 8080
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "BIGQUERY_DATASET"
        value = google_bigquery_dataset.analytics.dataset_id
      }
      env {
        name  = "BIGQUERY_LOCATION"
        value = var.bigquery_location
      }

      # Secrets are mounted by reference. The value never appears in the Terraform
      # configuration, in state, or in the service's environment as plaintext in
      # any console view.
      dynamic "env" {
        for_each = {
          DATABASE_URL                  = "database-url"
          DIRECT_URL                    = "database-url"
          JWT_SECRET                    = "jwt-secret"
          GOOGLE_MAPS_SERVER_KEY        = "google-maps-server-key"
          ANALYTICS_HASH_SALT           = "analytics-hash-salt"
          FIREBASE_SERVICE_ACCOUNT_JSON = "firebase-service-account"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 5
        timeout_seconds       = 3
        period_seconds        = 5
        # Generous: a cold start from zero has to boot Node and open a database
        # pool. Too few failures here turns a slow start into a crash loop.
        failure_threshold = 10
      }

      liveness_probe {
        http_get {
          path = "/api/health"
          port = 8080
        }
        initial_delay_seconds = 20
        timeout_seconds       = 3
        period_seconds        = 30
        failure_threshold     = 3
      }
    }

    # Bounded so a hung upstream cannot hold an instance — and therefore billing —
    # open indefinitely.
    timeout = "60s"

    max_instance_request_concurrency = 80
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_billing_budget.monthly,
    google_secret_manager_secret_iam_member.api_access,
  ]

  lifecycle {
    # CI deploys new revisions with `gcloud run deploy`, so the live image drifts
    # from whatever `api_image` says. Without this, every subsequent `terraform
    # apply` would roll the service back to the variable's value.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

/**
 * Public access to the API.
 *
 * The mobile apps are unauthenticated clients from Cloud Run's perspective —
 * authorisation happens inside the app via JWT, and every route that matters calls
 * requireAuth. This makes the *network* public, not the data.
 */
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count = var.api_image != "" ? 1 : 0

  location = google_cloud_run_v2_service.api[0].location
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
