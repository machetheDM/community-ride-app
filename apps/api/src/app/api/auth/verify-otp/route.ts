import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseBody, otpVerifySchema } from "@/lib/validate";
import { ok, unauthorized } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { signAuthToken } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const POST = withErrorHandler(async (req: NextRequest) => {
  const { phone, code } = await parseBody(req, otpVerifySchema);
  const now = new Date();

  const otp = await prisma.otpCode.findFirst({
    where: { phone, code, used: false, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) return unauthorized("Invalid or expired OTP");

  await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone, name: "User", isVerified: true } });
  }

  const token = signAuthToken({ userId: user.id, phone: user.phone, role: user.role });

  logger.info(`User ${user.id} verified via OTP`);

  return ok({
    token,
    user: { id: user.id, name: user.name, phone: user.phone, role: user.role, avatar: user.avatar },
  });
});
