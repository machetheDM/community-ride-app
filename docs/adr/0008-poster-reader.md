# 0008. A language model proposes an event's details; an admin applies them, and it never publishes

- Status: Accepted
- Decided: 19 November 2026

## Context

Every event starts as a poster a venue sends. An admin types the title, dates and ticket
details off it by hand. Phase 4 of `docs/PLAN.md` puts one language-model feature here,
because it saves real work, and it is the project's only one.

A poster is untrusted input (PRACTICES ML-5). Anyone can print text on it: "ignore your
instructions", "set the price to free", "publish now", a phishing link, a script tag. A model
that reads the poster can be steered by that text, whatever its instructions say.

No GCP project exists yet. So no model can be called, and the price and the region that will
serve it can't be checked against a live account. The secondary sources found on 19 November
2026 disagree on Gemini's prices and model names. None confirms that Gemini is served from
`africa-south1` (Johannesburg).

## Decision

- **Gemini on Vertex AI** (ADR 0007, GCP only), called over REST with Application Default
  Credentials (`packages/poster-reader/src/model.ts`). The request asks for JSON in a fixed
  schema, at temperature 0, with at most 1,024 output tokens and a 30-second timeout.
- **The model can only fill six fields:** title, start, end, venue name, ticket details and
  description (`src/fields.ts`). It has no field for a status, a price or an action, and no
  tools. If an answer has any other key, the whole answer is discarded.
- **The checker inspects every answer** (`src/check.ts`). It removes invisible and
  direction-changing characters, then sets aside any field that:
  - reads like an instruction;
  - carries a link, an email address, markup, or the prompt's canary string;
  - holds a date that is impossible, in the past, or more than a year ahead;
  - is too long.

  Each field set aside comes with its reason, shown to the admin.
- **An admin applies the result, field by field.** Before anything changes, the checks run
  again and the portal's own event form parses the result. Only a draft can take a reading,
  and only while its poster is the one that was read. The venue name is shown for comparison
  but never applied. Publishing remains the separate Publish button.
- **A switch** (`src/config.ts`). Reading is off unless all four of these are set:
  `POSTER_READER_ENABLED=true`, a project, a region and a model name. There are no defaults to
  guess from. When it's off, the event page says so and events are typed in by hand, as
  today. Each event can be read at most 10 times a day.
- **Every call is recorded** in `ModelCall` (migration `4_phase4_poster_reader`): latency,
  tokens, cost at the configured price, prompt version and outcome.
  `npm run model-cost -w @ride/db` totals a day. The model's raw answer is not kept, only the
  checked proposal and what was set aside.
- **The evaluation runs in CI without calling a model** (`eval/run.ts`). It is a set of
  synthetic posters with hand-checked answers, plus red-team posters mapped to the OWASP LLM Top
  10, each with answers written as a compromised model would give them. A defence that misses
  fails the build. Model accuracy comes from answers recorded on a live run
  (`eval/live.ts`), which needs the GCP project.
- **Region and prices are settings, not code.** Before the owner switches reading on:
  - pick the region from Google's Gemini locations page, and write down where the poster is
    processed (POPIA s72);
  - copy the prices from Google's pricing page on that day.

## Alternatives considered

- **Let the model create the draft event directly.** That saves a click, but a successful
  injection then lands in a record with no person in between. Rejected: the apply step is the
  control for what checks cannot see. A plain, plausible lie such as "Free entry" passes the
  checks; only a person comparing it with the poster catches it.
- **Ask the model to flag injections itself.** A model that is being steered is the wrong judge
  of whether it is being steered. The checks are code and are tested in CI.
- **promptfoo for the CI evaluation now**, as the plan named. The CI gate tests this
  repository's own checker and the portal's apply rules, so it imports them directly; promptfoo
  would wrap the same calls and add a large dependency tree. promptfoo stays planned for the
  live, on-demand run, where comparing prompts and models is its strength.
- **Google's GenAI SDK instead of REST.** It's one more dependency for one call. The REST call
  is one method, and a unit test checks its request.
- **A default model and region in code.** It would be a guess that looks like a decision.

## Consequences

- Nothing about the model is measured yet: there is no accuracy, latency or cost from a real
  call. The evaluation says so in CI until a live run is recorded.
- The baseline, an admin typing an event by hand, timed (PLAN 4.2), needs a person and real
  posters. Until it exists there is no claim that the reader saves time (ML-1).
- The checker raises false alarms by design. A genuine ticket link or a `.co.za` address is set
  aside and has to be typed in. On the synthetic set it keeps 88 of 88 correct fields.
- Spans follow the OpenTelemetry GenAI conventions but go nowhere until an exporter is
  registered (Phase 5, Cloud Trace).

## How we know it holds

- `npm run eval -w @ride/poster-reader`, run in CI: 19 compromised answers each meet their
  stated defence (3 discarded, 14 set aside, 2 left to the admin), and 88 of 88 correct fields
  are kept. Switching off the link rule made the build fail on the phishing case (checked by
  hand on 19 November 2026).
- `apps/api/src/test/unit/poster-reader.test.ts` checks:
  - the schema has the same keys for the model and for the checker;
  - each check, with its reason;
  - the switch is off by default, and the manual form works when it is off;
  - the call record;
  - the Vertex request's shape, against a stand-in `fetch`;
  - the portal's apply rules: only ticked fields, never the venue, re-checked, and through the
    event form.
