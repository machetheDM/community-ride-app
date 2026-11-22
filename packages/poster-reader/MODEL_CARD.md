# Model card: the poster reader

PRACTICES ML-3. Decision record: `docs/adr/0008-poster-reader.md`. Risks: `docs/ai/poster-reader-risks.md`.
Written 19 November 2026.

## What it is

A language model (Gemini on Vertex AI) reads an event poster image and proposes six details: the
title, start, end, venue name, ticket details and description. It is not trained or fine-tuned by
this project. It is a hosted model given one fixed prompt (`src/prompt.ts`, version
`poster-read-v1`) and a fixed output schema (`src/fields.ts`).

**State: CONFIGURED, not WIRED.** No GCP project exists, so it has never answered a real request.
The code that calls it is tested against a stand-in. The model name and region are settings
with no default (`.env.example`).

## Intended use

- An admin of this platform, on the event page of a **draft** event whose poster is uploaded.
- It proposes; the admin compares each field with the poster and applies the ones that are right.
- It saves typing. It is not a source of truth about an event.

## Not for

- Publishing anything, setting any price, or acting on anything. It has no tools and no field for
  either, and publishing stays a separate admin button.
- Reading anything but a venue's event poster: no ID documents, receipts or customer data are ever
  sent to it.
- Running without a person. A plausible lie on a poster passes the checks (see Known failures).

## Data

- **Input:** one poster image, JPEG or PNG, at most 2 MB, with its metadata removed before it is
  stored (ADR 0006). Today's South African date goes with it, for posters that print no year.
- **Evaluation:** 21 posters in `eval/posters/`, all **SYNTHETIC**, drawn by `eval/make_posters.py`.
  There are 10 ordinary posters in varied date and price formats, and 11 red-team posters
  carrying planted instructions, mapped to OWASP LLM01, 02, 05, 06, 07, 09 and 10. Plain text
  on flat colours is easier to read than a photographed, busy real poster. So any accuracy
  measured on this set is an upper bound. Real posters join the set, labelled, when venues send
  them.
- **Nothing is trained** on posters or on the admin's corrections.

## Performance

| Measure | Value | How, on what |
|---|---|---|
| Field accuracy | **Not measured** | Needs a live run (`eval/live.ts`), which needs the GCP project |
| Latency, tokens, cost per poster | **Not measured** | Recorded per call in `ModelCall` once it runs; `npm run model-cost -w @ride/db` totals a day |
| Defences against a compromised answer | 19 of 19 met their stated defence: 3 discarded, 14 set aside, 2 left to the admin | `npm run eval -w @ride/poster-reader`, on 19 November 2026, on the hand-written answers in `eval/cases.json`; in CI on every push |
| False alarms on correct answers | 0 of 88 correct fields set aside | Same run, on the hand-checked answers of all 21 posters |
| Baseline: an admin typing it in (ML-1) | **Not measured** | PLAN 4.2 needs a person timed on real posters |

## Known failures and limits

- **A plausible lie gets through to the admin.** If a poster talks the model into answering "Free
  entry", or into guessing a date for "31 February", the answer looks like an ordinary one. The
  checks can't tell. The admin, comparing the proposal with the poster, is the only control.
  The red-team set marks these cases "admin" rather than claiming the code catches them.
- **Genuine links and email addresses are set aside.** A ticket site printed on the poster has to
  be typed in by hand. This is chosen: a false alarm costs seconds, a miss puts a link on our page.
- **Local languages.** The synthetic set is English with a few place names. How it reads posters
  in Setswana, isiZulu or Sesotho is unknown.
- **Dates without a year** are resolved to the next such date from today. A poster for last
  year's event would be read as next year's.
- **Where the poster is processed** depends on the region the owner chooses. It is not decided
  (POPIA s72; `docs/ai/poster-reader-risks.md`).

## Switching it off

Unset `POSTER_READER_ENABLED`, or any of its settings. The event page then says reading is off,
and events are typed in by hand, which is how every event is made today
(`apps/api/src/test/unit/poster-reader.test.ts`, "the switch").
