import { z, ZodSchema, ZodError } from "zod";
import { NextRequest } from "next/server";
import { ValidationError } from "./errors";

export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  try {
    const body = await req.json();
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".") || "_root";
        if (!fields[path]) fields[path] = [];
        fields[path].push(issue.message);
      }
      throw new ValidationError("Validation failed", fields);
    }
    throw new ValidationError("Invalid request body");
  }
}

export function parseQuery<T>(req: NextRequest, schema: ZodSchema<T>): T {
  const { searchParams } = new URL(req.url);
  const raw: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".") || "_root";
        if (!fields[path]) fields[path] = [];
        fields[path].push(issue.message);
      }
      throw new ValidationError("Invalid query parameters", fields);
    }
    throw new ValidationError("Invalid query parameters");
  }
}

// ── Common Schemas ──

export const phoneSchema = z
  .string()
  .min(1, "Phone number is required")
  .transform((p) => {
    const digits = p.replace(/\D/g, "");
    if (digits.startsWith("0") && digits.length === 10) return "+27" + digits.slice(1);
    if (digits.startsWith("27") && digits.length === 11) return "+" + digits;
    if (digits.startsWith("27") && digits.length === 12) return "+" + digits;
    return "+" + digits;
  })
  .pipe(z.string().min(10, "Invalid phone number"));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const rideCreateSchema = z.object({
  pickupAddress: z.string().min(1, "Pickup address is required"),
  dropoffAddress: z.string().min(1, "Dropoff address is required"),
  pickupLat: z.number().optional(),
  pickupLng: z.number().optional(),
  dropoffLat: z.number().optional(),
  dropoffLng: z.number().optional(),
  vehicleType: z.enum(["SEDAN", "MINIVAN", "BAKKIE", "SCOOTER", "BICYCLE"]).default("SEDAN"),
  fareEstimate: z.number().min(0).default(0),
  paymentMethod: z.enum(["CASH", "CARD", "YOCO", "OZOW", "WALLET"]).default("CASH"),
  scheduledAt: z.string().datetime().optional(),
});

export const rideUpdateSchema = z.object({
  status: z.enum(["ACCEPTED", "DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  fareActual: z.number().min(0).optional(),
  cancelReason: z.string().max(500).optional(),
});

export const orderCreateSchema = z.object({
  storeId: z.string().min(1, "Store ID is required"),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
        notes: z.string().max(200).optional(),
      })
    )
    .min(1, "At least one item is required")
    .max(50, "Too many items"),
  deliveryAddress: z.string().min(1, "Delivery address is required"),
  deliveryLat: z.number().optional(),
  deliveryLng: z.number().optional(),
  notes: z.string().max(500).optional(),
  paymentMethod: z.enum(["CASH", "CARD", "YOCO", "OZOW", "WALLET"]).default("CASH"),
});

export const orderStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]),
  cancelReason: z.string().max(500).optional(),
});

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, "OTP must be 6 digits"),
});

export const pushTokenSchema = z.object({
  token: z.string().min(1, "Push token is required"),
});

export const driverUpdateSchema = z.object({
  isOnline: z.boolean().optional(),
  currentLat: z.number().optional(),
  currentLng: z.number().optional(),
  heading: z.number().optional(),
});
