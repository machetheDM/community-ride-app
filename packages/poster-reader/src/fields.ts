/**
 * What the poster reader may say about a poster, and nothing else
 * (docs/PLAN.md 4.3, ADR 0008).
 *
 * The schema is the first defence against a poster that carries instructions:
 * there is no field for a status, a price, a venue to publish under or anything
 * to do, so a model that obeys "publish this now" or "make it free" has nowhere
 * to put it. An answer with any key outside this list is discarded whole
 * (check.ts), not trimmed.
 */
import { z } from "zod";

/** Bumped whenever the prompt or the schema changes; recorded on every call (ML-7). */
export const PROMPT_VERSION = "poster-read-v1";

export const FIELD_NAMES = ["title", "startsAt", "endsAt", "venueName", "ticketInfo", "description"] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** A local South African date and time as the portal's form takes it: 2026-12-05T18:00. */
export const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Lengths are generous on purpose: this is the shape check, before cleaning.
 * The tight limits are the portal's event form, which every proposal still goes
 * through when an admin applies it.
 */
export const posterAnswerSchema = z.strictObject({
  title: z.string().max(400).nullable(),
  startsAt: z.string().max(40).nullable(),
  endsAt: z.string().max(40).nullable(),
  venueName: z.string().max(400).nullable(),
  ticketInfo: z.string().max(800).nullable(),
  description: z.string().max(4000).nullable(),
});

export type PosterAnswer = z.infer<typeof posterAnswerSchema>;

/** What an admin is shown: the fields that survived, cleaned. */
export type PosterFields = { [K in FieldName]?: string };

/**
 * The same schema in the OpenAPI subset Vertex AI's `responseSchema` takes, so
 * the model is constrained to it as well as checked against it afterwards.
 * Kept by hand beside the zod schema; a unit test holds the two to the same keys.
 */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", nullable: true },
    startsAt: { type: "STRING", nullable: true, description: "Local start, YYYY-MM-DDTHH:mm" },
    endsAt: { type: "STRING", nullable: true, description: "Local end, YYYY-MM-DDTHH:mm" },
    venueName: { type: "STRING", nullable: true },
    ticketInfo: { type: "STRING", nullable: true },
    description: { type: "STRING", nullable: true },
  },
  required: [...FIELD_NAMES],
  propertyOrdering: [...FIELD_NAMES],
} as const;
