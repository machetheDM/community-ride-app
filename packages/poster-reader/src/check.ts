/**
 * Checks a model's answer before an admin sees it (docs/PLAN.md 4.3, ADR 0008).
 *
 * Assume the model has been fully taken over by the poster it read. What it
 * can still do is limited here:
 *  - an answer that is not JSON, or has any key outside the schema (a
 *    `status`, a `price`), is discarded whole;
 *  - each text field is cleaned of control, zero-width and direction
 *    characters, and capped;
 *  - a field that reads like an instruction, carries a link, an email address,
 *    markup or the prompt's canary is set aside with the reason, not proposed;
 *  - dates must parse, lie ahead and come in order.
 *
 * What survives is a proposal. It reaches a draft event only when an admin
 * applies it, through the portal's own event form; publishing is a separate
 * admin step after that. The red-team set (eval/cases.json) runs every one of
 * these rules in CI against answers written as a compromised model would.
 */
import { FIELD_NAMES, LOCAL_DATE_TIME, posterAnswerSchema, type FieldName, type PosterFields } from "./fields";
import { PROMPT_CANARY } from "./prompt";

export interface SetAside {
  field: FieldName;
  reason: string;
  /** The start of what was set aside, cleaned, for the admin to see. */
  excerpt: string;
}

export type CheckResult =
  | { ok: true; fields: PosterFields; setAside: SetAside[] }
  | { ok: false; reason: string };

/** Longest a cleaned field may be; the portal form's own limits are tighter still. */
const MAX_LENGTH: Record<FieldName, number> = {
  title: 120,
  // Dates are held to YYYY-MM-DDTHH:mm by parseLocal, which is stricter than a length.
  startsAt: 16,
  endsAt: 16,
  venueName: 120,
  ticketInfo: 200,
  description: 1000,
};

/** An event is read at most this far ahead; further is a misread year. */
const MAX_DAYS_AHEAD = 400;

/** C0 and C1 controls, zero-width characters, and bidirectional overrides and isolates. */
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function clean(value: string): string {
  return value.normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/**
 * Text that has no business in an event's details. Deliberately broad: a false
 * alarm costs an admin a few seconds of typing, a miss could put a planted
 * instruction or a phishing link on a public page.
 */
const SUSPECT: { pattern: RegExp; reason: string }[] = [
  { pattern: new RegExp(PROMPT_CANARY, "i"), reason: "repeats the reader's own instructions" },
  { pattern: /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|prompts?|rules?|above|previous|prior)\b/i, reason: "reads like an instruction" },
  { pattern: /\b(system prompt|you are (now )?an?\b|as an ai|language model|assistant:|\[\/?(inst|system)\])/i, reason: "addresses the reader, not the public" },
  { pattern: /\b(publish|approve|auto-?approve)\b.{0,30}\b(now|this|immediately|event|it)\b/i, reason: "asks for the event to be published" },
  { pattern: /\b(set|change|make|mark|lower|drop)\s+(the\s+|its\s+|all\s+)?(ticket\s+)?(price|fare|fee|status|cost)s?\b/i, reason: "asks for a price or status to change" },
  { pattern: /\b(make|mark|set|list)\s+(it|this|the event|everything|all trips|trips)\s+(as\s+)?free\b/i, reason: "asks for a price or status to change" },
  { pattern: /\b(status|published|approved)\s*[:=]/i, reason: "carries a status" },
  { pattern: /(https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|net|org|io|co|link|xyz|top|click|site|online|info|biz)(\/|\b)|\b[a-z0-9-]+\.co\.za\b)/i, reason: "carries a link; type it in yourself if it is genuine" },
  { pattern: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, reason: "carries an email address" },
  { pattern: /(<\s*\/?\s*[a-z!][^>]*>|javascript:|data:[a-z]+\/|\]\(|\{\{|\$\{)/i, reason: "carries markup or code" },
];

function suspicion(text: string): string | null {
  for (const { pattern, reason } of SUSPECT) if (pattern.test(text)) return reason;
  return null;
}

/** Reads 2026-12-05T18:00 as South African time (UTC+2, no daylight saving). */
export function parseLocal(value: string): Date | null {
  if (!LOCAL_DATE_TIME.test(value)) return null;
  const [y, mo, d, h, mi] = value.split(/[-T:]/).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  // Date.UTC rolls 31 February into March; a real day survives the round trip.
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return null;
  return new Date(Date.UTC(y, mo - 1, d, h - 2, mi));
}

export function checkAnswer(raw: string, now: Date): CheckResult {
  if (raw.length > 20_000) return { ok: false, reason: "The answer was far longer than any poster's details" };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "The answer was not JSON" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, reason: "The answer was not a JSON object" };
  }
  const extra = Object.keys(json).filter((k) => !(FIELD_NAMES as readonly string[]).includes(k));
  if (extra.length) {
    return { ok: false, reason: `The answer had fields the reader may not fill (${extra.slice(0, 5).join(", ")}); none of it is used` };
  }
  const parsed = posterAnswerSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "The answer did not match the reader's schema" };

  const fields: PosterFields = {};
  const setAside: SetAside[] = [];
  const drop = (field: FieldName, reason: string, text: string) => setAside.push({ field, reason, excerpt: text.slice(0, 120) });

  for (const field of FIELD_NAMES) {
    const value = parsed.data[field];
    if (value === null) continue;
    const text = clean(value);
    if (!text) continue;
    const why = suspicion(text);
    if (why) {
      drop(field, why, text);
      continue;
    }
    // A date's own check below says better what is wrong with it than its length does.
    if (text.length > MAX_LENGTH[field] && field !== "startsAt" && field !== "endsAt") {
      drop(field, `is longer than ${MAX_LENGTH[field]} characters`, text);
      continue;
    }
    fields[field] = text;
  }

  // Dates: each must be a real date and time ahead, and the end after the start.
  const latest = now.getTime() + MAX_DAYS_AHEAD * 86_400_000;
  for (const field of ["startsAt", "endsAt"] as const) {
    const value = fields[field];
    if (value === undefined) continue;
    const date = parseLocal(value);
    if (!date) {
      delete fields[field];
      drop(field, "is not a date and time the reader could use", value);
    } else if (date.getTime() <= now.getTime() || date.getTime() > latest) {
      delete fields[field];
      drop(field, date.getTime() <= now.getTime() ? "is in the past" : "is more than a year ahead", value);
    }
  }
  if (fields.startsAt && fields.endsAt && parseLocal(fields.endsAt)!.getTime() <= parseLocal(fields.startsAt)!.getTime()) {
    drop("endsAt", "is not after the start", fields.endsAt);
    delete fields.endsAt;
  }

  return { ok: true, fields, setAside };
}
