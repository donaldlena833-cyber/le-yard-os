import {
  authenticateBookingApiRequest,
  bookingApiFailure,
  bookingApiResponse,
  enforceBookingRateLimit,
} from "@/lib/reservations/api-auth.server";
import {
  isPublicReservationEmergencyGateOpen,
  loadPublicReleaseState,
} from "@/lib/reservations/public-release-control.server";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(
      request,
      "availability:read",
    );
    await enforceBookingRateLimit(request, client, 120, 60);
    const release = await loadPublicReleaseState(client);
    return bookingApiResponse(
      {
        data: {
          state: release.state,
          acceptReservationsFrom: release.acceptReservationsFrom,
          publicInventoryPercent: release.publicInventoryPercent,
          bookingApproved: release.bookingApproved,
          supportReady: release.supportReady,
          bookingEnabled:
            isPublicReservationEmergencyGateOpen() && release.bookingEnabled,
          releaseId: release.releaseId,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return bookingApiFailure(error, requestId);
  }
}
