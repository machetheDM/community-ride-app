import { NextRequest } from "next/server";
import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { parseBody, otpRequestSchema } from "@/lib/validate";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { logger } from "@/lib/logger";

// Math.random() is not cryptographically secure and its output is predictable
// from prior draws; an OTP is an authentication secret, so it uses the CSPRNG.
function generateOtp() {
  return randomInt(100_000, 1_000_000).toString();
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  const { phone } = await parseBody(req, otpRequestSchema);

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.otpCode.create({ data: { phone, code, expiresAt } });

  logger.info(`OTP requested for ${phone.slice(0, 6)}***`);

  return ok({
    message: "OTP sent",
    expiresIn: 600,
    ...(process.env.NODE_ENV === "development" ? { code } : {}),
  });
});
