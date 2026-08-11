import {
  addIsoDays,
  localDateKey,
  zonedLocalToIso,
} from "@/data/read-models/local-time";
import { isReservationAllocationActiveAt } from "./floor-projection";
import type {
  ReservationFloorTableSummary,
  ReservationHostModel,
  ReservationHostPermissions,
  ReservationInventoryAllocationSummary,
  ReservationStatus,
} from "./model";

const tablePlan = [
  ["1", 2, 0.40, 0.91, 0.11, 0.07], ["2", 2, 0.62, 0.91, 0.11, 0.07], ["3", 2, 0.84, 0.91, 0.11, 0.07],
  ["4", 4, 0.55, 0.76, 0.13, 0.08], ["5", 6, 0.81, 0.76, 0.17, 0.08],
  ["6", 4, 0.55, 0.61, 0.13, 0.08], ["7", 6, 0.81, 0.61, 0.17, 0.08],
  ["8", 4, 0.55, 0.46, 0.13, 0.08], ["9", 6, 0.81, 0.46, 0.17, 0.08],
  ["10", 4, 0.55, 0.31, 0.13, 0.08], ["11", 4, 0.81, 0.31, 0.13, 0.08],
  ["12", 4, 0.55, 0.19, 0.13, 0.08], ["13", 4, 0.81, 0.19, 0.13, 0.08],
  ["14", 4, 0.55, 0.07, 0.13, 0.08], ["15", 4, 0.81, 0.07, 0.13, 0.08],
  ["16", 4, 0.21, 0.19, 0.13, 0.08], ["17", 4, 0.21, 0.07, 0.13, 0.08],
] as const;

const guests = [
  ["Nora Example", 2, "confirmed", "4", true, "Tree nuts", "Window table · sparkling water"],
  ["Maya Rivera", 4, "booked", "6", false, null, "Celebrating an anniversary"],
  ["Jon Bell", 2, "arrived", "2", false, null, "Prefers quiet seating"],
  ["Amir Shah", 6, "seated", "9", true, "Shellfish", "Sparkling water on arrival"],
  ["Sofia Chen", 3, "confirmed", "10", false, null, null],
  ["Theo Martin", 4, "booked", "12", false, "Dairy", "Birthday candle requested"],
  ["Alex Kim", 2, "booked", null, false, null, null],
  ["Priya Patel", 5, "confirmed", "7", true, null, "Regular · enjoys bar pours"],
] as const;

const demoReservationPermissions: ReservationHostPermissions = {
  view: true,
  operate: true,
  override: true,
  configure: true,
};

