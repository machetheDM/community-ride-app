import type { Prisma } from "@ride/db";
import { ACTIVE_TRIP_STATUSES, type RideStatus } from "@ride/db/lifecycle";
import { coarseArea, haversineKm } from "@/lib/geo";
import { firstName, type OrderRelation, type RideRelation } from "@/lib/policy";

/**
 * What each caller is shown (OWASP API3, excessive data exposure).
 *
 * Every read names its columns here. No route `include`s a whole model that
 * has sensitive columns any more: an `include` returns every column the model
 * has today and every column added to it later, which is how `GET /api/drivers`
 * came to hand out every operator's ID number, licence number and live position
 * to anyone who asked (PLAN.md section 2, hole 3; threat model RD-6).
 *
 * Two layers. The `*Select` objects say what is read from the database. Where
 * the answer depends on who is asking (a ride's customer and its driver see
 * different things), a `present*` function then builds the response from an
 * allow-list, so a column read for a decision (the store's `merchantId`, the
 * customer's phone outside a trip) cannot leak by being spread into the output.
 *
 * Never selected anywhere in this file: `idNumberEnc`, `idNumberHash`,
 * `licenseNumber`, `pushToken`. `views.test.ts` serialises every select and every
 * presented shape and fails if one of those names appears.
 */

// ─── Shared pieces ────────────────────────────────────────────

/** Straight-line distance rounded to the nearest half kilometre. */
function roughDistanceKm(
  from: { lat: number | null; lng: number | null } | null,
  to: { lat: number; lng: number }
): number | null {
  if (!from || from.lat === null || from.lng === null) return null;
  // Coarse on purpose: a driver could otherwise move around and read the exact
  // pickup point off three precise distances before accepting.
  return Math.round(haversineKm({ lat: from.lat, lng: from.lng }, to) * 2) / 2;
}

function isActiveTrip(status: RideStatus): boolean {
  return ACTIVE_TRIP_STATUSES.includes(status);
}

// ─── Rides ────────────────────────────────────────────────────

/**
 * One read for every ride view. The phone numbers are read so that the two
 * parties of an active trip can call each other; `presentRide` drops them for
 * everyone else and once the trip is over.
 */
export const rideSelect = {
  id: true,
  status: true,
  customerId: true,
  driverId: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  dropoffAddress: true,
  dropoffLat: true,
  dropoffLng: true,
  vehicleType: true,
  fareEstimate: true,
  fareActual: true,
  distanceKm: true,
  durationMinutes: true,
  paymentMethod: true,
  scheduledAt: true,
  acceptedAt: true,
  arrivedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelReason: true,
  cancelledBy: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, phone: true } },
  driver: {
    select: {
      id: true,
      rating: true,
      user: { select: { name: true, phone: true, avatar: true } },
      vehicle: { select: { type: true, make: true, model: true, color: true, licensePlate: true } },
    },
  },
  payment: { select: { amount: true, method: true, status: true } },
  rating: { select: { score: true, comment: true, createdAt: true } },
} satisfies Prisma.RideSelect;

export type RideRecord = Prisma.RideGetPayload<{ select: typeof rideSelect }>;

/**
 * The ride as `relation` may see it.
 *
 * During an active trip (accepted, driver arrived, in progress) the customer sees
 * the driver's name, phone, vehicle and plate, and the driver sees the
 * customer's first name and phone and the pickup. Before acceptance there is no
 * driver to show; after the trip neither side keeps the other's number.
 *
 * Nobody but an admin gets the driver's live coordinates, here or anywhere: the
 * operator's position is the data a person hunting operators would want (threat
 * model RD-6), and the customer app gets an arrival push instead.
 */
