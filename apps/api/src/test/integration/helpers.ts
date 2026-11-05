import { randomBytes, randomInt } from "node:crypto";
import { NextRequest } from "next/server";
import type { RideStatus, OrderStatus, DeliveryStatus } from "@ride/db/lifecycle";
import { prisma } from "@/lib/prisma";
import { signAuthToken, type UserRoleName } from "@/lib/auth";

/**
 * Fixtures and request helpers for the integration suite.
 *
 * Every test makes the rows it needs, with values that are obviously fake:
 * names with "Test" in them, phone numbers in the unallocated +27 00 range,
 * plates and licence numbers prefixed TEST. Nothing is shared between tests, so
 * they can run in any order against a database other tests have written to.
 */

export { prisma };

export interface TestUser {
  userId: string;
  phone: string;
  role: UserRoleName;
  name: string;
}

function tag(): string {
  return randomBytes(4).toString("hex");
}

/** A number in +27 00…, a range no South African network allocates. */
export function fakePhone(): string {
  return `+2700${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

export async function createUser(role: UserRoleName = "CUSTOMER", name = `Test ${role.toLowerCase()} ${tag()}`): Promise<TestUser> {
  const phone = fakePhone();
  const user = await prisma.user.create({ data: { phone, name, role, isVerified: true } });
  return { userId: user.id, phone, role, name };
}

export interface TestDriver extends TestUser {
  driverId: string;
}

export async function createDriver(
  options: { approved?: boolean; online?: boolean; vehicleApproved?: boolean | null; lat?: number; lng?: number } = {}
): Promise<TestDriver> {
  const { approved = true, online = true, vehicleApproved = true } = options;
  const user = await createUser("DRIVER", `Test Driver ${tag()}`);
  const driver = await prisma.driver.create({
    data: {
      userId: user.userId,
      licenseNumber: `TEST-LIC-${tag()}`,
      idNumberEnc: "test-ciphertext-not-real",
      idNumberHash: `test-hash-${tag()}`,
      idNumberLast4: "0000",
      isApproved: approved,
      isOnline: online,
      currentLat: options.lat ?? -26.2,
      currentLng: options.lng ?? 28.04,
      ...(vehicleApproved === null
        ? {}
        : {
            vehicle: {
              create: {
                type: "SEDAN",
                make: "Testmake",
                model: "Testmodel",
                year: 2020,
                color: "Grey",
                licensePlate: `TEST ${tag()} GP`,
                isApproved: vehicleApproved,
              },
            },
          }),
    },
  });
  return { ...user, driverId: driver.id };
}

export interface TestRider extends TestUser {
  riderId: string;
}

export async function createRider(): Promise<TestRider> {
  const user = await createUser("RIDER", `Test Rider ${tag()}`);
  const rider = await prisma.rider.create({ data: { userId: user.userId, isApproved: true, isOnline: true } });
  return { ...user, riderId: rider.id };
}

export interface TestStore {
  merchant: TestUser & { merchantId: string };
  storeId: string;
}

export async function createStore(options: { approved?: boolean; open?: boolean; minimumOrder?: string } = {}): Promise<TestStore> {
  const user = await createUser("MERCHANT", `Test Merchant ${tag()}`);
  const merchant = await prisma.merchant.create({ data: { userId: user.userId, isApproved: true } });
  const store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      name: `Test Spaza ${tag()}`,
      phone: fakePhone(),
      address: "Shop 1, Testville Plaza, Fakecity",
      lat: -26.2,
      lng: 28.04,
      isApproved: options.approved ?? true,
      isOpen: options.open ?? true,
      deliveryFee: "15.00",
      minimumOrder: options.minimumOrder ?? "0",
      categories: { create: { name: "Test Category" } },
    },
    include: { categories: true },
  });
  return { merchant: { ...user, merchantId: merchant.id }, storeId: store.id };
}

export async function createProduct(storeId: string, options: { price?: string; stock?: number | null; available?: boolean } = {}) {
  const category = await prisma.storeCategory.findFirst({ where: { storeId } });
  return prisma.product.create({
    data: {
      storeId,
      categoryId: category?.id,
      name: `Test Product ${tag()}`,
      price: options.price ?? "10.00",
      stock: options.stock === undefined ? null : options.stock,
      isAvailable: options.available ?? true,
    },
  });
}

export async function createRide(
  customerId: string,
  options: { status?: RideStatus; driverId?: string | null; pickupAddress?: string } = {}
) {
  return prisma.ride.create({
    data: {
      customerId,
      driverId: options.driverId ?? null,
      status: options.status ?? "REQUESTED",
      pickupAddress: options.pickupAddress ?? "12 Test Street, Testville, Fakecity",
      pickupLat: -26.21,
      pickupLng: 28.05,
      dropoffAddress: "1 Other Test Road, Elsewhere, Fakecity",
      dropoffLat: -26.25,
      dropoffLng: 28.1,
      fareEstimate: "85.50",
      distanceKm: 9.4,
      durationMinutes: 18,
      vehicleType: "SEDAN",
    },
  });
}

export async function createOrder(
  customerId: string,
  storeId: string,
  options: { status?: OrderStatus; riderId?: string | null; deliveryStatus?: DeliveryStatus } = {}
) {
  const product = await createProduct(storeId);
  return prisma.order.create({
    data: {
      customerId,
      storeId,
      status: options.status ?? "PENDING",
      subtotal: "10.00",
      deliveryFee: "15.00",
      total: "25.00",
      deliveryAddress: "12 Test Street, Testville, Fakecity",
      deliveryLat: -26.21,
      deliveryLng: 28.05,
      items: { create: { productId: product.id, quantity: 1, unitPrice: "10.00", totalPrice: "10.00" } },
      delivery: {
        create: {
          riderId: options.riderId ?? null,
          status: options.deliveryStatus ?? (options.riderId ? "ASSIGNED" : "PENDING"),
        },
      },
    },
    include: { delivery: true },
  });
}

/** A request as the app would send it, signed for `user` when one is given. */
export function request(
  method: string,
  path: string,
  options: { user?: Pick<TestUser, "userId" | "phone" | "role">; body?: unknown } = {}
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.user) {
    headers.authorization = `Bearer ${signAuthToken({
      userId: options.user.userId,
      phone: options.user.phone,
      role: options.user.role,
    })}`;
  }
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface CallResult {
  status: number;
  // The parsed JSON body. Typed loosely on purpose: the tests probe shapes,
  // including shapes the old code returned.
  body: { success?: boolean; data?: unknown; error?: string } & Record<string, unknown>;
  text: string;
}

/** Calls a route handler in-process, as Next.js would. */
export async function call(handler: Handler, req: NextRequest, params: Record<string, string> = {}): Promise<CallResult> {
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, text };
}

/** The `data` of a response, as a record. */
export function data(result: CallResult): Record<string, unknown> {
  return (result.body.data ?? {}) as Record<string, unknown>;
}

/** The `items` of a paginated response. */
export function items(result: CallResult): Record<string, unknown>[] {
  return ((result.body.data as { items?: unknown[] } | undefined)?.items ?? []) as Record<string, unknown>[];
}

/** Waits for a fire-and-forget side effect, such as the new-ride push. */
export async function eventually(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for a background effect");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function auditRows(entityId: string) {
  return prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });
}
