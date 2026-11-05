import { NextRequest, NextResponse } from "next/server";
import { issueOtp, smsTransportFromEnv } from "@ride/db/otp";
import { prisma } from "@/lib/prisma";
import { parseBody } from "@/lib/validate";
import { otpRequestSchema } from "@/lib/auth-schemas";
import { maskPhone } from "@/lib/phone";
import { otpSendPhoneLimiter } from "@/lib/rate-limit";
import { ok } from "@/lib/response";
import { withErrorHandler } from "@/lib/handler";
import { logger } from "@/lib/logger";

/**
 * Sends a sign-in code. The address limit runs in `proxy.ts`; the phone limits run
 * here, once the body says which phone, and the database send cap in `issueOtp`.
 */
export const POST = withErrorHandler(async (req: NextRequest) => {
  // Before anything else, and whatever the body says: when nothing can deliver a
  // code, the honest answer is that sign-in is unavailable. The old route answered
  // "OTP sent" in production with no provider, so every sign-in failed silently.
  const sms = smsTransportFromEnv();
  if (!sms) {
    logger.error("OTP requested but no SMS provider is configured (SMS_PROVIDER)");
    return NextResponse.json({ success: false, error: "SMS is not configured" }, { status: 503 });
  }

  const { phone } = await parseBody(req, otpRequestSchema);
  otpSendPhoneLimiter.hit(phone);

  const result = await issueOtp(prisma, phone, { sms });
  if (!result.ok) {
    logger.warn(`OTP send cap reached for ${maskPhone(phone)}`);
    return NextResponse.json(
      { success: false, error: "Too many codes requested for this number. Please try again later." },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
    );
  }

  logger.info(`OTP issued for ${maskPhone(phone)}`);

  return ok({
    message: "OTP sent",
    expiresIn: 600,
    // Only on a developer's machine, where the console transport prints it too.
    // The Docker image sets NODE_ENV=production, so a deployed build never does.
    ...(process.env.NODE_ENV === "development" ? { code: result.code } : {}),
  });
});