export function presentRide(ride: RideRecord, relation: RideRelation) {
  const active = isActiveTrip(ride.status);
  const base = {
    id: ride.id,
    status: ride.status,
    pickupAddress: ride.pickupAddress,
    pickupLat: ride.pickupLat,
    pickupLng: ride.pickupLng,
    dropoffAddress: ride.dropoffAddress,
    dropoffLat: ride.dropoffLat,
    dropoffLng: ride.dropoffLng,
    vehicleType: ride.vehicleType,
    fareEstimate: ride.fareEstimate,
    fareActual: ride.fareActual,
    distanceKm: ride.distanceKm,
    durationMinutes: ride.durationMinutes,
    paymentMethod: ride.paymentMethod,
    scheduledAt: ride.scheduledAt,
    acceptedAt: ride.acceptedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    completedAt: ride.completedAt,
    cancelledAt: ride.cancelledAt,
    cancelReason: ride.cancelReason,
    cancelledBy: ride.cancelledBy,
    createdAt: ride.createdAt,
    updatedAt: ride.updatedAt,
    payment: ride.payment,
    rating: ride.rating,
  };

  const driver = ride.driver;

  if (relation === "CUSTOMER") {
    return {
      ...base,
      customer: { id: ride.customer.id, name: ride.customer.name },
      driver: !driver
        ? null
        : active
          ? {
              id: driver.id,
              rating: driver.rating,
              user: { name: driver.user.name, phone: driver.user.phone, avatar: driver.user.avatar },
              vehicle: driver.vehicle,
            }
          : {
              id: driver.id,
              rating: driver.rating,
              user: { name: driver.user.name, avatar: driver.user.avatar },
              vehicle: driver.vehicle
                ? {
                    type: driver.vehicle.type,
                    make: driver.vehicle.make,
                    model: driver.vehicle.model,
                    color: driver.vehicle.color,
                  }
                : null,
            },
    };
  }

  if (relation === "DRIVER") {
    return {
      ...base,
      customer: {
        name: firstName(ride.customer.name),
        ...(active ? { phone: ride.customer.phone } : {}),
      },
    };
  }

  return {
    ...base,
    customerId: ride.customerId,
    driverId: ride.driverId,
    customer: ride.customer,
    driver: driver
      ? {
          id: driver.id,
          rating: driver.rating,
          user: { name: driver.user.name, phone: driver.user.phone, avatar: driver.user.avatar },
          vehicle: driver.vehicle,
        }
      : null,
  };
}

/**
 * A waiting ride as an approved, online driver sees it before accepting:
 * roughly where, how far, how much, and for which vehicle. No customer name,
 * phone or address until they accept (threat model RD-7).
 */
export const availableRideSelect = {
  id: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  dropoffAddress: true,
  distanceKm: true,
  fareEstimate: true,
  vehicleType: true,
  createdAt: true,
} satisfies Prisma.RideSelect;

export type AvailableRideRecord = Prisma.RideGetPayload<{ select: typeof availableRideSelect }>;

export function presentAvailableRide(
  ride: AvailableRideRecord,
  driverPosition: { lat: number | null; lng: number | null } | null
) {
  return {
    id: ride.id,
    pickupArea: coarseArea(ride.pickupAddress),
    dropoffArea: coarseArea(ride.dropoffAddress),
    /** Length of the trip itself. */
    distanceKm: ride.distanceKm,
    /** How far the pickup is from the driver, to the nearest 0.5 km. */
    pickupDistanceKm: roughDistanceKm(driverPosition, { lat: ride.pickupLat, lng: ride.pickupLng }),
    fareEstimate: ride.fareEstimate,
    vehicleType: ride.vehicleType,
    createdAt: ride.createdAt,
  };
}

// ─── Drivers ──────────────────────────────────────────────────

/**
 * The admin roster. The one view with live coordinates, because matching and
 * support need them; still no ID number (only its last four, for checking a
 * document against the record) and no licence number.
 */
export const driverAdminSelect = {
  id: true,
  isOnline: true,
  isApproved: true,
  currentLat: true,
  currentLng: true,
  heading: true,
  rating: true,
  totalRides: true,
  idNumberLast4: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, phone: true, avatar: true } },
  vehicle: {
    select: {
      id: true,
      type: true,
      make: true,
      model: true,
      year: true,
      color: true,
      licensePlate: true,
      isApproved: true,
    },
  },
  _count: { select: { rides: true } },
} satisfies Prisma.DriverSelect;

/**
 * A driver's own profile. Their own position is left out too: the phone already
 * knows where it is, and a response that never carries coordinates cannot be the
 * one that leaks them.
 */
export const driverSelfSelect = {
  id: true,
  isOnline: true,
  isApproved: true,
  rating: true,
  totalRides: true,
  idNumberLast4: true,
  user: { select: { name: true, phone: true, avatar: true } },
  vehicle: {
    select: { type: true, make: true, model: true, year: true, color: true, licensePlate: true, isApproved: true },
  },
  _count: { select: { rides: true } },
} satisfies Prisma.DriverSelect;

// ─── Orders ───────────────────────────────────────────────────

