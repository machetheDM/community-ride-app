"use server";

import { revalidatePath } from "next/cache";
import { recordAuditStrict, type Prisma } from "@ride/db";
import { readerConfig, readPoster, VertexGemini } from "@ride/poster-reader";
import { prisma } from "./prisma";
import { sessionFor } from "./session";
import { requestIp } from "./audit";
import { applyProposal, readingRefusal, storedProposal } from "./poster-reading";
import { countReadsToday } from "./poster-reads";

/**
 * The admin's poster-reader actions (docs/PLAN.md 4.3 to 4.5, ADR 0008).
 * Public endpoints, like every Server Action: each checks the admin session and
 * the switch itself, whatever the page showed.
 */

type Result = { ok: true } | { error: string };

export async function readEventPoster(eventId: unknown): Promise<Result> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  if (typeof eventId !== "string" || !eventId || eventId.length > 64) return { error: "Event not found" };

  const config = readerConfig();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true, posterSha256: true, posterBytes: true, posterType: true },
  });
  if (!event) return { error: "Event not found" };
  const readsToday = await countReadsToday(eventId);
  const refusal = readingRefusal(config, event, readsToday);
  if (refusal || !config.enabled || !event.posterBytes || !event.posterType) return { error: refusal ?? "Upload the poster first" };

  const read = await readPoster({
    model: new VertexGemini(config),
    image: event.posterBytes,
    mimeType: event.posterType,
    price: config.price,
  });
  const result = read.result;

  const ip = await requestIp();
  await prisma.$transaction(async (tx) => {
    const call = await tx.modelCall.create({
      data: {
        ...read.call,
        eventId,
        posterSha256: event.posterSha256,
        proposal: result?.ok ? (result.fields as Prisma.InputJsonObject) : undefined,
        setAside: result?.ok ? (result.setAside as unknown as Prisma.InputJsonArray) : undefined,
        problem: read.error,
        requestedById: session.userId,
      },
    });
    await recordAuditStrict(tx, {
      actorUserId: session.userId,
      actorRole: session.role,
      action: "event.poster_read",
      entityType: "Event",
      entityId: eventId,
      ip,
      detail: { channel: "portal", modelCallId: call.id, outcome: read.call.outcome, setAside: result?.ok ? result.setAside.length : null },
    });
  });
  revalidatePath(`/dashboard/events/${eventId}`);
  return read.error ? { error: read.error } : { ok: true };
}

/**
 * Applies the fields an admin ticked to the draft. The draft must still be a
 * draft, the reading must be for its current poster and not applied before;
 * each is a condition on the write, not just a check before it.
 */
export async function applyPosterReading(callId: unknown, fields: unknown): Promise<Result & { errors?: Record<string, string> }> {
  const session = await sessionFor("admin");
  if (!session) return { error: "Not authenticated" };
  if (typeof callId !== "string" || !callId || callId.length > 64) return { error: "Reading not found" };

  const call = await prisma.modelCall.findUnique({
    where: { id: callId },
    select: {
      feature: true,
      outcome: true,
      appliedAt: true,
      proposal: true,
      posterSha256: true,
      event: { select: { id: true, status: true, posterSha256: true, venueId: true, title: true, startsAt: true, endsAt: true, ticketInfo: true, description: true } },
    },
  });
  const event = call?.event;
  if (!call || !event || call.feature !== "poster.read" || call.outcome !== "OK") return { error: "Reading not found" };
  if (call.appliedAt) return { error: "This reading has already been applied" };
  if (event.status !== "DRAFT") return { error: "Only a draft can take a reading" };
  if (call.posterSha256 !== event.posterSha256) return { error: "The poster has changed since this reading; read it again" };

  const parsed = applyProposal(storedProposal(call.proposal), fields, event);
  if (!parsed.ok) return { error: Object.values(parsed.errors)[0] ?? "Not applied", errors: parsed.errors };
  const { title, slug, description, startsAt, endsAt, ticketInfo } = parsed.value;
  const changes = { title, slug, description, startsAt, endsAt, ticketInfo };

  const ip = await requestIp();
  try {
    const done = await prisma.$transaction(async (tx) => {
      const updated = await tx.event.updateMany({
        where: { id: event.id, status: "DRAFT", posterSha256: call.posterSha256 },
        data: changes,
      });
      if (updated.count === 0) return false;
      const marked = await tx.modelCall.updateMany({
        where: { id: callId, appliedAt: null },
        data: { appliedAt: new Date(), appliedById: session.userId },
      });
      if (marked.count === 0) throw new Error("applied twice");
      await recordAuditStrict(tx, {
        actorUserId: session.userId,
        actorRole: session.role,
        action: "event.poster_reading.apply",
        entityType: "Event",
        entityId: event.id,
        ip,
        detail: { channel: "portal", modelCallId: callId, fields: parsed.applied ?? [] },
      });
      return true;
    });
    if (!done) return { error: "The event changed while you were checking; reload and try again" };
  } catch (error) {
    if ((error as Error).message === "applied twice") return { error: "This reading has already been applied" };
    if ((error as { code?: string }).code === "P2002") return { error: "Another event already has this title on this date" };
    throw error;
  }
  revalidatePath(`/dashboard/events/${event.id}`);
  revalidatePath("/dashboard/events");
  return { ok: true };
}
