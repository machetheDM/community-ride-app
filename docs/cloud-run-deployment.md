# Cloud Run — the scaling path

**Status: configured, not deployed.** The Dockerfile and Terraform exist; no service is running.

## Why Cloud Run

Cloud Run provides serverless container scaling — pay only for actual requests, scale to zero when
idle, scale up automatically as ride volume grows across new townships. For a platform expanding
one township at a time, that shape matches the business: infrastructure cost tracks real usage
rather than provisioned capacity sitting idle between morning and evening peaks.

It is documented as a *path*, not a migration. Nothing about the app requires it — the same image
runs anywhere, and the API currently runs wherever it is hosted today.

## The image

`apps/api/Dockerfile`, built **from the repository root**:

```bash
docker build -f apps/api/Dockerfile -t community-ride-api .
```

The context is the root, not `apps/api`, because the API imports four workspace packages
(`@ride/db`, `@ride/maps-service`, `@ride/push-service`, `@ride/analytics`) as raw TypeScript. A
build scoped to the app directory cannot see them.

Three things in it are less obvious than they look:

**`outputFileTracingRoot`** in `next.config.ts` must point at the monorepo root. Left at its default,
Next infers the root from the app directory, traces only what it can see beneath it, and silently
omits the workspace packages — producing an image that builds cleanly and then crashes on the first
request with a module resolution error.

**`HOSTNAME=0.0.0.0`.** Next binds localhost by default, and a container bound to localhost fails
Cloud Run's health check with no useful error message.

**The healthcheck uses `node -e`, not `curl` or `wget`.** Neither binary exists in `node:20-alpine`.
A probe that exits −1 because the binary is missing is indistinguishable from an unhealthy service —
this exact mistake left every service in a sibling project's compose stack permanently `unhealthy`,
which then looked like a startup-ordering problem for a long time before anyone checked whether
`curl` was installed.

CI builds the image on every PR (`docker` job) but never pushes it. A Dockerfile that cannot build
is caught in review rather than at deploy time.

## Cold starts and `min_instances`

`min_instances = 0` during the growth phase: an idle service costs nothing. The cost is a cold start
on the first request after a quiet period — Node boots, the Prisma pool opens, roughly 1–3 seconds.

That matters unevenly across this app:

| Path | Cold start impact |
|---|---|
| Browsing stores | Barely noticeable |
| Booking a ride | Noticeable |
| **Driver matching** | **Genuinely bad** — a driver deciding whether to accept |

**Raise `min_instances` to 1 when** traffic is consistent enough that most requests would hit a warm
instance anyway — practically, once there is steady daily ride volume rather than a handful of trips
clustered at unpredictable times. At that point the idle cost is small relative to revenue and the
latency is user-visible often enough to matter.

Concretely: keep 0 while trips are sporadic; move to 1 when there is reliable weekday demand; scale
`max_instances` up when peak-hour requests start queuing.

```hcl
# infra/gcp/terraform.tfvars
cloud_run_min_instances = 1
```

`cpu_idle = true` is set: CPU is throttled between requests rather than always allocated. That is
the cheaper mode for a request/response API and would only be wrong if background work had to
continue after a response was sent.

## Deploying

Full ordered steps in [`infra/gcp/README.md`](../infra/gcp/README.md). In short: push an image to
Artifact Registry, set `api_image`, `terraform apply`.

Terraform ignores changes to the container image after creation, so CI can deploy revisions with
`gcloud run deploy` without a later `terraform apply` rolling the service back to whatever the
variable says.

## Cost

At `min_instances = 0` an idle service is effectively free — Cloud Run's free tier covers 2 million
requests, 360,000 GiB-seconds of memory and 180,000 vCPU-seconds per month, which is far beyond
current volume.

Cost begins with sustained traffic, and scales with it. `max_instances = 4` is a ceiling on both
load and spend; raise it deliberately.

## Not deployed yet

Deploying is the first step in this stack with ongoing cost, and requires explicit approval.
