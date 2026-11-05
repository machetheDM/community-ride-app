import { z, ZodSchema, ZodError } from "zod";
import { NextRequest } from "next/server";
import { DELIVERY_STATUSES, ORDER_STATUSES, RIDE_STATUSES } from "@ride/db/lifecycle";
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

/** A free-text reason: trimmed, and blank treated as absent so "   " is no reason. */
const reasonSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((r) => (r ? r : undefined));

/**
 * A ride status change. The status must be one the schema knows (anything else
 * is a 400); whether this caller may make this move from the ride's current
 * status is `@ride/db/lifecycle`'s question, asked by the route.
 *
 * Note the absence of `fareActual`. It used to be read straight from the body,
 * so the driver could complete a trip at R0 or R5,000 (PLAN.md hole 4). The
 * server now sets it on completion. Zod strips unknown keys, so a driver app
 * that still sends the field gets its trip completed at the server's fare, not
 * an error.
 */
export const rideTransitionSchema = z.object({
  status: z.enum(RIDE_STATUSES),
  cancelReason: reasonSchema,
});

const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  notes: z.string().max(200).optional(),
});

export const orderCreateSchema = z.object({
  storeId: z.string().min(1, "Store ID is required"),
  items: z
    .array(orderItemSchema)
    .min(1, "At least one item is required")
    .max(50, "Too many items")
    // One line per product. Two lines for the same product would each pass the
    // stock check on their own and together oversell it.
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
      message: "Each product may appear only once; set its quantity instead",
    }),
  deliveryAddress: z.string().min(1, "Delivery address is required").max(300),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  notes: z.string().max(500).optional(),
  paymentMethod: z.enum(["CASH", "CARD", "YOCO", "OZOW", "WALLET"]).default("CASH"),
});

/**
 * An order status change. Every order status parses, including the two only the
 * delivery lifecycle may set, so that asking for OUT_FOR_DELIVERY is refused as
 * "not your move" (403) rather than as a malformed request.
 */
export const orderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  cancelReason: reasonSchema,
});

export const orderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
});

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6, "OTP must be 6 digits"),
});

export const deliveryStatusSchema = z.object({
  status: z.enum(DELIVERY_STATUSES),
  failReason: reasonSchema,
});

export const pushTokenSchema = z.object({
  // Bounded: this value is stored and later sent upstream. Expo tokens run to
  // about 50 characters and FCM registration tokens to roughly 200.
  token: z.string().min(1, "Push token is required").max(512),
});

/**
 * A driver's own status and position.
 *
 * The route used to spread the raw body into the update, so a driver could
 * report latitude 1e9, a heading of "north", or `isOnline: "yes"`, and Prisma
 * would either store it or throw a 500 (threat model RD-8). A position is a pair
 * or nothing: a latitude without its longitude is not a place.
 */
export const driverUpdateSchema = z
  .object({
    isOnline: z.boolean().optional(),
    currentLat: z.number().min(-90).max(90).optional(),
    currentLng: z.number().min(-180).max(180).optional(),
    heading: z.number().min(0).max(360).optional(),
  })
  .refine((d) => (d.currentLat === undefined) === (d.currentLng === undefined), {
    message: "currentLat and currentLng must be sent together",
    path: ["currentLat"],
  });