export function createDemoReservationModel(
  businessDate: string,
  permissions: ReservationHostPermissions = demoReservationPermissions,
): ReservationHostModel {
  const timeZone = "America/New_York";
  const timeAt = (hour: number, minute: number) => zonedLocalToIso(businessDate, `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, timeZone)!;
  const observedAt = new Date().toISOString();
  const businessDateAtObservation = localDateKey(observedAt, timeZone);
  const isObservedBusinessDate = businessDate === businessDateAtObservation;
  const reservations = guests.map((guest, index) => ({
    id: `demo-reservation-${index + 1}`,
    version: index === 0 ? 2 : 1,
    startsAt: timeAt(17 + Math.floor(index / 2), index % 2 ? 30 : 0),
    durationMinutes: guest[1] >= 5 ? 120 : 90,
    partySize: guest[1],
    status: guest[2] as ReservationStatus,
    source: index % 3 === 0 ? "le_yard_web" : index % 3 === 1 ? "phone" : "manual",
    bookingChannel: index % 3 === 0 ? "web" : "staff",
    tableLabel: guest[3],
    tableIds: guest[3] ? [`demo-table-${guest[3]}`] : [],
    specialRequests: index === 1 ? "Anniversary dinner" : null,
    policyEvidenceCaptured: index === 0,
    lastRevision:
      index === 0
        ? {
            id: "demo-reservation-revision-1",
            kind: "staff_modified" as const,
            version: 2,
            changedAt: observedAt,
            previousReservedAt: timeAt(16, 30),
            previousPartySize: guest[1],
          }
        : null,
    guest: {
      id: `demo-guest-${index + 1}`,
      displayName: guest[0],
      email: `${guest[0].toLowerCase().replaceAll(" ", ".")}@example.invalid`,
      phone: `+1 212 555 01${String(40 + index).slice(-2)}`,
      vip: guest[4],
      allergies: guest[5],
      preferences: guest[6],
      visitCount: index % 3 === 0 ? 12 - index : index + 1,
      lifetimeSpendCents: (index + 2) * 18_600,
    },
  }));
  const byTable = new Map(reservations.flatMap((reservation) => reservation.tableIds.map((id) => [id, reservation])));
  const intervalAllocations: ReservationInventoryAllocationSummary[] = reservations.flatMap((reservation) =>
    reservation.tableIds.map((tableId) => ({
      id: `demo-allocation-${reservation.id}-${tableId}`,
      tableId,
      reservationId: reservation.id,
      startsAt: reservation.startsAt,
      endsAt: new Date(
        new Date(reservation.startsAt).valueOf() +
          reservation.durationMinutes * 60_000,
      ).toISOString(),
      expiresAt: null,
      state: "committed" as const,
    })),
  );
  intervalAllocations.push({
    id: "demo-allocation-block-table-17",
    tableId: "demo-table-17",
    reservationId: null,
    startsAt: timeAt(20, 0),
    endsAt: timeAt(21, 0),
    expiresAt: null,
    state: "blocked",
  });
  const tables: ReservationFloorTableSummary[] = tablePlan.map(([label, capacity, x, y, width, height]) => {
    const reservation = byTable.get(`demo-table-${label}`);
    const state = label === "9" ? "occupied" : label === "15" ? "needs_reset" : "available";
    return { id: `demo-table-${label}`, areaId: "demo-main-dining", label, minCapacity: capacity === 6 ? 3 : 1, maxCapacity: capacity, isBookable: true, x, y, width, height, rotation: 0, shape: capacity === 2 ? "round" : "rectangle", state, occupyingReservationId: state === "occupied" && isObservedBusinessDate ? reservation?.id ?? null : null, lastChangedAt: state === "available" ? null : observedAt };
  });
  const activeReservations = reservations.filter((reservation) => !["cancelled", "no_show"].includes(reservation.status));
  const covers = activeReservations.reduce((sum, reservation) => sum + reservation.partySize, 0);
  const seated = activeReservations.filter((reservation) => ["seated", "completed"].includes(reservation.status)).reduce((sum, reservation) => sum + reservation.partySize, 0);
  return {
    permissions,
    businessDate,
    timeZone,
    currencyCode: "USD",
    serviceName: "Dinner",
    serviceWindow: "5:00 PM–10:30 PM",
    reservations,
    floorNow: {
      observedAt,
      businessDateAtObservation,
      tables,
      activeAllocations: isObservedBusinessDate
        ? intervalAllocations.filter((allocation) =>
            isReservationAllocationActiveAt(allocation, observedAt),
          )
        : [],
    },
    intervalInventory: {
      windowStartsAt: timeAt(0, 0),
      windowEndsAt: zonedLocalToIso(
        addIsoDays(businessDate, 1),
        "00:00",
        timeZone,
      )!,
      allocations: intervalAllocations,
    },
    combinations: [["4", "5"], ["6", "7"], ["8", "9"], ["10", "11"], ["12", "13"], ["14", "15"], ["16", "17"]].map(([left, right]) => ({ id: `demo-combination-${left}-${right}`, label: `${left} + ${right}`, minCapacity: 5, maxCapacity: Number(left) < 10 ? 10 : 8, tableIds: [`demo-table-${left}`, `demo-table-${right}`], isActive: true })),
    waitlist: [
      { id: "demo-wait-1", displayName: "Jamie Lee", partySize: 2, quotedWaitMinutes: 20, status: "waiting", notes: "Bar is fine", createdAt: timeAt(18, 5) },
      { id: "demo-wait-2", displayName: "Sam Ortiz", partySize: 4, quotedWaitMinutes: 35, status: "notified", notes: null, createdAt: timeAt(18, 12) },
    ],
    metrics: {
      covers,
      seated,
      remaining: covers - seated,
      waitlist: 2,
      pendingHoldCount: 0,
    },
    pacing: [17, 18, 19, 20, 21].map((hour) => ({
      startsAt: timeAt(hour, 0),
      label: `${hour > 12 ? hour - 12 : hour}:00`,
      covers: activeReservations
        .filter(
          (reservation) =>
            new Date(reservation.startsAt).getUTCHours() === hour + 4,
        )
        .reduce((sum, reservation) => sum + reservation.partySize, 0),
      limit: 14,
    })),
    configuration: { ready: true, onlineBookingEnabled: false, messagingEnabled: false, tableCount: 17, seatCount: 68 },
  };
}
