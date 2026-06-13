// ─── Geo ──────────────────────────────────────────────────────
export interface LatLng {
  lat: number;
  lng: number;
}

export interface Address extends LatLng {
  formatted: string;
}

// ─── Ride Booking ─────────────────────────────────────────────
export interface RideRequest {
  pickupAddress: Address;
  dropoffAddress: Address;
  paymentMethod: "CASH" | "CARD" | "YOCO" | "WALLET";
  scheduledAt?: string;
}

export interface FareEstimate {
  distanceKm: number;
  durationMinutes: number;
  fareMin: number;
  fareMax: number;
  currency: string;
}

export interface NearbyDriver {
  driverId: string;
  name: string;
  avatar?: string;
  vehicle: {
    make: string;
    model: string;
    color: string;
    licensePlate: string;
    type: string;
  };
  rating: number;
  distanceKm: number;
  lat: number;
  lng: number;
  heading?: number;
}

// ─── Order ────────────────────────────────────────────────────
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  notes?: string;
}

export interface OrderRequest {
  storeId: string;
  items: CartItem[];
  deliveryAddress: Address;
  notes?: string;
  paymentMethod: "CASH" | "CARD" | "YOCO" | "WALLET";
}

// ─── Driver / Rider Location Update ──────────────────────────
export interface LocationUpdate {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
}

// ─── Push Notification Payload ────────────────────────────────
export interface PushPayload {
  title: string;
  body: string;
  type:
    | "ride_request"
    | "ride_accepted"
    | "ride_arrived"
    | "ride_completed"
    | "ride_cancelled"
    | "order_confirmed"
    | "order_preparing"
    | "order_ready"
    | "order_delivered"
    | "delivery_assigned"
    | "promo";
  data?: Record<string, string>;
}

// ─── API Response Wrappers ────────────────────────────────────
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Pagination ───────────────────────────────────────────────
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
