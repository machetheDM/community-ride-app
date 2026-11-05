import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRole, auditRefusals, requireViewer } from "@/lib/actor";
import { parseBody, driverUpdateSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { AuthorizationError, NotFoundError } from "@/lib/errors";
import { goOnlineRefusal } from "@/lib/policy";
import { driverSelfSelect } from "@/lib/views";
import { maybeNotifyArrival } from "@/lib/arrival";

/** The signed-in driver's own profile. Never the licence or ID number, never coordinates. */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req, "DRIVER");

  const driver = await prisma.driver.findUnique({ where: { userId: viewer.userId }, select: driverSelfSelect });
  if (!driver) throw new NotFoundError("Driver profile");

  return ok(driver);
});

/**
 * The driver goes online or offline, or reports where they are.
 *
 * This used to spread the raw body into the update with no schema and no
 * approval check, so an operator signed up a minute ago could go online, report
 * any position, and on each report near a pickup cost us a billable Routes call
 * and send the customer a false "driver arriving" push (threat model RD-8).
 *
 * - The body is validated: coordinates in range and sent as a pair, a heading
 *   in degrees, `isOnline` a boolean. Anything else is a 400.
 * - Going online needs an approved operator and an approved vehicle (403).
 * - A position is stored only while the driver is approved and online. An
 *   offline or unapproved driver's position is not ours to keep, and going
 *   offline clears the last one, so the table never holds where an off-duty
 *   operator lives.
 * - Only an approved, online driver's position can trigger the arrival check,
 *   which is the code path that spends money.
 */
export const PATCH = withErrorHandler(async (req: NextRequest) => {
  const viewer = await requireViewer(req);
  const body = await parseBody(req, driverUpdateSchema);

  return auditRefusals(viewer, { action: "driver.update", entityType: "Driver", entityId: viewer.driverId ?? null }, async () => {
    assertRole(viewer, "DRIVER");

    const current = await prisma.driver.findUnique({
      where: { userId: viewer.userId },
      select: { id: true, isApproved: true, isOnline: true, vehicle: { select: { isApproved: true } } },
    });
    if (!current) throw new NotFoundError("Driver profile");

    if (body.isOnline === true) {
      const refusal = goOnlineRefusal(current);
      if (refusal) throw new AuthorizationError(refusal);
    }

    const online = body.isOnline ?? current.isOnline;
    const mayReportPosition = online && goOnlineRefusal(current) === null;
    const position =
      body.currentLat !== undefined && body.currentLng !== undefined
        ? { lat: body.currentLat, lng: body.currentLng }
        : null;
    const stored = mayReportPosition ? position : null;

    const driver = await prisma.driver.update({
      where: { id: current.id },
      data: {
        ...(body.isOnline !== undefined ? { isOnline: body.isOnline } : {}),
        ...(!online
          ? { currentLat: null, currentLng: null, heading: null }
          : stored
            ? {
                currentLat: stored.lat,
                currentLng: stored.lng,
                ...(body.heading !== undefined ? { heading: body.heading } : {}),
              }
            : {}),
      },
      select: driverSelfSelect,
    });

    // A new position may mean the driver is now close enough to pickup to warn
    // the customer. Fire-and-forget: the location update is the operation being
    // requested here and must not wait on, or fail with, a notification.
    if (stored) {
      maybeNotifyArrival(current.id, stored).catch(() => {
        /* maybeNotifyArrival logs its own failures */
      });
    }

    return ok(driver);
  });
});
