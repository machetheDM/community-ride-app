# GCP infrastructure

**Nothing here has been applied.** No GCP project exists. These are the ordered steps to bring it
up, written so each cost-incurring action is a deliberate decision rather than a side effect.

Read [`docs/gcp-architecture.md`](../../docs/gcp-architecture.md) first.

## Before you start

You will need the `gcloud` CLI, Terraform ≥ 1.9, and a billing account. Every command below is run
by **you** — none of these steps should be handed to an assistant, because they involve your billing
account and your credentials.

## 1. Project and billing

```bash
gcloud projects create community-ride-prod --name="Community Ride"
gcloud config set project community-ride-prod
gcloud billing accounts list
gcloud billing projects link community-ride-prod --billing-account=BILLING_ACCOUNT_ID
```

Note the **project number** — the budget resource needs it, and it is not the project ID:

```bash
gcloud projects describe community-ride-prod --format='value(projectNumber)'
```

## 2. Terraform state

Local state on a laptop is a single point of failure and will contain resource metadata. Use a
bucket with versioning, so a corrupted apply can be rolled back:

```bash
gcloud storage buckets create gs://community-ride-tfstate --location=africa-south1
gcloud storage buckets update gs://community-ride-tfstate --versioning
```

Then create `backend.tf`:

```hcl
terraform {
  backend "gcs" {
    bucket = "community-ride-tfstate"
    prefix = "infra/gcp"
  }
}
```

## 3. First apply — no billable resources yet

```bash
cp terraform.tfvars.example terraform.tfvars   # fill in your values
terraform init
terraform plan
```

**Read the plan before applying.** The budget alert is created first and everything billable depends
on it, so the ordering in the plan should show that.

```bash
terraform apply
```

This creates the budget, enabled APIs, service accounts, the BigQuery dataset, Artifact Registry,
the WIF pool, and empty secret containers. Cloud Run is skipped while `api_image` is empty.

## 4. Secret values — out of band, never through Terraform

A value passed as a Terraform variable is written to state in plaintext. Add versions directly:

```bash
printf '%s' "$DATABASE_URL"  | gcloud secrets versions add database-url --data-file=-
printf '%s' "$JWT_SECRET"    | gcloud secrets versions add jwt-secret --data-file=-
printf '%s' "$MAPS_KEY"      | gcloud secrets versions add google-maps-server-key --data-file=-
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets versions add analytics-hash-salt --data-file=-
gcloud secrets versions add firebase-service-account --data-file=./firebase-sa.json
```

`printf` rather than `echo` — `echo` appends a newline that becomes part of the secret and produces
authentication failures that look nothing like a whitespace problem.

Delete `firebase-sa.json` afterwards. It should never be committed and should not linger on disk.

## 5. Maps API keys — two of them

In **APIs & Services → Credentials**, create:

**Server key** — restrict to *Geocoding API*, *Routes API*, *Places API (New)*. Application
restriction: **IP addresses**, set to the Cloud Run egress IP. This is the key that bills per
request; it goes in Secret Manager and never anywhere near an app bundle.

**Android key** — restrict to *Maps SDK for Android*. Application restriction: **Android apps**,
with package name `com.communityride.customer` (and the driver app) plus your signing certificate
SHA-1.

**iOS key** — restrict to *Maps SDK for iOS*, bundle ID restriction.

The app keys go in `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY` / `_IOS_KEY`. They ship inside the binaries
by design; that SKU is free at unlimited volume, so an extracted copy costs nothing.

## 6. Verify the budget before deploying anything

```bash
gcloud billing budgets list --billing-account=BILLING_ACCOUNT_ID
```

Confirm the alert exists and is set where you expect. A budget alert is **not** a spending cap —
GCP has no hard limit. It tells you; it does not stop anything.

## 7. Build and push the image

```bash
gcloud auth configure-docker africa-south1-docker.pkg.dev

# Context is the repo root — the API imports four workspace packages.
docker build -f apps/api/Dockerfile -t africa-south1-docker.pkg.dev/community-ride-prod/community-ride/api:v1 .
docker push africa-south1-docker.pkg.dev/community-ride-prod/community-ride/api:v1
```

## 8. Deploy Cloud Run

Set `api_image` in `terraform.tfvars` to the pushed image, then:

```bash
terraform plan
terraform apply
```

This is the **first step with ongoing cost**, though at `min_instances = 0` an idle service is
effectively free.

## 9. GitHub Actions deploy (optional)

```bash
terraform output workload_identity_provider
terraform output deployer_service_account
```

Set both as repository **variables** (not secrets — neither is one; the provider grants nothing on
its own and only this repository's workflows can exchange a token).

## What is deliberately not here

- **Vertex AI endpoint.** Deferred — one completed trip against a 200-trip threshold. See
  [`docs/vertex-ai-eta-model.md`](../../docs/vertex-ai-eta-model.md).
- **Pub/Sub between the API and BigQuery.** Direct streaming is simpler and sufficient at this
  volume. Pub/Sub becomes worthwhile when write volume justifies buffering, and the analytics
  package's interface does not change if it is added.
- **A production database.** Postgres stays on Supabase. Moving to Cloud SQL is a separate decision
  with its own cost profile and no current benefit.

## Tearing down

```bash
terraform destroy
```

BigQuery tables have `deletion_protection = true` and the dataset has
`delete_contents_on_destroy = false`, so **trip history survives a destroy** and must be removed
deliberately. That is intentional: analytics data is not reproducible, and a `destroy` typed in the
wrong terminal should not be able to erase it.
