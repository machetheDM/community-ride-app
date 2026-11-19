import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { recordAudit, recordAuditStrict } from "@ride/db";
import { decryptField } from "@ride/db/crypto";
import { firstName } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { auditRefusals, requireViewer } from "@/lib/actor";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { ConcealedRecordError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { checkInSchema, parseBody } from "@/lib/validate";
import { CHECK_IN_WRONG_LIMIT, operatorOf } from "@/lib/group-trips";

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The operator boards a passenger by entering the code on the passenger's phone
 * (PLAN.md 3.9). The code proves the person getting in is the one who booked,
 * and it is what makes a passenger boarded rather than a no-show when the fee is
 * worked out.
 *
 * Only the trip's own operator may check in. Wrong codes are counted in the
 * audit log (outside the transaction, so a refusal is still recorded), and after
 * twenty on one trip check-in locks: four digits across fifteen passengers is a
 * space someone could otherwise walk.
 */
export const POST = withErrorHandler(async (req: NextRequest, ctx) => {
  const viewer = await requireViewer(req);
  const { id } = await ctx.params;
  const { code } = await parseBody(req, checkInSchema);

  const boarded = await auditRefusals(viewer, { action: "group_trip.check_in", entityType: "GroupTrip", entityId: id }, async () => {
    const driver = operatorOf(viewer);
    const trip = await prisma.groupTrip.findUnique({ where: { id }, select: { status: true, driverId: true } });
    if (!trip) throw new NotFoundError("Group trip");
    if (trip.driverId !== driver.id) throw new ConcealedRecordError("Group trip");
    if (trip.status !== "BOOKED") throw new ConflictError("Check-in is for a booked trip");

    const wrong = await prisma.auditLog.count({ where: { action: "group_trip.check_in.wrong", entityId: id } });
    if (wrong >= CHECK_IN_WRONG_LIMIT) throw new ConflictError("Too many wrong codes on this trip; check passengers in by name with support");

    const waiting = await prisma.tripRequest.findMany({
      where: { groupTripId: id, status: "BOOKED" },
      select: { id: true, seats: true, checkInCodeEnc: true, customer: { select: { name: true } } },
    });
    const match = waiting.find((r) => r.checkInCodeEnc && sameCode(decryptField(r.checkInCodeEnc), code));
    if (!match) {
      await recordAudit(prisma, {
        actorUserId: viewer.userId,
        actorRole: viewer.role,
        action: "group_trip.check_in.wrong",
        entityType: "GroupTrip",
        entityId: id,
      });
      throw new ValidationError("That code is not one of this trip's passengers", { code: ["Not on this trip"] });
    }

    return prisma.$transaction(async (tx) => {
      const done = await tx.tripRequest.updateMany({ where: { id: match.id, status: "BOOKED" }, data: { status: "BOARDED" } });
      if (done.count !== 1) throw new ConflictError("That passenger is already on board");
      await recordAuditStrict(tx, {
        actorUserId: viewer.userId,
        actorRole: viewer.role,
        action: "group_trip.check_in",
        entityType: "TripRequest",
        entityId: match.id,
        detail: { groupTripId: id, seats: match.seats },
      });
      return { requestId: match.id, firstName: firstName(match.customer.name), seats: match.seats };
    });
  });

  return ok(boarded);
});
