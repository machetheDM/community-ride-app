"use server";

import { revalidatePath } from "next/cache";
import { recordAuditStrict } from "@ride/db";
import { sanitizePoster } from "@ride/db/poster";
import { prisma } from "./prisma";
import { sessionFor } from "./session";
import { requestIp } from "./audit";
import { parseEventForm, parsePickupPointForm, parseSpendForm, parseVenueForm } from "./event-forms";

/**
 * The admin's actions for venues, pickup points, events and promotion spend
 * (docs/PLAN.md Phase 3.1 to 3.3).
 *
 * Every one is a public endpoint whatever the page shows: each re-checks the
 * admin session, parses its input with the pure parsers in event-forms.ts, and
 * writes its audit row in the same transaction as the change.
 */

export interface FormState {
  ok?: boolean;
  id?: string;
  error?: string;
  errors?: Record<string, string>;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === "P2002";
}

export async function createVenue(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const parsed = parseVenueForm(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const ip = await requestIp();
  try {
    const id = await prisma.$transaction(async (tx) => {
      const venue = await tx.venue.create({ data: parsed.value });
      await recordAuditStrict(tx, {
        actorUserId: session.userId,
        actorRole: session.role,
        action: "venue.create",
        entityType: "Venue",
        entityId: venue.id,
        ip,
        detail: { channel: "portal", partner: parsed.value.agreementAt !== null },
      });
      return venue.id;
    });
    revalidatePath("/dashboard/venues");
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) return { errors: { name: "A venue with this name already exists" } };
    throw error;
  }
}

/** Records the partnership agreement on an existing venue: what was agreed, and when. */
export async function recordVenueAgreement(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const venueId = String(formData.get("venueId") ?? "");
  const note = String(formData.get("agreementNote") ?? "").trim().slice(0, 500);
  if (!venueId || venueId.length > 64) return { error: "Venue not found" };
  if (note.length < 5) return { errors: { agreementNote: "Say what was agreed and with whom" } };

  const ip = await requestIp();
  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.venue.updateMany({
      where: { id: venueId },
      data: { agreementAt: new Date(), agreementNote: note },
    });
    if (count === 0) return false;
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: "venue.agreement",
      entityType: "Venue",
      entityId: venueId,
      ip,
      detail: { channel: "portal" },
    });
    return true;
  });
  if (!done) return { error: "Venue not found" };
  revalidatePath("/dashboard/venues");
  return { ok: true };
}

export async function createPickupPoint(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const parsed = parsePickupPointForm(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const ip = await requestIp();
  const id = await prisma.$transaction(async (tx) => {
    const point = await tx.pickupPoint.create({ data: parsed.value });
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: "pickup_point.create",
      entityType: "PickupPoint",
      entityId: point.id,
      ip,
      detail: { channel: "portal" },
    });
    return point.id;
  });
  revalidatePath("/dashboard/venues");
  return { ok: true, id };
}

export async function createEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const parsed = parseEventForm(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const ip = await requestIp();
  try {
    const id = await prisma.$transaction(async (tx) => {
      const venue = await tx.venue.findUnique({ where: { id: parsed.value.venueId }, select: { isActive: true } });
      if (!venue?.isActive) return null;
      const event = await tx.event.create({ data: { ...parsed.value, createdById: session.userId } });
      await recordAuditStrict(tx, {
        actorUserId: session.userId,
        actorRole: session.role,
        action: "event.create",
        entityType: "Event",
        entityId: event.id,
        ip,
        detail: { channel: "portal", venueId: parsed.value.venueId },
      });
      return event.id;
    });
    if (!id) return { errors: { venueId: "Choose an active venue" } };
    revalidatePath("/dashboard/events");
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) return { errors: { title: "An event with this title on this day already exists" } };
    throw error;
  }
}

/**
 * Stores an event's poster after removing its metadata (sanitizePoster). Only a
 * draft's poster can change: a published page's preview is already out on
 * Facebook, and swapping the picture under it would make the share say something
 * the page does not.
 */
