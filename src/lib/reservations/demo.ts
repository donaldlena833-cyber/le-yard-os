import {
  addIsoDays,
  localDateKey,
  zonedLocalToIso,
} from "@/data/read-models/local-time";
import {
  fullServiceDayScenario,
  legacySaturdaySimulationId,
} from "@/lib/simulation/full-service-day-v1.ts";
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
  ["12", 2, 0.55, 0.19, 0.13, 0.08], ["13", 2, 0.81, 0.19, 0.13, 0.08],
  ["14", 4, 0.55, 0.07, 0.13, 0.08], ["15", 4, 0.81, 0.07, 0.13, 0.08],
  ["16", 2, 0.21, 0.19, 0.13, 0.08], ["17", 2, 0.21, 0.07, 0.13, 0.08],
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

function isFullServiceReservationPreview(): boolean {
  return [fullServiceDayScenario.id, legacySaturdaySimulationId].includes(
    process.env.NEXT_PUBLIC_SERVICE_SIMULATION ?? "",
  );
}

export function createFullServiceReservationModel(
  permissions: ReservationHostPermissions = demoReservationPermissions,
): ReservationHostModel {
  const scenario = fullServiceDayScenario;
  const observedAt = scenario.observedAt;
  const durationMinutes = 270;
  const reservations: ReservationHostModel["reservations"] =
    scenario.floor.assignments.map((assignment, index) => ({
      id: `scenario-reservation-${String(index + 1).padStart(2, "0")}`,
      version: 2,
      startsAt: assignment.startsAt,
      durationMinutes,
      partySize: assignment.partySize,
      status: "seated",
      source:
        assignment.source === "web"
          ? "le_yard_web"
          : assignment.source === "walk_in"
            ? "walk_in"
            : assignment.source,
      bookingChannel: assignment.source === "web" ? "web" : "staff",
      tableLabel: assignment.tableLabel,
      tableIds: [`demo-table-${assignment.tableLabel}`],
      specialRequests:
        assignment.guestSignal === "allergy"
          ? "Shellfish allergy — acknowledged at pre-shift"
          : assignment.guestSignal === "birthday"
            ? "Birthday candle requested"
            : assignment.guestSignal === "late"
              ? "Late six-top — arrival and table reset tracked"
              : null,
      policyEvidenceCaptured: assignment.source === "web",
      lastRevision: null,
      guest: {
        id: `scenario-guest-${String(index + 1).padStart(2, "0")}`,
        displayName:
          assignment.source === "walk_in"
            ? "Walk-in replacement"
            : `Synthetic Party ${String(index + 1).padStart(2, "0")}`,
        email: `party.${String(index + 1).padStart(2, "0")}@example.invalid`,
        phone: `+1 212 555 ${String(7000 + index)}`,
        vip: assignment.guestSignal === "vip",
        allergies:
          assignment.guestSignal === "allergy" ? "Shellfish" : null,
        preferences:
          assignment.guestSignal === "birthday"
            ? "Birthday"
            : assignment.guestSignal === "late"
              ? "Late arrival"
              : null,
        visitCount: assignment.guestSignal === "vip" ? 12 : 1,
        lifetimeSpendCents: assignment.guestSignal === "vip" ? 185_000 : 0,
      },
    }));

  reservations.push({
    id: "scenario-reservation-no-show",
    version: 2,
    startsAt: "2026-04-18T18:45:00-04:00",
    durationMinutes: 90,
    partySize: 4,
    status: "no_show",
    source: "le_yard_web",
    bookingChannel: "web",
    tableLabel: null,
    tableIds: [],
    specialRequests: null,
    policyEvidenceCaptured: true,
    lastRevision: null,
    guest: {
      id: "scenario-guest-no-show",
      displayName: "Synthetic No-show",
      email: "no-show@example.invalid",
      phone: "+1 212 555 7099",
      vip: false,
      allergies: null,
      preferences: null,
      visitCount: 1,
      lifetimeSpendCents: 0,
    },
  });

  const allocations: ReservationInventoryAllocationSummary[] = reservations
    .filter((reservation) => reservation.status === "seated")
    .flatMap((reservation) =>
      reservation.tableIds.map((tableId) => ({
        id: `scenario-allocation-${reservation.id}-${tableId}`,
        tableId,
        reservationId: reservation.id,
        startsAt: reservation.startsAt,
        endsAt: "2026-04-18T22:30:00-04:00",
        expiresAt: null,
        state: "committed" as const,
      })),
    );
  const byTable = new Map(
    reservations.flatMap((reservation) =>
      reservation.tableIds.map((tableId) => [tableId, reservation] as const),
    ),
  );
  const tables: ReservationFloorTableSummary[] = tablePlan.map(
    ([label, capacity, x, y, width, height]) => ({
      id: `demo-table-${label}`,
      areaId: "demo-main-dining",
      label,
      minCapacity: capacity === 6 ? 3 : 1,
      maxCapacity: capacity,
      isBookable: true,
      x,
      y,
      width,
      height,
      rotation: 0,
      shape: capacity === 2 ? "round" : "rectangle",
      state: "occupied",
      occupyingReservationId: byTable.get(`demo-table-${label}`)?.id ?? null,
      lastChangedAt: observedAt,
    }),
  );

  return {
    permissions,
    businessDate: scenario.businessDate,
    timeZone: scenario.timeZone,
    currencyCode: scenario.currencyCode,
    serviceName: "Dinner · pressure test",
    serviceWindow: "6:00 PM–10:30 PM",
    reservations,
    floorNow: {
      observedAt,
      businessDateAtObservation: scenario.businessDate,
      tables,
      activeAllocations: allocations,
    },
    intervalInventory: {
      windowStartsAt: scenario.servicePeriods[1]!.startsAt,
      windowEndsAt: scenario.servicePeriods[1]!.endsAt,
      allocations,
    },
    combinations: [
      ["4", "5"], ["6", "7"], ["8", "9"], ["10", "11"],
      ["12", "13"], ["14", "15"], ["16", "17"],
    ].map(([left, right]) => ({
      id: `demo-combination-${left}-${right}`,
      label: `${left} + ${right}`,
      minCapacity: 5,
      maxCapacity: Number(left) < 10 ? 10 : 8,
      tableIds: [`demo-table-${left}`, `demo-table-${right}`],
      isActive: true,
    })),
    waitlist: [],
    metrics: {
      covers: scenario.floor.targetPeakCovers,
      seated: scenario.floor.targetPeakCovers,
      remaining: 0,
      waitlist: 0,
      pendingHoldCount: 0,
    },
    pacing: [1, 2, 3, 4, 5].map((wave) => {
      const assignments = scenario.floor.assignments.filter(
        (assignment) => assignment.wave === wave,
      );
      return {
        startsAt: assignments[0]!.startsAt,
        label: new Intl.DateTimeFormat("en-US", {
          timeZone: scenario.timeZone,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(assignments[0]!.startsAt)),
        covers: assignments.reduce(
          (total, assignment) => total + assignment.partySize,
          0,
        ),
        limit: scenario.floor.pacingLimitPerWave,
      };
    }),
    configuration: {
      ready: true,
      onlineBookingEnabled: false,
      messagingEnabled: false,
      staffPushEnabled: false,
      tableCount: scenario.floor.tableCount,
      seatCount: scenario.floor.seatCount,
    },
  };
}

export function createDemoReservationModel(
  businessDate: string,
  permissions: ReservationHostPermissions = demoReservationPermissions,
): ReservationHostModel {
  if (
    businessDate === fullServiceDayScenario.businessDate &&
    isFullServiceReservationPreview()
  ) {
    return createFullServiceReservationModel(permissions);
  }
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
      { id: "demo-wait-1", displayName: "Jamie Lee", partySize: 2, quotedWaitMinutes: 20, status: "waiting", deliveryStatus: null, notes: "Bar is fine", createdAt: timeAt(18, 5) },
      { id: "demo-wait-2", displayName: "Sam Ortiz", partySize: 4, quotedWaitMinutes: 35, status: "notified", deliveryStatus: "sent", notes: null, createdAt: timeAt(18, 12) },
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
    configuration: { ready: true, onlineBookingEnabled: false, messagingEnabled: false, staffPushEnabled: false, tableCount: 17, seatCount: 68 },
  };
}
