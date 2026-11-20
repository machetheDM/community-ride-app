# 0007. GCP is the only cloud; Meta is the only outside service

- Status: Accepted
- Decided: 4 November 2026

## Context

Each project in the author's portfolio is assigned one cloud (`CAREER-TARGET.md` §2b). This
project's cloud is GCP. The customers are on Facebook.

## Decision

- The cloud services are Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, BigQuery,
  Vertex AI and Maps Platform.
- They are all defined as Terraform in `infra/gcp` and deployed through Workload Identity
  Federation.
- Meta (the Facebook page and paid promotion) is the one service outside GCP.

## Alternatives considered

- **Supabase for the database**, which is where the project began. The old `.env` still
  points at it. It is not used for tests or migrations and will not be the production
  database.

## Consequences

- Nothing is deployed and no GCP project exists yet. The Terraform is CONFIGURED but has never
  been applied; the owner applies it in Phase 5.

## How we know it holds

- CI validates `infra/gcp` and scans it with Checkov, and the Terraform has no provider other
  than Google's.
