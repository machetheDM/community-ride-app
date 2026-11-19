import type { Prisma } from "@ride/db";
import { ACTIVE_TRIP_STATUSES, type RideStatus } from "@ride/db/lifecycle";
import { coarseArea, haversineKm } from "@/lib/geo";
import { firstName, type OrderRelation, type RideRelation } from "@/lib/policy";
import { isActiveDelivery, isTrackedDelivery, revealHandoverCode, roundKm } from "@/lib/delivery";

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
      // Read for the customer's map during an active trip only; presentRide lets
      // it out as `location` to the ride's own customer and nowhere else.
      currentLat: true,
      currentLng: true,
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
              // Where the car is, while it is coming for or carrying this customer:
              // what the tracking map is for. Not before a driver accepts, and not
              // after the trip, when it would be where the driver went next.
              location:
                typeof driver.currentLat === "number" && typeof driver.currentLng === "number"
                  ? { lat: driver.currentLat, lng: driver.currentLng }
                  : null,
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
  store: {
    select: {
      id: true,
      name: true,
      logoUrl: true,
      address: true,
      lat: true,
      lng: true,
      merchantId: true,
      complex: { select: { name: true } },
    },
  },
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
      // Read for the customer's view only; `presentOrder` decrypts it for the
      // customer and copies it nowhere else.
      handoverCodeEnc: true,
      assignedAt: true,
      pickedUpAt: true,
      enRouteAt: true,
      deliveredAt: true,
      failedAt: true,
      rider: {
        select: {
          currentLat: true,
          currentLng: true,
          user: { select: { name: true } },
          vehicle: { select: { type: true, color: true, licensePlate: true } },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

/**
 * The order as `relation` may see it. The store and the rider see the
 * customer's first name and the delivery address, which they need to do the job.
 * The customer's phone goes to the assigned rider only while the delivery is
 * theirs and active (the rule rides already follow), and to an admin. Nobody sees
 * the merchant id.
 *
 * Delivery (PLAN.md Phase 2):
 * - The handover code goes to the customer alone, until the delivery is over.
 *   The rider must hear it at the door; a code the rider's app could read would
 *   prove nothing.
 * - The customer sees the rider's first name and vehicle once one is assigned,
 *   and the rider's position only between pickup and handover: where a rider is
 *   on their way to the store, or after the job, is not the customer's business.
 */
export function presentOrder(order: OrderRecord, relation: OrderRelation) {
  const delivery = order.delivery;
  const active = delivery ? isActiveDelivery(delivery.status) : false;
  const tracked = delivery ? isTrackedDelivery(delivery.status) : false;
  const rider = delivery?.rider ?? null;

  const deliveryForEveryone = delivery
    ? {
        id: delivery.id,
        status: delivery.status,
        assignedAt: delivery.assignedAt,
        pickedUpAt: delivery.pickedUpAt,
        enRouteAt: delivery.enRouteAt,
        deliveredAt: delivery.deliveredAt,
        failedAt: delivery.failedAt,
        rider: rider ? { name: firstName(rider.user.name) } : null,
      }
    : null;

  const deliveryForCustomer =
    delivery && deliveryForEveryone
      ? {
          ...deliveryForEveryone,
          rider:
            rider && active
              ? {
                  name: firstName(rider.user.name),
                  vehicle: rider.vehicle
                    ? { type: rider.vehicle.type, color: rider.vehicle.color, licensePlate: rider.vehicle.licensePlate }
                    : null,
                  location:
                    tracked && typeof rider.currentLat === "number" && typeof rider.currentLng === "number"
                      ? { lat: rider.currentLat, lng: rider.currentLng }
                      : null,
                }
              : deliveryForEveryone.rider,
          handoverCode:
            order.status !== "CANCELLED" && delivery.status !== "DELIVERED" && delivery.status !== "FAILED"
              ? revealHandoverCode(delivery.handoverCodeEnc)
              : null,
        }
      : null;

  const view = presentOrderBase(order);
  if (relation === "CUSTOMER") return { ...view, delivery: deliveryForCustomer };
  if (relation === "RIDER") {
    return {
      ...view,
      delivery: deliveryForEveryone,
      store: { ...view.store, lat: order.store.lat, lng: order.store.lng },
      customer: active
        ? { name: firstName(order.customer.name), phone: order.customer.phone }
        : { name: firstName(order.customer.name) },
    };
  }
  if (relation === "MERCHANT") {
    return { ...view, delivery: deliveryForEveryone, customer: { name: firstName(order.customer.name) } };
  }
  return { ...view, delivery: deliveryForEveryone, customerId: order.customerId, customer: order.customer };
}

/** The fields every party sees, delivery aside. */
function presentOrderBase(order: OrderRecord) {
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
  };
  return { ...base, store: { ...base.store, complex: order.store.complex?.name ?? null } };
}

/** A delivery as its rider sees it after a move. Never the handover code. */
export const deliverySelect = {
  id: true,
  orderId: true,
  status: true,
  assignedAt: true,
  pickedUpAt: true,
  enRouteAt: true,
  deliveredAt: true,
  failedAt: true,
  failReason: true,
  handoverAttempts: true,
  updatedAt: true,
} satisfies Prisma.DeliverySelect;

/**
 * A waiting delivery as a rider sees it before accepting: enough to choose a job,
 * nothing that identifies the customer. The store is a public shop, so its name
 * and address are shown; the drop-off is a suburb label and a distance rounded to
 * half a kilometre, the same rule the ride list follows.
 */
export const availableDeliverySelect = {
  id: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      status: true,
      customerId: true,
      deliveryFee: true,
      deliveryAddress: true,
      deliveryLat: true,
      deliveryLng: true,
      createdAt: true,
      _count: { select: { items: true } },
      store: { select: { name: true, address: true, lat: true, lng: true, complex: { select: { name: true } } } },
    },
  },
} satisfies Prisma.DeliverySelect;

