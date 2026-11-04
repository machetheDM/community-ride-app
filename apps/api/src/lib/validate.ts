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

/**
 * Note the absence of `fareEstimate`.
 *
 * It used to be accepted from the client and stored verbatim, which made the price
 * of a ride whatever the caller said it was. The server now derives it from the
 * routed distance and `PricingConfig` (see `lib/fare.ts`). Zod strips unknown keys
 * by default, so an older app build still sending the field is harmless — the value
 * is simply discarded rather than trusted.
 *
 * Coordinates stay optional: when the app supplies them (from autocomplete) the
 * server uses them directly, and when it does not the server geocodes the address
 * itself. Either way a ride is never stored at 0,0 the way it was before.
 */
export const rideCreateSchema = z.object({
  pickupAddress: z.string().min(1, "Pickup address is required").max(300),
  dropoffAddress: z.string().min(1, "Dropoff address is required").max(300),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
  dropoffLat: z.number().min(-90).max(90).optional(),
  dropoffLng: z.number().min(-180).max(180).optional(),
  vehicleType: z.enum(["SEDAN", "MINIVAN", "BAKKIE", "SCOOTER", "BICYCLE"]).default("SEDAN"),
  paymentMethod: z.enum(["CASH", "CARD", "YOCO", "OZOW", "WALLET"]).default("CASH"),
  scheduledAt: z.string().datetime().optional(),
});

// ── Maps proxy schemas ──

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const geocodeSchema = z.object({
  address: z.string().min(1, "Address is required").max(300),
});

export const routeSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
});

export const autocompleteSchema = z.object({
  input: z.string().min(1, "Search text is required").max(200),
  // Required, not optional: without it every keystroke bills against the Per
  // Request SKU instead of the free Session SKU.
  sessionToken: z.string().min(8).max(64),
  bias: z
    .object({
      center: latLngSchema,
      radiusMeters: z.number().min(1).max(50_000),
    })
    .optional(),
});

export const placeResolveSchema = z.object({
  placeId: z.string().min(1, "Place ID is required").max(300),
  sessionToken: z.string().min(8).max(64),
});

export const fareQuoteSchema = z.object({
  origin: latLngSchema,
  destination: latLngSchema,
  vehicleType: z.enum(["SEDAN", "MINIVAN", "BAKKIE", "SCOOTER", "BICYCLE"]).default("SEDAN"),
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
