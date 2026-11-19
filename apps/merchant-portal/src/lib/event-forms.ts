/**
 * Validation for the admin's venue, pickup point, event and spend forms
 * (docs/PLAN.md Phase 3.1 to 3.3).
 *
 * Pure, like complex-form.ts and access.ts, so the API's test suite checks it.
 * Every form posts to a Server Action, a public endpoint whatever the page shows,
 * so these are the checks that count; the browser's are a convenience.
 */
import { slugify } from "./complex-form";

export type FormResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const SA_BOUNDS = { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33 };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, max: number): string | null {
  const t = text(value);
  return t ? t.slice(0, max) : null;
}

function number(value: unknown): number | null {
  const raw = text(value);
  if (raw === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinates(input: Record<string, unknown>, errors: Record<string, string>): { lat: number; lng: number } {
  const lat = number(input.lat);
  const lng = number(input.lng);
  if (lat === null || lat < SA_BOUNDS.minLat || lat > SA_BOUNDS.maxLat) {
    errors.lat = "Latitude must be in South Africa, between -35 and -22 (it is negative)";
  }
  if (lng === null || lng < SA_BOUNDS.minLng || lng > SA_BOUNDS.maxLng) {
    errors.lng = "Longitude must be in South Africa, between 16 and 33";
  }
  return { lat: lat ?? 0, lng: lng ?? 0 };
}

/**
 * A date and time typed in South Africa (`<input type="datetime-local">` sends
 * "2026-12-05T18:00" with no zone). Read as SAST, UTC+2, all year: South Africa
 * has no daylight saving.
 */
export function parseSastDateTime(value: unknown): Date | null {
  const raw = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h - 2, mi));
  return Number.isNaN(date.getTime()) ? null : date;
}

// ─── Venue ────────────────────────────────────────────────────

export const VENUE_KINDS = ["RESORT", "CLUB", "HALL", "SPORTS", "OTHER"] as const;
export type VenueKindName = (typeof VENUE_KINDS)[number];

export interface VenueInput {
  name: string;
  slug: string;
  kind: VenueKindName;
  address: string;
  lat: number;
  lng: number;
  contactName: string | null;
  contactPhone: string | null;
  agreementAt: Date | null;
  agreementNote: string | null;
}

export function parseVenueForm(input: Record<string, unknown>, now = new Date()): FormResult<VenueInput> {
  const errors: Record<string, string> = {};
  const name = text(input.name);
  if (name.length < 2 || name.length > 100) errors.name = "Give the venue a name of 2 to 100 characters";
  const slug = slugify(name);
  if (!errors.name && slug.length < 2) errors.name = "The name needs some letters or digits";
  const kind = text(input.kind) as VenueKindName;
  if (!VENUE_KINDS.includes(kind)) errors.kind = "Choose what kind of venue it is";
  const address = text(input.address);
  if (address.length < 5 || address.length > 200) errors.address = "Give the street address (5 to 200 characters)";
  const point = coordinates(input, errors);

  const contactPhone = optionalText(input.contactPhone, 20);
  if (contactPhone && !/^\+?[0-9 ]{9,15}$/.test(contactPhone)) errors.contactPhone = "A phone number, digits only";

  // The agreement is what makes a venue a partner: a date it was agreed, and what.
  const agreed = text(input.agreed) === "on";
  const agreementNote = optionalText(input.agreementNote, 500);
  if (agreed && !agreementNote) errors.agreementNote = "Say what was agreed and with whom";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      slug,
      kind,
      address,
      ...point,
      contactName: optionalText(input.contactName, 100),
      contactPhone,
      agreementAt: agreed ? now : null,
      agreementNote: agreed ? agreementNote : null,
    },
  };
}

// ─── Pickup point ─────────────────────────────────────────────

export interface PickupPointInput {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/** A public place: a taxi rank, a plaza, a garage. Never a home (threat model PL-4). */
export function parsePickupPointForm(input: Record<string, unknown>): FormResult<PickupPointInput> {
  const errors: Record<string, string> = {};
  const name = text(input.name);
  if (name.length < 2 || name.length > 100) errors.name = "Name the place (2 to 100 characters), e.g. 'Plaza taxi rank'";
  const address = text(input.address);
  if (address.length < 5 || address.length > 200) errors.address = "Give its address (5 to 200 characters)";
  const point = coordinates(input, errors);
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, address, ...point } };
}

// ─── Event ────────────────────────────────────────────────────

export interface EventInput {
  venueId: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  ticketInfo: string | null;
}

/**
 * The slug gets the date after the title, so "Summer Jam" in December and in
 * January are two pages, not one page that changes under a shared link.
 */
export function eventSlug(title: string, startsAt: Date): string {
  const sast = new Date(startsAt.getTime() + 2 * 3_600_000);
  return `${slugify(title).slice(0, 48)}-${sast.toISOString().slice(0, 10)}`;
}

export function parseEventForm(input: Record<string, unknown>, now = new Date()): FormResult<EventInput> {
  const errors: Record<string, string> = {};
  const venueId = text(input.venueId);
  if (!venueId || venueId.length > 64) errors.venueId = "Choose the venue";
  const title = text(input.title);
  if (title.length < 3 || title.length > 120) errors.title = "Give the event a title of 3 to 120 characters";
  const startsAt = parseSastDateTime(input.startsAt);
  if (!startsAt) errors.startsAt = "When does it start?";
  else if (startsAt.getTime() < now.getTime()) errors.startsAt = "The start is in the past";
  const endsRaw = text(input.endsAt);
  const endsAt = endsRaw ? parseSastDateTime(endsRaw) : null;
  if (endsRaw && !endsAt) errors.endsAt = "That end time is not a date and time";
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) errors.endsAt = "It must end after it starts";
  if (startsAt && endsAt && endsAt.getTime() - startsAt.getTime() > 3 * 86_400_000) {
    errors.endsAt = "An event here lasts at most three days";
  }

  if (Object.keys(errors).length || !startsAt) return { ok: false, errors };
  return {
    ok: true,
    value: {
      venueId,
      title,
      slug: eventSlug(title, startsAt),
      description: optionalText(input.description, 2000),
      startsAt,
      endsAt,
      ticketInfo: optionalText(input.ticketInfo, 200),
    },
  };
}

// ─── Promotion spend ──────────────────────────────────────────

export const SPEND_CHANNELS = ["META", "OTHER"] as const;

export interface SpendInput {
  channel: (typeof SPEND_CHANNELS)[number];
  amount: string;
  spentOn: Date;
  note: string | null;
}

/** What a boost cost, in rands to the cent, as a string so it never passes through a float. */
export function parseSpendForm(input: Record<string, unknown>, now = new Date()): FormResult<SpendInput> {
  const errors: Record<string, string> = {};
  const channel = text(input.channel) as SpendInput["channel"];
  if (!SPEND_CHANNELS.includes(channel)) errors.channel = "Choose where the money was spent";
  const amount = text(input.amount);
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) errors.amount = "An amount in rands, more than 0";
  const day = text(input.spentOn);
  const spentOn = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T10:00:00Z`) : null;
  if (!spentOn || Number.isNaN(spentOn.getTime())) errors.spentOn = "The date it was spent";
  else if (spentOn.getTime() > now.getTime() + 86_400_000) errors.spentOn = "That date is in the future";
  if (Object.keys(errors).length || !spentOn) return { ok: false, errors };
  return { ok: true, value: { channel, amount, spentOn, note: optionalText(input.note, 200) } };
}
