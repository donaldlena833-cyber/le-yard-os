import type { ReservationHostModel } from "@/lib/reservations/model";
import { addIsoDays } from "@/data/read-models/local-time";
import type {
  ActionUrgency,
  ServicePhase,
  WorkspaceDestination,
} from "./action-registry";

export interface ActionFreshnessMetadata {
  source: "tenant_reservation_snapshot";
  observedAt: string;
  staleAt: string;
  maxAgeSeconds: number;
  businessDate: string;
}

export interface TodayReservationException {
  id: "setup" | "arrived" | "unassigned" | "waitlist" | "pacing";
  label: string;
  detail: string;
  count: number;
  urgency: ActionUrgency;
  destination: WorkspaceDestination;
}

export interface TodayReservationSlice {
  serviceName: string;
  serviceWindow: string;
  servicePhase: ServicePhase;
  timeZone: string;
  covers: number;
  seated: number;
  reservationCount: number;
  pendingHoldCount: number;
  configurationReady: boolean;
  freshness: ActionFreshnessMetadata;
  exceptions: TodayReservationException[];
}

const freshnessWindowSeconds = 60;

function localDateAndMinutes(value: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function deriveServicePhase(
  model: Pick<ReservationHostModel, "businessDate" | "serviceWindow" | "timeZone">,
  observedAt: string,
): ServicePhase {
  const local = localDateAndMinutes(observedAt, model.timeZone);
  const match = /^(\d{2}):(\d{2})[–-](\d{2}):(\d{2})$/.exec(model.serviceWindow);
  if (!match) return "off_hours";
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  const overnight = end <= start;
  const nextCalendarDate = addIsoDays(model.businessDate, 1);
  const observedServiceMinutes = local.date === model.businessDate
    ? local.minutes
    : overnight && local.date === nextCalendarDate
      ? local.minutes + 24 * 60
      : null;
  if (observedServiceMinutes == null) return "off_hours";
  const effectiveEnd = overnight ? end + 24 * 60 : end;
  if (observedServiceMinutes < start) return "pre_service";
  if (observedServiceMinutes < effectiveEnd) return "in_service";
  return "post_service";
}

export function deriveTodayReservationSlice(
  model: ReservationHostModel,
  observedAt = new Date().toISOString(),
): TodayReservationSlice {
  const destination = `/reservations?date=${model.businessDate}` as const;
  const exceptions: TodayReservationException[] = [];
  const arrived = model.reservations.filter(
    (reservation) => reservation.status === "arrived",
  ).length;
  const unassigned = model.reservations.filter(
    (reservation) =>
      !reservation.tableLabel &&
      !["cancelled", "completed", "no_show", "pending_verification"].includes(
        reservation.status,
      ),
  ).length;
  const pacing = model.pacing.filter((bucket) => bucket.covers > bucket.limit).length;

  if (!model.configuration.ready) {
    exceptions.push({
      id: "setup",
      label: "Service setup needs review",
      detail: "The internal floor or service rules are not approved.",
      count: 1,
      urgency: "urgent",
      destination,
    });
  }
  if (arrived) {
    exceptions.push({
      id: "arrived",
      label: "Guests waiting to be seated",
      detail: `${arrived} arrived part${arrived === 1 ? "y" : "ies"} need a seating decision.`,
      count: arrived,
      urgency: "urgent",
      destination,
    });
  }
  if (unassigned) {
    exceptions.push({
      id: "unassigned",
      label: "Assign tables",
      detail: `${unassigned} active reservation${unassigned === 1 ? " is" : "s are"} still unassigned.`,
      count: unassigned,
      urgency: "attention",
      destination,
    });
  }
  if (model.waitlist.length) {
    exceptions.push({
      id: "waitlist",
      label: "Review the waitlist",
      detail: `${model.waitlist.length} part${model.waitlist.length === 1 ? "y" : "ies"} are waiting or have an active offer.`,
      count: model.waitlist.length,
      urgency: "attention",
      destination,
    });
  }
  if (pacing) {
    exceptions.push({
      id: "pacing",
      label: "Pacing limit exceeded",
      detail: `${pacing} service interval${pacing === 1 ? " is" : "s are"} above the configured cover limit.`,
      count: pacing,
      urgency: "urgent",
      destination,
    });
  }

  return {
    serviceName: model.serviceName,
    serviceWindow: model.serviceWindow,
    servicePhase: deriveServicePhase(model, observedAt),
    timeZone: model.timeZone,
    covers: model.metrics.covers,
    seated: model.metrics.seated,
    reservationCount: model.reservations.length,
    pendingHoldCount: model.metrics.pendingHoldCount,
    configurationReady: model.configuration.ready,
    freshness: {
      source: "tenant_reservation_snapshot",
      observedAt,
      staleAt: new Date(
        new Date(observedAt).getTime() + freshnessWindowSeconds * 1_000,
      ).toISOString(),
      maxAgeSeconds: freshnessWindowSeconds,
      businessDate: model.businessDate,
    },
    exceptions,
  };
}
