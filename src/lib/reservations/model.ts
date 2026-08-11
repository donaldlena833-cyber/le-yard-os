export type ReservationStatus =
  | "pending_verification"
  | "booked"
  | "confirmed"
  | "arrived"
  | "seated"
  | "completed"
  | "cancelled"
  | "no_show";

/** Physical state observed on the restaurant floor at one point in time. */
export type ReservationPhysicalTableState =
  | "available"
  | "occupied"
  | "needs_reset"
  | "blocked";

/**
 * `reserved_upcoming` remains a legacy database event value, but it is not a
 * physical floor state. Future reservations belong to interval inventory.
 */
export type ReservationTableStatusEventState =
  | ReservationPhysicalTableState
  | "reserved_upcoming";

export type ReservationInventoryAllocationState =
  | "tentative"
  | "committed"
  | "blocked";

export interface ReservationGuestSummary {
  id: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  vip: boolean;
  allergies: string | null;
  preferences: string | null;
  visitCount: number;
  lifetimeSpendCents: number;
}

export interface ReservationSummary {
  id: string;
  startsAt: string;
  durationMinutes: number;
  partySize: number;
  status: ReservationStatus;
  source: string;
  bookingChannel: string;
  tableLabel: string | null;
  tableIds: string[];
  specialRequests: string | null;
  guest: ReservationGuestSummary;
}

export interface ReservationFloorTableSummary {
  id: string;
  areaId: string | null;
  label: string;
  minCapacity: number;
  maxCapacity: number;
  isBookable: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: string;
  state: ReservationPhysicalTableState;
  occupyingReservationId: string | null;
  lastChangedAt: string | null;
}

export interface ReservationInventoryAllocationSummary {
  id: string;
  tableId: string;
  reservationId: string | null;
  startsAt: string;
  endsAt: string;
  expiresAt: string | null;
  state: ReservationInventoryAllocationState;
}

export interface ReservationFloorNowProjection {
  observedAt: string;
  businessDateAtObservation: string;
  tables: ReservationFloorTableSummary[];
  /** Interval records overlapping `observedAt`, kept distinct from table color. */
  activeAllocations: ReservationInventoryAllocationSummary[];
}

export interface ReservationIntervalInventoryProjection {
  windowStartsAt: string;
  windowEndsAt: string;
  allocations: ReservationInventoryAllocationSummary[];
}

export interface WaitlistSummary {
  id: string;
  displayName: string;
  partySize: number;
  quotedWaitMinutes: number | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

/** Exact location-scoped grants evaluated for this reservation snapshot. */
export interface ReservationHostPermissions {
  view: boolean;
  operate: boolean;
  override: boolean;
  configure: boolean;
}

export function deriveReservationHostPermissions(
  capabilities: readonly string[],
): ReservationHostPermissions {
  return {
    view: capabilities.includes("reservations.view"),
    operate: capabilities.includes("reservations.operate"),
    override: capabilities.includes("reservations.override"),
    configure: capabilities.includes("reservations.configure"),
  };
}

export function canAccessReservationHost(
  permissions: ReservationHostPermissions,
): boolean {
  return (
    permissions.view ||
    permissions.operate ||
    permissions.override ||
    permissions.configure
  );
}

export interface ReservationHostModel {
  permissions: ReservationHostPermissions;
  businessDate: string;
  timeZone: string;
  currencyCode: string;
  serviceName: string;
  serviceWindow: string;
  reservations: ReservationSummary[];
  floorNow: ReservationFloorNowProjection;
  intervalInventory: ReservationIntervalInventoryProjection;
  combinations: Array<{ id: string; label: string; minCapacity: number; maxCapacity: number; tableIds: string[]; isActive: boolean }>;
  waitlist: WaitlistSummary[];
  metrics: {
    covers: number;
    seated: number;
    remaining: number;
    waitlist: number;
    pendingHoldCount: number;
  };
  pacing: Array<{
    startsAt: string;
    label: string;
    covers: number;
    limit: number;
  }>;
  configuration: {
    ready: boolean;
    onlineBookingEnabled: boolean;
    messagingEnabled: boolean;
    tableCount: number;
    seatCount: number;
  };
}
