import type { NextRequest } from "next/server";
import { recordAudit, type Prisma } from "@ride/db";
import { prisma } from "@/lib/prisma";
import { requireActiveUser, type ActiveUser, type UserRoleName } from "@/lib/auth";
import { AppError, AuthorizationError, ConcealedRecordError } from "@/lib/errors";
import type { Viewer } from "@/lib/policy";

/**
 * The caller as the policy functions need them: who they are, from the
 * database, plus the one profile id their role carries.
 *
 * Only the profile that matches the role is loaded. A user demoted from DRIVER
 * to CUSTOMER keeps their Driver row (it holds their history), and must not keep
 * the driver's powers through it.
 */
export async function loadViewer(user: ActiveUser): Promise<Viewer> {
  const viewer: Viewer = { userId: user.userId, role: user.role };
  if (user.role === "DRIVER") {
    const driver = await prisma.driver.findUnique({ where: { userId: user.userId }, select: { id: true } });
    viewer.driverId = driver?.id ?? null;
  } else if (user.role === "MERCHANT") {
    const merchant = await prisma.merchant.findUnique({ where: { userId: user.userId }, select: { id: true } });
    viewer.merchantId = merchant?.id ?? null;
  } else if (user.role === "RIDER") {
    const rider = await prisma.rider.findUnique({ where: { userId: user.userId }, select: { id: true } });
    viewer.riderId = rider?.id ?? null;
  }
  return viewer;
}

/** `requireActiveUser` and `loadViewer` in one call. */
export async function requireViewer(req: NextRequest, ...roles: UserRoleName[]): Promise<Viewer> {
  return loadViewer(await requireActiveUser(req, ...roles));
}

/**
 * The role check of `requireActiveUser`, for use inside `auditRefusals`: a
 * customer calling a driver-only or admin-only endpoint is exactly the attempt
 * the audit log is for, and `requireActiveUser` refuses before anything can
 * record it.
 */
export function assertRole(viewer: Viewer, ...roles: UserRoleName[]): void {
  if (!roles.includes(viewer.role)) {
    throw new AuthorizationError(`This action requires one of these roles: ${roles.join(", ")}`);
  }
}

/**
 * Status codes that mean "we refused", as opposed to "you made a mistake". These
 * are the ones an admin reviewing abuse needs to see: a forbidden move, a
 * stranger's record, a move the record's state does not allow.
 */
function isRefusal(error: unknown): error is AppError {
  if (error instanceof ConcealedRecordError) return true;
  return error instanceof AppError && (error.statusCode === 403 || error.statusCode === 409);
}

/**
 * Runs `fn` and, if it is refused, writes the refusal to the audit log before
 * rethrowing.
 *
 * Written with `recordAudit`, outside any transaction: the transaction that was
 * refused has rolled back, and the record of the attempt must not roll back
 * with it. `recordAudit` never throws, so an audit outage cannot turn a 409 into
 * a 500.
 */
export async function auditRefusals<T>(
  viewer: Pick<Viewer, "userId" | "role">,
  attempt: { action: string; entityType: string; entityId: string | null; detail?: Prisma.InputJsonObject },
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isRefusal(error)) {
      await recordAudit(prisma, {
        actorUserId: viewer.userId,
        actorRole: viewer.role,
        action: `${attempt.action}.refused`,
        entityType: attempt.entityType,
        entityId: attempt.entityId,
        detail: { ...(attempt.detail ?? {}), status: error.statusCode, reason: error.message },
      });
    }
    throw error;
  }
}
