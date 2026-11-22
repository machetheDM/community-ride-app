/**
 * The admin's side of the poster reader (docs/PLAN.md 4.3 and 4.4, ADR 0008).
 *
 * Pure, like event-forms.ts, so the API's test suite checks it. The rules:
 *  - a poster is read only for a draft with a poster, only when the switch is on,
 *    and at most READS_PER_EVENT_PER_DAY times a day per event (each read costs);
 *  - a proposal reaches the draft only through applyPosterReading, field by field
 *    as the admin ticks them, and only after the same checks run again and the
 *    portal's own event form accepts the result;
 *  - the venue name is shown for checking and never applied: an event's venue is
 *    the partner it was created under, not whatever a poster says;
 *  - nothing here publishes. Publishing stays the separate Publish button.
 */
import { checkAnswer, FIELD_NAMES, type FieldName, type PosterFields, type ReaderConfig, type SetAside } from "@ride/poster-reader";
import { parseEventForm, type EventInput, type FormResult } from "./event-forms";

export const READS_PER_EVENT_PER_DAY = 10;

/** The fields an admin may apply; venueName is for checking only. */
export const APPLICABLE_FIELDS = ["title", "startsAt", "endsAt", "ticketInfo", "description"] as const satisfies readonly FieldName[];
export type ApplicableField = (typeof APPLICABLE_FIELDS)[number];

export function readingRefusal(
  config: ReaderConfig,
  event: { status: string; posterSha256: string | null },
  readsToday: number
): string | null {
  if (!config.enabled) return config.reason;
  if (event.status !== "DRAFT") return "Only a draft's poster can be read";
  if (!event.posterSha256) return "Upload the poster first";
  if (readsToday >= READS_PER_EVENT_PER_DAY) return `This poster has been read ${READS_PER_EVENT_PER_DAY} times today; fill in the rest by hand`;
  return null;
}

/** A date as the portal's form takes it: South African local time, 2026-12-05T18:00. */
export function sastLocal(date: Date): string {
  return new Date(date.getTime() + 2 * 3_600_000).toISOString().slice(0, 16);
}

/** Reads a stored proposal back. Anything that is not a plain string field is ignored. */
export function storedProposal(json: unknown): PosterFields {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const fields: PosterFields = {};
  for (const name of FIELD_NAMES) {
    const value = (json as Record<string, unknown>)[name];
    if (typeof value === "string") fields[name] = value;
  }
  return fields;
}

export function storedSetAside(json: unknown): SetAside[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (s): s is SetAside =>
      !!s && typeof s === "object" && typeof (s as SetAside).field === "string" && typeof (s as SetAside).reason === "string"
  );
}

export interface CurrentEvent {
  venueId: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  ticketInfo: string | null;
  description: string | null;
}

/**
 * What applying the ticked fields would make of the draft. The proposal is
 * checked again first, because time has passed (a start that was ahead may not
 * be now) and because a stored row is data, not something to trust. Then the
 * draft's current values fill every field not ticked, and the whole goes
 * through the same parser as the admin's own event form.
 */
export function applyProposal(
  proposal: PosterFields,
  ticked: unknown,
  current: CurrentEvent,
  now = new Date()
): FormResult<EventInput> & { applied?: ApplicableField[] } {
  const wanted = Array.isArray(ticked) ? ticked.filter((f): f is ApplicableField => (APPLICABLE_FIELDS as readonly unknown[]).includes(f)) : [];
  if (wanted.length === 0) return { ok: false, errors: { fields: "Tick at least one field to apply" } };

  const recheck = checkAnswer(JSON.stringify(Object.fromEntries(FIELD_NAMES.map((f) => [f, proposal[f] ?? null]))), now);
  if (!recheck.ok) return { ok: false, errors: { fields: recheck.reason } };
  const missing = wanted.filter((f) => recheck.fields[f] === undefined);
  if (missing.length) return { ok: false, errors: { fields: `No usable value for ${missing.join(", ")} any more; untick it` } };

  const pick = (f: ApplicableField, fallback: string | null) => (wanted.includes(f) ? recheck.fields[f]! : fallback);
  const input = {
    venueId: current.venueId,
    title: pick("title", current.title),
    startsAt: pick("startsAt", sastLocal(current.startsAt)),
    endsAt: pick("endsAt", current.endsAt ? sastLocal(current.endsAt) : ""),
    ticketInfo: pick("ticketInfo", current.ticketInfo ?? ""),
    description: pick("description", current.description ?? ""),
  };
  const parsed = parseEventForm(input, now);
  return parsed.ok ? { ...parsed, applied: wanted } : parsed;
}
