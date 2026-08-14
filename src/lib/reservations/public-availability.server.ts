import "server-only";

import { addIsoDays, zonedLocalToIso } from "@/data/read-models/local-time";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isPacingAvailable,
  selectTurnDuration,
  suggestTables,
} from "./availability";
import {
  BookingApiError,
  type BookingApiClientContext,
} from "./api-auth.server";
import { assertPublicReservationInventoryEnabled } from "./public-booking-policy.server";
import { createBookingSlotToken } from "./slot-token.server";
import {
  reservationDurationFitsServiceWindow,
  resolveServiceShiftBookableWindow,
  resolveServiceShiftSlotPolicy,
  servicePeriodAcceptsPartySize,
  type ServiceShiftPolicyException,
} from "./public-availability-time";

type ServiceShiftException = ServiceShiftPolicyException & {
  id: string;
  kind: "closure" | "pacing_override" | "buffer_override";
  status: "active";
  startsAt: string;
  endsAt: string;
  pacingIntervalMinutes: number | null;
  pacingCoverLimit: number | null;
  openingBufferMinutes: number | null;
  closingBufferMinutes: number | null;
  reason: string;
};

type MaterializedServiceShift = {
  shiftId: string;
  servicePeriodId: string;
  name: string;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  defaultDurationMinutes: number;
  pacingIntervalMinutes: number;
  pacingCoverLimit: number;
  minPartySize: number;
  maxPartySize: number;
  onlineEnabled: boolean;
  status: "scheduled" | "cancelled";
  configurationState: "approved" | "internal";
  exceptions: ServiceShiftException[];
};

