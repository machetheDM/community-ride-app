import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@ride/db";
import { verifyOtp } from "@ride/db/otp";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/validate";
import { otpVerifySchema } from "@/lib/auth-schemas";
import { maskPhone } from "@/lib/phone";
import { otpVerifyPhoneLimiter } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { ok, unauthorized } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { signAuthToken } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * One message for a wrong code, an expired or burned code, and a locked phone.
 * Distinguishing them would tell an attacker when to stop guessing and when the
 * lockout lifts; the reason goes to the audit trail instead.
 */
const GENERIC_FAILURE = "Invalid or expired code";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const { phone, code } = await parseBody(req, otpVerifySchema);
  otpVerifyPhoneLimiter.hit(phone);
  const ip = getClientIp(req);

  const result = await verifyOtp(prisma, phone, code);
  if (!result.ok) {
    // Never the code: an audit row of failed guesses must not become a list of
    // nearly-right answers.
    await recordAudit(prisma, {
      action: "auth.otp.verify.fail",
      entityType: "User",
      ip,
      detail: { channel: "api", reason: result.reason, phone: maskPhone(phone) },
    });
    return unauthorized(GENERIC_FAILURE);
  }

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone, name: "User", isVerified: true } });
  }

  // The caller has proved they hold the phone, so saying why is safe here, and a
  // suspended driver or customer needs to know to contact support. Issuing the
  // token would have been pointless anyway: `requireActiveUser` refuses it on the
  // first request.
  if (!user.isActive) {
    await recordAudit(prisma, {
      actorUserId: user.id,
      actorRole: user.role,
      action: "auth.otp.verify.fail",
      entityType: "User",
      entityId: user.id,
      ip,
      detail: { channel: "api", reason: "inactive" },
    });
    return NextResponse.json(
      { success: false, error: "This account has been suspended. Please contact support." },
      { status: 403 }
    );
  }

  const token = signAuthToken({
    userId: user.id,
    phone: user.phone,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  await recordAudit(prisma, {
    actorUserId: user.id,
    actorRole: user.role,
    action: "auth.otp.verify.ok",
    entityType: "User",
    entityId: user.id,
    ip,
    detail: { channel: "api" },
  });
  logger.info(`User ${user.id} verified via OTP`);

  return ok({
    token,
    user: { id: user.id, name: user.name, phone: user.phone, role: user.role, avatar: user.avatar },
  });
});
