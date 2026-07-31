import { prisma } from "@/lib/prisma";

/**
 * Server-side fare calculation.
 *
 * Previously the customer app computed the fare itself and posted it as
 * `fareEstimate`, which the API stored verbatim. Two problems with that: the
 * estimate assumed a flat 5 km for every trip regardless of the actual route, and
 * a client-supplied price is a client-controlled price — nothing stopped a crafted
 * request booking a R0 ride.
 *
 * Fare is now derived here from the real routed distance and duration, priced
 * against the `PricingConfig` table (which was already seeded but read by nothing).
 */

/**
 * Per-vehicle rate card.
 *
 * These are the exact figures the customer app was already using, moved server-side
 * unchanged so this refactor does not quietly reprice anyone's ride. The app now
 * displays what the server calculates rather than calculating its own.
 */
export const VEHICLE_RATES: Record<string, { base: number; perKm: number }> = {
  SEDAN: { base: 15, perKm: 7 },
  MINIVAN: { base: 20, perKm: 10 },
  BAKKIE: { base: 25, perKm: 12 },
  SCOOTER: { base: 10, perKm: 5 },
  BICYCLE: { base: 8, perKm: 3 },
};

/** Policy that applies across every vehicle type. Falls back to the seeded values. */
export interface PricingPolicy {
  perMinuteRate: number;
  minimumFare: number;
  platformFeePercent: number;
}

const FALLBACK_POLICY: PricingPolicy = {
  perMinuteRate: 1.5,
  minimumFare: 25,
  platformFeePercent: 10,
};

/** Prisma returns Decimal columns as Decimal instances, not numbers. */
function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Loads pricing policy from the database.
 *
 * A missing row or an unreachable database falls back to the seeded defaults rather
 * than failing the booking — a ride that cannot be priced is a ride that cannot be
 * taken, and the fallback matches what is in the seed anyway.
 */
export async function loadPricingPolicy(configName = "Standard Ride"): Promise<PricingPolicy> {
  try {
    const config = await prisma.pricingConfig.findFirst({
      where: { name: configName, isActive: true },
    });
    if (!config) return FALLBACK_POLICY;

    return {
      perMinuteRate: toNumber(config.perMinuteRate, FALLBACK_POLICY.perMinuteRate),
      minimumFare: toNumber(config.minimumFare, FALLBACK_POLICY.minimumFare),
      platformFeePercent: toNumber(
        config.platformFeePercent,
        FALLBACK_POLICY.platformFeePercent
      ),
    };
  } catch {
    return FALLBACK_POLICY;
  }
}

export interface FareBreakdown {
  vehicleType: string;
  distanceKm: number;
  durationMinutes: number;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  /** What the customer pays, after the minimum-fare floor. */
  total: number;
  /** Platform's cut of the total. */
  platformFee: number;
  /** What the driver nets. */
  driverEarnings: number;
  minimumApplied: boolean;
  currency: "ZAR";
}

/**
 * Pure fare calculation — no database, no network, unit-testable.
 *
 * Rounds to 2 decimals at the end only. Rounding each component first drifts by a
 * few cents on longer trips.
 */
export function calculateFare(
  vehicleType: string,
  distanceKm: number,
  durationMinutes: number,
  policy: PricingPolicy
): FareBreakdown {
  const rates = VEHICLE_RATES[vehicleType] ?? VEHICLE_RATES.SEDAN;

  const safeDistance = Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : 0;
  const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 0;

  const baseFare = rates.base;
  const distanceFare = rates.perKm * safeDistance;
  const timeFare = policy.perMinuteRate * safeDuration;

  const subtotal = baseFare + distanceFare + timeFare;
  const minimumApplied = subtotal < policy.minimumFare;
  const total = round2(minimumApplied ? policy.minimumFare : subtotal);

  const platformFee = round2((total * policy.platformFeePercent) / 100);

  return {
    vehicleType: VEHICLE_RATES[vehicleType] ? vehicleType : "SEDAN",
    distanceKm: safeDistance,
    durationMinutes: safeDuration,
    baseFare,
    distanceFare: round2(distanceFare),
    timeFare: round2(timeFare),
    total,
    platformFee,
    driverEarnings: round2(total - platformFee),
    minimumApplied,
    currency: "ZAR",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