export async function loadPublicAvailability(
  client: BookingApiClientContext,
  businessDate: string,
  partySize: number,
  options?: { existingManagementSessionAuthorized?: boolean },
) {
  assertPublicReservationInventoryEnabled(options);
  const admin = createAdminClient();
  const reservationRpc = admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { code?: string } | null;
  }>;
  const [locationResult, settingsResult, shiftResult] = await Promise.all([
    admin
      .from("locations")
      .select("id,name,timezone,is_active")
      .eq("organization_id", client.organizationId)
      .eq("id", client.locationId)
      .single(),
    admin
      .from("reservation_settings")
      .select("*")
      .eq("organization_id", client.organizationId)
      .eq("location_id", client.locationId)
      .maybeSingle(),
    reservationRpc("service_reservation_shift_snapshot", {
      p_organization_id: client.organizationId,
      p_location_id: client.locationId,
      p_business_date: businessDate,
    }),
  ]);
  const location = locationResult.data;
  const settings = settingsResult.data;
  if (
    locationResult.error ||
    !location?.is_active ||
    settingsResult.error ||
    shiftResult.error ||
    !settings?.online_booking_enabled ||
    !settings.approved_at
  )
    throw new BookingApiError(
      503,
      "booking_unavailable",
      "Online booking is not available for this location.",
    );
  if (partySize < 1 || partySize > (settings.max_online_party_size ?? 0))
    throw new BookingApiError(
      400,
      "party_size_unavailable",
      "That party size is not available online.",
    );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: location.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const horizon =
    new Date(`${today}T00:00:00Z`).valueOf() +
    (settings.booking_horizon_days ?? 0) * 86_400_000;
  if (
    businessDate < today ||
    new Date(`${businessDate}T00:00:00Z`).valueOf() > horizon
  )
    throw new BookingApiError(
      400,
      "outside_booking_window",
      "That date is outside the booking window.",
    );
  const start = zonedLocalToIso(businessDate, "00:00", location.timezone);
  const shifts = (shiftResult.data ?? []) as MaterializedServiceShift[];
  const periods = shifts.filter(
    (period) =>
      period.status === "scheduled" &&
      period.onlineEnabled &&
      period.configurationState === "approved" &&
      servicePeriodAcceptsPartySize(
        partySize,
        period.minPartySize,
        period.maxPartySize,
      ),
  );
  const end = zonedLocalToIso(
    addIsoDays(businessDate, 2),
    "00:00",
    location.timezone,
  );
  if (!start || !end)
    throw new BookingApiError(
      503,
      "availability_unavailable",
      "Availability could not be loaded.",
    );
  const [
    tableResult,
    allocationResult,
    reservationResult,
    combinationResult,
    memberResult,
    statusResult,
  ] = await Promise.all([
    admin
      .from("reservation_tables")
      .select("*")
      .eq("organization_id", client.organizationId)
      .eq("location_id", client.locationId)
      .eq("is_active", true)
      .eq("is_bookable", true)
      .not("approved_at", "is", null),
    admin
      .from("reservation_table_allocations")
      .select("table_id,starts_at,ends_at,is_active,expires_at")
      .eq("organization_id", client.organizationId)
      .eq("location_id", client.locationId)
      .eq("is_active", true)
      .lt("starts_at", end)
      .gt("ends_at", start),
    reservationRpc("service_reservation_pacing_snapshot", {
      p_organization_id: client.organizationId,
      p_location_id: client.locationId,
      p_from: start,
      p_to: end,
    }),
    admin
      .from("reservation_table_combinations")
      .select("*")
      .eq("organization_id", client.organizationId)
      .eq("location_id", client.locationId)
      .eq("is_active", true),
    admin
      .from("reservation_table_combination_members")
      .select("combination_id,table_id,sort_order")
      .eq("organization_id", client.organizationId),
    admin
      .from("table_status_events")
      .select("table_id,status,occurred_at")
      .eq("organization_id", client.organizationId)
      .eq("location_id", client.locationId)
      .order("occurred_at", { ascending: false })
      .limit(1_000),
  ]);
  if (
    [
      tableResult,
      allocationResult,
      reservationResult,
      combinationResult,
      memberResult,
      statusResult,
    ].some((result) => result.error)
  )
    throw new BookingApiError(
      503,
      "availability_unavailable",
      "Availability could not be loaded.",
    );
  const rulesResult = periods.length
    ? await admin
        .from("reservation_turn_rules")
        .select("*")
        .eq("organization_id", client.organizationId)
        .in(
          "service_period_id",
          periods.map((period) => period.servicePeriodId),
        )
    : { data: [], error: null };
  if (rulesResult.error)
    throw new BookingApiError(
      503,
      "availability_unavailable",
      "Availability could not be loaded.",
    );
  const latestStatus = new Map<string, string>();
  for (const event of statusResult.data ?? []) {
    if (!latestStatus.has(event.table_id))
      latestStatus.set(event.table_id, event.status);
  }
  const tables = (tableResult.data ?? [])
    .filter((table) => latestStatus.get(table.id) !== "blocked")
    .map((table) => ({
      id: table.id,
      label: table.label,
      minCapacity: table.min_capacity,
      maxCapacity: table.max_capacity,
      isBookable: table.is_bookable,
      isActive: table.is_active,
    }));
  const combinations = (combinationResult.data ?? []).map((combination) => ({
    id: combination.id,
    label: combination.label,
    minCapacity: combination.min_capacity,
    maxCapacity: combination.max_capacity,
    isActive: combination.is_active,
    tableIds: (memberResult.data ?? [])
      .filter((member) => member.combination_id === combination.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((member) => member.table_id),
  }));
  const allocations = (allocationResult.data ?? []).map((allocation) => ({
    tableId: allocation.table_id,
    startsAt: allocation.starts_at,
    endsAt: allocation.ends_at,
    isActive: allocation.is_active,
    expiresAt: allocation.expires_at,
  }));
  const reservations = (
    (reservationResult.data ?? []) as Array<{
      startsAt: string;
      partySize: number;
      kind: "reservation" | "hold";
    }>
  ).map((reservation) => ({
    startsAt: reservation.startsAt,
    partySize: reservation.partySize,
    status: reservation.kind === "hold" ? "pending_verification" : "confirmed",
  }));
  const earliest = Date.now() + (settings.minimum_lead_minutes ?? 0) * 60_000;
  const slots = periods.flatMap((period) => {
    const serviceStartsAt = new Date(period.startsAt).valueOf();
    const serviceEndsAt = new Date(period.endsAt).valueOf();
    if (!Number.isFinite(serviceStartsAt) || !Number.isFinite(serviceEndsAt))
      return [];
    const bookable = resolveServiceShiftBookableWindow({
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      exceptions: period.exceptions,
    });
    const bookableStartsAt = bookable.startsAt;
    const bookableEndsAt = bookable.endsAt;
    const durationMinutes = selectTurnDuration(
      partySize,
      period.defaultDurationMinutes,
      (rulesResult.data ?? [])
        .filter((rule) => rule.service_period_id === period.servicePeriodId)
        .map((rule) => ({
          minPartySize: rule.min_party_size,
          maxPartySize: rule.max_party_size,
          durationMinutes: rule.duration_minutes,
        })),
    );
    const output = [];
    for (
      let cursor = bookableStartsAt;
      cursor + durationMinutes * 60_000 <= bookableEndsAt;
      cursor +=
        (settings.slot_interval_minutes ?? period.pacingIntervalMinutes) *
        60_000
    ) {
      const startsAt = new Date(cursor).toISOString();
      const endsAt = cursor + durationMinutes * 60_000;
      const policy = resolveServiceShiftSlotPolicy({
        startsAt: cursor,
        endsAt,
        exceptions: period.exceptions,
        pacingIntervalMinutes: period.pacingIntervalMinutes,
        pacingCoverLimit: period.pacingCoverLimit,
      });
      if (
        policy.isClosed ||
        new Date(startsAt).valueOf() < earliest ||
        !reservationDurationFitsServiceWindow(
          startsAt,
          durationMinutes,
          new Date(bookableEndsAt).toISOString(),
        )
      )
        continue;
      if (
        !isPacingAvailable({
          startsAt,
          partySize,
          intervalMinutes: policy.pacingIntervalMinutes,
          coverLimit: policy.pacingCoverLimit,
          reservations,
        })
      )
        continue;
      const suggestion = suggestTables({
        partySize,
        startsAt,
        durationMinutes,
        tables,
        combinations,
        allocations,
      })[0];
      if (!suggestion) continue;
      output.push({
        startsAt,
        durationMinutes,
        timeLabel: new Intl.DateTimeFormat("en-US", {
          timeZone: location.timezone,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(startsAt)),
        service: period.name,
        slotToken: createBookingSlotToken({
          clientId: client.id,
          locationId: client.locationId,
          startsAt,
          durationMinutes,
          partySize,
          tableIds: suggestion.tableIds,
        }),
      });
    }
    return output;
  });
  return {
    location: {
      id: location.id,
      name: location.name,
      timeZone: location.timezone,
    },
    businessDate,
    partySize,
    slots,
  };
}
