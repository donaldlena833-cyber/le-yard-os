import type { Metadata } from "next";
import { ReservationSetupWorkspace } from "@/components/reservations/reservation-setup-workspace";
import { loadLiveReservations } from "@/data/read-models/reservations";
import { loadLiveReservationServiceShifts } from "@/data/read-models/reservation-service-shifts";
import { loadLiveServiceDayContext } from "@/data/read-models/service-day-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { createDemoReservationModel } from "@/lib/reservations/demo";
import { deriveReservationHostPermissions } from "@/lib/reservations/model";
import { resolveSelectedReservationDate } from "@/lib/reservations/selected-date";
import { createDemoServiceShiftManagement } from "@/lib/reservations/service-shift-management";

export const metadata: Metadata = { title: "Reservation setup" };

export default async function ReservationSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.date) ? params.date[0] : params.date;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/reservations/setup", resolution.context);
  const timeZone = resolution.context.activeLocation.timeZone;
  if (!timeZone) return null;
  const selectedDate = resolveSelectedReservationDate(requested, timeZone);
  if (isDemoMode) {
    return (
      <ReservationSetupWorkspace
        key={selectedDate}
        workspace={resolution.context}
        model={createDemoReservationModel(
          selectedDate,
          deriveReservationHostPermissions(resolution.context.capabilities),
        )}
        serviceShifts={createDemoServiceShiftManagement(
          selectedDate,
          timeZone,
        )}
      />
    );
  }

  const serviceDay = await loadLiveServiceDayContext(resolution.context);
  if (!serviceDay.ok) return null;
  const businessDate = requested
    ? selectedDate
    : serviceDay.data.businessDate;
  const [reservationResult, serviceShiftResult] = await Promise.all([
    loadLiveReservations(resolution.context, businessDate, {
      observationBusinessDate: serviceDay.data.businessDate,
      observationServicePeriodId: serviceDay.data.servicePeriodId,
    }),
    loadLiveReservationServiceShifts(resolution.context, businessDate),
  ]);
  if (!reservationResult.ok) return null;
  return (
    <ReservationSetupWorkspace
      key={businessDate}
      workspace={resolution.context}
      model={reservationResult.data}
      serviceShifts={
        serviceShiftResult.ok
          ? serviceShiftResult.data
          : { businessDate, timeZone, shifts: [] }
      }
      serviceShiftError={
        serviceShiftResult.ok ? undefined : serviceShiftResult.message
      }
    />
  );
}
