import type { Metadata } from "next";
import { ReservationsWorkspace } from "@/components/reservations/reservations-workspace";
import { loadLiveReservations } from "@/data/read-models/reservations";
import { loadLiveServiceDayContext } from "@/data/read-models/service-day-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { createDemoReservationModel } from "@/lib/reservations/demo";
import { deriveReservationHostPermissions } from "@/lib/reservations/model";
import { resolveSelectedReservationDate } from "@/lib/reservations/selected-date";

export const metadata: Metadata = { title: "Reservations" };

export default async function ReservationsPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const params = await searchParams;
  const requested = Array.isArray(params.date) ? params.date[0] : params.date;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/reservations", resolution.context);
  const timeZone = resolution.context.activeLocation.timeZone;
  if (!timeZone) return null;
  const selectedDate = resolveSelectedReservationDate(
    requested,
    timeZone,
  );
  if (isDemoMode) {
    const result = {
        ok: true as const,
        data: createDemoReservationModel(
          selectedDate,
          deriveReservationHostPermissions(resolution.context.capabilities),
        ),
      };
    return <ReservationsWorkspace workspace={resolution.context} result={result} />;
  }
  const serviceDay = await loadLiveServiceDayContext(resolution.context);
  if (!serviceDay.ok)
    return (
      <ReservationsWorkspace
        workspace={resolution.context}
        result={serviceDay}
      />
    );
  const businessDate = requested ? selectedDate : serviceDay.data.businessDate;
  const result = await loadLiveReservations(
    resolution.context,
    businessDate,
    {
      observationBusinessDate: serviceDay.data.businessDate,
      observationServicePeriodId: serviceDay.data.servicePeriodId,
    },
  );
  return <ReservationsWorkspace workspace={resolution.context} result={result} />;
}