export async function uploadPoster(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const eventId = String(formData.get("eventId") ?? "");
  const file = formData.get("poster");
  if (!eventId || eventId.length > 64) return { error: "Event not found" };
  if (!(file instanceof File) || file.size === 0) return { errors: { poster: "Choose the poster image" } };

  const cleaned = sanitizePoster(Buffer.from(await file.arrayBuffer()));
  if (!cleaned.ok) return { errors: { poster: cleaned.reason } };

  const ip = await requestIp();
  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.event.updateMany({
      where: { id: eventId, status: "DRAFT" },
      data: { posterBytes: new Uint8Array(cleaned.bytes), posterType: cleaned.type, posterSha256: cleaned.sha256 },
    });
    if (count === 0) return false;
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: "event.poster",
      entityType: "Event",
      entityId: eventId,
      ip,
      detail: { channel: "portal", bytes: cleaned.bytes.length, removed: cleaned.removed.join(",") || "none" },
    });
    return true;
  });
  if (!done) return { error: "Only a draft event's poster can be changed" };
  revalidatePath(`/dashboard/events/${eventId}`);
  return { ok: true };
}

/**
 * Publishes or cancels an event, one checked step at a time: DRAFT to PUBLISHED,
 * DRAFT or PUBLISHED to CANCELLED. Publishing needs a partner venue (an agreement
 * on record), a poster, and a start in the future: a public page for an event the
 * venue never agreed to promote is the venue's grievance and ours.
 */
export async function setEventStatus(eventId: unknown, status: unknown): Promise<{ ok: true } | { error: string }> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 64) return { error: "Event not found" };
  if (status !== "PUBLISHED" && status !== "CANCELLED") return { error: "Unknown status" };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true, startsAt: true, posterSha256: true, venue: { select: { agreementAt: true, isActive: true } } },
  });
  if (!event) return { error: "Event not found" };

  if (status === "PUBLISHED") {
    if (event.status !== "DRAFT") return { error: "Only a draft can be published" };
    if (!event.venue.isActive || !event.venue.agreementAt) {
      return { error: "Record the venue's agreement before publishing its events" };
    }
    if (!event.posterSha256) return { error: "Add the poster before publishing" };
    if (event.startsAt.getTime() <= Date.now()) return { error: "This event has already started" };
  } else if (event.status === "CANCELLED") {
    return { error: "This event is already cancelled" };
  }

  const ip = await requestIp();
  const now = new Date();
  const changed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.event.updateMany({
      where: { id: eventId, status: event.status },
      data: { status, ...(status === "PUBLISHED" ? { publishedAt: now } : {}) },
    });
    if (count === 0) return false;
    if (status === "CANCELLED") {
      // Nobody travels to a cancelled event: waiting requests and open trips end with it.
      await tx.tripRequest.updateMany({
        where: { eventId, status: { in: ["WAITING", "CONFIRMING", "BOOKED"] } },
        data: { status: "CANCELLED" },
      });
      await tx.groupTrip.updateMany({
        where: { eventId, status: { in: ["OPEN", "COUNTERED", "BOOKED"] } },
        data: { status: "CANCELLED", cancelledAt: now },
      });
    }
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: status === "PUBLISHED" ? "event.publish" : "event.cancel",
      entityType: "Event",
      entityId: eventId,
      ip,
      detail: { channel: "portal", from: event.status, to: status },
    });
    return true;
  });
  if (!changed) return { error: "This event changed while you were looking at it. Refresh and try again." };

  revalidatePath("/dashboard/events");
  revalidatePath(`/dashboard/events/${eventId}`);
  return { ok: true };
}

/** Records what promoting an event cost, so its funnel can say whether it paid (PLAN.md §4, step 10). */
export async function recordSpend(_prev: FormState, formData: FormData): Promise<FormState> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  const eventId = String(formData.get("eventId") ?? "");
  if (!eventId || eventId.length > 64) return { error: "Event not found" };
  const parsed = parseSpendForm(Object.fromEntries(formData));
  if (!parsed.ok) return { errors: parsed.errors };

  const ip = await requestIp();
  const done = await prisma.$transaction(async (tx) => {
    const exists = await tx.event.count({ where: { id: eventId } });
    if (exists === 0) return false;
    const spend = await tx.eventSpend.create({ data: { ...parsed.value, eventId, recordedById: session.userId } });
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: "event.spend",
      entityType: "Event",
      entityId: eventId,
      ip,
      detail: { channel: "portal", spendId: spend.id, amount: parsed.value.amount, on: parsed.value.channel },
    });
    return true;
  });
  if (!done) return { error: "Event not found" };
  revalidatePath(`/dashboard/events/${eventId}`);
  return { ok: true };
}