export type AvailableDeliveryRecord = Prisma.DeliveryGetPayload<{ select: typeof availableDeliverySelect }>;

export function presentAvailableDelivery(delivery: AvailableDeliveryRecord, distanceToStoreKm: number) {
  const { order } = delivery;
  const dropoff = order.deliveryLat && order.deliveryLng ? { lat: order.deliveryLat, lng: order.deliveryLng } : null;
  return {
    id: delivery.id,
    orderStatus: order.status,
    store: { name: order.store.name, address: order.store.address, complex: order.store.complex?.name ?? null },
    distanceToStoreKm: roundKm(distanceToStoreKm),
    dropoffArea: coarseArea(order.deliveryAddress),
    storeToDropoffKm: dropoff ? roughDistanceKm({ lat: order.store.lat, lng: order.store.lng }, dropoff) : null,
    itemCount: order._count.items,
    deliveryFee: order.deliveryFee,
    waitingSince: order.createdAt,
  };
}

/** A scooter rider's own profile: never the ID number, never coordinates. */
export const riderSelfSelect = {
  id: true,
  isOnline: true,
  isApproved: true,
  rating: true,
  totalDeliveries: true,
  idNumberLast4: true,
  user: { select: { name: true, avatar: true } },
  vehicle: { select: { type: true, make: true, model: true, color: true, licensePlate: true, isApproved: true } },
} satisfies Prisma.RiderSelect;

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
  // Read to work out what the customer will pay; presentStore returns the fee
  // that applies and the complex's name and radius, not the raw row.
  complex: { select: { name: true, deliveryFee: true, deliveryRadiusKm: true, isActive: true } },
  _count: { select: { products: true, orders: true } },
} satisfies Prisma.StoreSelect;

type StoreFee = Prisma.Decimal | string | number;

/**
 * A public store as the customer app shows it: the delivery fee that will be
 * charged. A store in an active complex charges the complex's fee (PLAN.md Phase
 * 2.2), so returning the store's own would quote one price and bill another.
 */
export function presentStore<
  T extends {
    deliveryFee: StoreFee;
    complex: { name: string; deliveryFee: StoreFee; deliveryRadiusKm: number; isActive: boolean } | null;
  },
>(store: T) {
  const { complex, ...rest } = store;
  const active = complex?.isActive ? complex : null;
  return {
    ...rest,
    deliveryFee: active ? active.deliveryFee : store.deliveryFee,
    complex: active ? { name: active.name, deliveryRadiusKm: active.deliveryRadiusKm } : null,
  };
}

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
