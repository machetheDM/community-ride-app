import { z } from "zod";
import { normaliseSaMobile } from "./phone";

/**
 * Request bodies for the sign-in routes.
 *
 * Kept apart from `validate.ts` so the sign-in rules change in one place. The
 * phone schema there accepted any country code (it prefixed whatever digits it
 * was given with `+`), which is the toll-fraud opening in threat model AU-3. This
 * one accepts South African mobiles only and normalises them, so `0821234567` and
 * `+27 82 123 4567` reach the database as the same `+27821234567` and share one
 * send cap and one lockout.
 */
export const saMobileSchema = z
  .string({ error: "Phone number is required" })
  .max(32, "Enter a South African mobile number, such as 082 123 4567")
  .transform((value, ctx) => {
    const phone = normaliseSaMobile(value);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a South African mobile number, such as 082 123 4567" });
      return z.NEVER;
    }
    return phone;
  });

export const otpRequestSchema = z.object({
  phone: saMobileSchema,
});

export const otpVerifySchema = z.object({
  phone: saMobileSchema,
  code: z.string({ error: "Enter the 6-digit code" }).regex(/^\d{6}$/, "Enter the 6-digit code"),
});
