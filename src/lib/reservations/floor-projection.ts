import type {
  ReservationInventoryAllocationSummary,
  ReservationInventoryAllocationState,
  ReservationFloorTableSummary,
  ReservationPhysicalTableState,
  ReservationTableStatusEventState,
} from "./model";

export function isReservationTableReadyForImmediateSeating(
  table: Pick<ReservationFloorTableSummary, "isBookable" | "state">,
): boolean {
  return table.isBookable && table.state === "available";
}

export function floorNowMatchesInventoryDate(
  businessDateAtObservation: string,
  inventoryBusinessDate: string,
): boolean {
  return businessDateAtObservation === inventoryBusinessDate;
}

export function isReservationPhysicalStatusEvent(
  status: ReservationTableStatusEventState,
): status is ReservationPhysicalTableState {
  return status !== "reserved_upcoming";
}

export function latestReservationPhysicalStatus(
  newestFirst: readonly ReservationTableStatusEventState[],
): ReservationPhysicalTableState | null {
  return newestFirst.find(isReservationPhysicalStatusEvent) ?? null;
}

export function reservationTableAcceptsIntervalBookings(
  configuredBookable: boolean,
  latestPhysicalStatus: ReservationPhysicalTableState | null,
): boolean {
  return configuredBookable && latestPhysicalStatus !== "blocked";
}

export function isReservationAllocationActiveAt(
  allocation: Pick<
    ReservationInventoryAllocationSummary,
    "startsAt" | "endsAt" | "expiresAt"
  >,
  observedAt: string,
): boolean {
  const observedAtMs = new Date(observedAt).valueOf();
  return (
    new Date(allocation.startsAt).valueOf() <= observedAtMs &&
    new Date(allocation.endsAt).valueOf() > observedAtMs &&
    (allocation.expiresAt === null ||
      new Date(allocation.expiresAt).valueOf() > observedAtMs)
  );
}

export function resolveReservationPhysicalTableState(input: {
  latestStatus: ReservationTableStatusEventState | null;
  currentAllocationState: ReservationInventoryAllocationState | null;
}): ReservationPhysicalTableState {
  if (input.currentAllocationState === "blocked") return "blocked";
  if (input.latestStatus === "reserved_upcoming") return "available";
  return input.latestStatus ?? "available";
}
