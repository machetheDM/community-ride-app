# 0005. The API app serves the public event pages; no `apps/web` yet

- Status: Accepted
- Decided: 19 November 2026

## Context

PLAN.md 3.2 asked for a public website (`apps/web`) with event pages whose link preview shows
the poster. Today that site would be one page per event, a list of events and a poster image.
Nothing is deployed and no GCP project exists.

## Decision

- **Where the page lives.** The event page is `apps/api/src/app/e/[slug]/page.tsx`, a server
  component in the API's Next.js app. Its Open Graph tags come from `generateMetadata`.
- **Where its data comes from.** `GET /api/events`, `GET /api/events/{slug}` and the poster
  route.
- **Its own headers.** `src/proxy.ts` covers `/api` only, so `apps/api/next.config.ts` sets the
  page's headers:
  - a CSP that allows no third-party origin;
  - `form-action 'none'`;
  - no framing.
- **Visit counting.** Each page view counts one visit under its `?src=` channel. Link-preview
  crawlers are not counted, and nothing about the visitor is recorded.

## Alternatives considered

- **A separate `apps/web`.** That means a second Next.js app, image, Cloud Run service,
  domain, CI job and set of headers for a handful of pages. It becomes worth it when the site
  grows (venue pages, ticket sales, a blog), not before.
- **Pages in the merchant portal.** Rejected. The portal is the admin's, and adding anonymous
  pages to it widens the set of paths the admin session cookie is sent to.

## Consequences

- One deploy carries both the public pages and the API, so one outage takes down both.
- Like the portal's, the CSP keeps `'unsafe-inline'` for scripts until a per-request nonce is
  set. This is an open item in AGENTS.md.
- If `apps/web` is built later, `/e/{slug}` must keep working, because every shared post
  links to it.

## How we know it holds

`events.int.test.ts` checks that:

- drafts and cancelled events answer 404;
- the poster is served with caching and `nosniff`;
- crawler fetches are not counted.