/**
 * One read for every order view. `store.merchantId` and `delivery.riderId` are
 * read for the ownership decision in `policy.ts`; `presentOrder` does not copy
 * them out.
 */
export const orderSelect = {
  id: true,
  status: true,
  customerId: true,
  storeId: true,
  subtotal: true,
  deliveryFee: true,
  total: true,
  deliveryAddress: true,
  deliveryLat: true,
  deliveryLng: true,
  notes: true,
  paymentMethod: true,
  confirmedAt: true,
  preparedAt: true,
  readyAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelReason: true,
  cancelledBy: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, name: true, phone: true } },
  store: { select: { id: true, name: true, logoUrl: true, address: true, merchantId: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      totalPrice: true,
      notes: true,
      product: { select: { id: true, name: true } },
    },
  },
  delivery: {
    select: {
      id: true,
      status: true,
      riderId: true,
      pickedUpAt: true,
      deliveredAt: true,
      failedAt: true,
      rider: { select: { user: { select: { name: true } } } },
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/**
 * The order as `relation` may see it. The store and the rider see the
 * customer's first name and the delivery address, which they need to do the job;
 * only an admin sees the customer's phone. Nobody sees the merchant id.
 */
export function presentOrder(order: OrderRecord, relation: OrderRelation) {
  const base = {
    id: order.id,
    status: order.status,
    storeId: order.storeId,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    deliveryAddress: order.deliveryAddress,
    deliveryLat: order.deliveryLat,
    deliveryLng: order.deliveryLng,
    notes: order.notes,
    paymentMethod: order.paymentMethod,
    confirmedAt: order.confirmedAt,
    preparedAt: order.preparedAt,
    readyAt: order.readyAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    cancelledBy: order.cancelledBy,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    store: {
      id: order.store.id,
      name: order.store.name,
      logoUrl: order.store.logoUrl,
      address: order.store.address,
    },
    items: order.items,
    delivery: order.delivery
      ? {
          id: order.delivery.id,
          status: order.delivery.status,
          pickedUpAt: order.delivery.pickedUpAt,
          deliveredAt: order.delivery.deliveredAt,
          failedAt: order.delivery.failedAt,
          rider: order.delivery.rider ? { name: firstName(order.delivery.rider.user.name) } : null,
        }
      : null,
  };

  if (relation === "CUSTOMER") return base;
  if (relation === "MERCHANT" || relation === "RIDER") {
    return { ...base, customer: { name: firstName(order.customer.name) } };
  }
  return { ...base, customerId: order.customerId, customer: order.customer };
}

/** A delivery as its rider sees it after a move. */
export const deliverySelect = {
  id: true,
  orderId: true,
  status: true,
  pickedUpAt: true,
  deliveredAt: true,
  failedAt: true,
  failReason: true,
  updatedAt: true,
} satisfies Prisma.DeliverySelect;

// ─── Stores ───────────────────────────────────────────────────

/**
 * Public store fields. Not `merchantId`, which was the one value needed to forge
 * the old portal cookie and become that merchant (threat model PA-3); not the
 * store's phone, which in a one-person shop is often the owner's own number; not
 * approval flags or timestamps.
 */
const storePublicFields = {
  id: true,
  name: true,
  description: true,
  address: true,
  lat: true,
  lng: true,
  logoUrl: true,
  bannerUrl: true,
  isOpen: true,
  openTime: true,
  closeTime: true,
  deliveryFee: true,
  minimumOrder: true,
  rating: true,
  _count: { select: { products: true, orders: true } },
} satisfies Prisma.StoreSelect;

/** Public product fields. Not the stock count, which is the store's business. */
export const productPublicSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  imageUrl: true,
  isAvailable: true,
  categoryId: true,
} satisfies Prisma.ProductSelect;

export const storeListSelect = {
  ...storePublicFields,
  categories: { select: { id: true, name: true, iconUrl: true }, orderBy: { name: "asc" } },
} satisfies Prisma.StoreSelect;

export const storeDetailSelect = {
  ...storePublicFields,
  categories: {
    select: {
      id: true,
      name: true,
      iconUrl: true,
      products: {
        // Sold out is not on the menu. Untracked stock (null) is always available.
        where: { isAvailable: true, OR: [{ stock: null }, { stock: { gt: 0 } }] },
        select: productPublicSelect,
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  },
} satisfies Prisma.StoreSelect;
