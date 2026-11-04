output "api_url" {
  description = "Public URL of the API service. Empty until an image is deployed."
  value       = var.api_image != "" ? google_cloud_run_v2_service.api[0].uri : ""
}

output "artifact_registry_repository" {
  description = "Docker repository path for pushing images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.containers.repository_id}"
}

output "bigquery_dataset" {
  description = "Analytics dataset — set as BIGQUERY_DATASET"
  value       = google_bigquery_dataset.analytics.dataset_id
}

output "api_service_account" {
  description = "Runtime identity of the API"
  value       = google_service_account.api.email
}

output "portal_service_account" {
  description = "Runtime identity of the merchant portal"
  value       = google_service_account.portal.email
}

output "deployer_service_account" {
  description = "Set as GCP_SERVICE_ACCOUNT in GitHub Actions"
  value       = google_service_account.deployer.email
}

output "workload_identity_provider" {
  description = <<-EOT
    Set as GCP_WORKLOAD_IDENTITY_PROVIDER in GitHub Actions.

    This is not a secret — it is an identifier. It grants nothing on its own: the
    provider only accepts a token from the configured repository, and only that
    repository's workflows can exchange one.
  EOT
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "secret_ids" {
  description = "Secret containers created here. Values are added out of band — see README.md."
  value       = [for s in google_secret_manager_secret.runtime : s.secret_id]
}

output "budget_amount_usd" {
  description = "Monthly spending alert threshold"
  value       = var.monthly_budget_usd
}
