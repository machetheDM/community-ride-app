# 0006. Posters live in Postgres, stripped of metadata, until there is a bucket

- Status: Accepted
- Decided: 18 November 2026

## Context

Venues send a few posters a month. A poster photographed on a phone can carry the sender's GPS
position, device and name in its metadata (threat model PL-8). No GCP project exists yet, so
there is no Cloud Storage bucket to keep them in.

## Decision

- Posters are stored in a `bytea` column on `Event`. Each is at most 2 MB, and only JPEG and
  PNG are accepted.
- `sanitizePoster` in `packages/db/src/poster.ts` rewrites each file without its metadata, in
  pure TypeScript:
  - for a JPEG it drops APP1 to APP13, APP15 and comments;
  - for a PNG it drops text, eXIf and time chunks;
  - it refuses anything it does not recognise.
- The public poster route serves only the posters of published events.

## Alternatives considered

- **Cloud Storage now.** It needs the GCP project the owner has not yet created, plus signed
  URLs.
- **Re-encoding with an image library such as sharp.** That adds a native dependency to the
  image, for a job that walking the file's markers already does.

## Consequences

- The database grows by a few MB a month. Once the bucket exists (Phase 5), the posters move
  there and a migration drops the column.

## How we know it holds

`poster.test.ts` checks that:

- a JPEG loses its EXIF (where a phone writes GPS), XMP and comments, and keeps its image data;
- a PNG loses its text, EXIF and time chunks;
- an unknown critical chunk, a file that is not an image and anything over 2 MB are refused.
