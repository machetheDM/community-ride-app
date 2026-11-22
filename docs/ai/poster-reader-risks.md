# The poster reader's risks

Written 19 November 2026 for `docs/PLAN.md` 4.8. Feature: `packages/poster-reader`. Decision:
`docs/adr/0008-poster-reader.md`. Threats, with OWASP and MITRE ATLAS IDs: `docs/threat-model.md`
section 6 (rows AI-1 to AI-8).

## NIST AI 600-1: the generative-AI risks that apply (PRACTICES ML-8)

NIST AI 600-1 (July 2024) names twelve risks particular to generative AI. Each is listed below,
whether it applies to a model that reads posters and proposes six text fields, and the control.

| Risk | Applies? | Control | State |
|---|---|---|---|
| CBRN information or capabilities | No: the model reads a poster and returns six fields; it is never asked anything | — | — |
| Confabulation | **Yes.** A model may invent a date, a price or a time the poster doesn't print | The prompt says to use null rather than guess. Dates must be real and ahead (`src/check.ts`). An admin compares every field with the poster before applying it | DONE in code; accuracy not measured (no live run) |
| Dangerous, violent or hateful content | Low. A poster could carry it, and a description could repeat it | The admin reads the description before applying it; the public page shows only what was applied | DONE (admin review) |
| Data privacy | **Yes.** A poster can print an organiser's personal phone number; the image goes to Google | Only the poster image is sent, never customer data. Email addresses are set aside. The raw answer isn't stored. The region, and so where processing happens, is to be chosen and written down (POPIA s72) | OPEN: region not chosen |
| Environmental impacts | Low: a few posters a month, at most 10 reads per event a day | The per-event cap (`READS_PER_EVENT_PER_DAY`) | DONE |
| Harmful bias or homogenization | Low. It may read posters in local languages worse than English ones | Measure it once real posters in Setswana, isiZulu and Sesotho are labelled; the manual form remains | PLANNED |
| Human-AI configuration | **Yes.** An admin may come to trust the proposal and stop checking | Proposals are applied field by field from a table showing the poster's reading beside the draft. Fields set aside show their reasons. Publishing is a separate step. Applied readings are audited (`event.poster_reading.apply`) | DONE |
| Information integrity | **Yes.** A wrong date or a planted link on a public page strands people or defrauds them | Links are set aside; the venue is never applied; the admin applies and then publishes | DONE |
| Information security | **Yes.** Prompt injection through the poster | A fixed schema with no actions, answers with extra keys discarded, instruction-like text set aside, a canary for instruction leaks, no tools, red-team set in CI | DONE for the defences; live model untested |
| Intellectual property | Low. The poster is the venue's, sent to us to publish under the partner agreement (`Venue.agreementNote`) | Only partner venues' events can be published (Phase 3) | DONE |
| Obscene, degrading or abusive content | Low, as for violent content | Admin review | DONE (admin review) |
| Value chain and component integration | **Yes.** It depends on a hosted model whose behaviour can change under the same name | The model version the answer reports is recorded on every call (`ModelCall.model`). A new prompt version needs a new live run before its accuracy is claimed. Client libraries are pinned and audited | DONE in code |

## CSA AI Controls Matrix (PRACTICES SEC-5)

**PLANNED.** The AICM's domain and control identifiers have not been checked against the
published matrix; PRACTICES lists its version as unconfirmed. Until they are, no IDs are written
here, rather than plausible-looking ones. The controls they would map are the ones in the tables
above and in ADR 0008.

## NIST SP 800-218A, the SSDF's generative-AI profile (PRACTICES DSO-8)

**PLANNED.** The profile is marked "to be read" in PRACTICES. The task table waits for that
reading, for the same reason.
