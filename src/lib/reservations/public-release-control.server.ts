import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BookingApiError,
  type BookingApiClientContext,
} from "./api-auth.server";

export const LE_YARD_EARLIEST_PUBLIC_RESERVATION_DATE = "2026-12-01";

const publicReleaseStateSchema = z.object({
  state: z.enum(["prelaunch", "pilot", "open", "paused"]),
  acceptReservationsFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  publicInventoryPercent: z.number().int().min(0).max(100),
  bookingApproved: z.boolean(),
  supportReady: z.boolean(),
  bookingEnabled: z.boolean(),
  releaseId: z.string().uuid(),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime({ offset: true }),
});

export type PublicReleaseState = z.infer<typeof publicReleaseStateSchema>;

export function isPublicReservationEmergencyGateOpen(
  configured = process.env.RESERVATION_PUBLIC_BOOKING_ENABLED,
) {
  const normalized = configured?.trim().toLowerCase();
  if (!normalized) return true;
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  return false;
}

export function assertPublicReservationEmergencyGateOpen(options?: {
  existingManagementSessionAuthorized?: boolean;
}) {
  if (
    isPublicReservationEmergencyGateOpen() ||
    options?.existingManagementSessionAuthorized
  )
    return;
  throw new BookingApiError(
    503,
    "booking_unavailable",
    "Online reservations are temporarily unavailable. Please call the restaurant.",
  );
}

export function assertPublicReleaseAllowsBusinessDate(
  release: PublicReleaseState,
  businessDate: string,
) {
  if (
    !release.bookingEnabled ||
    businessDate < release.acceptReservationsFrom
  )
    throw new BookingApiError(
      503,
      "booking_unavailable",
      `Online reservations begin ${release.acceptReservationsFrom}.`,
    );
}

export function effectivePublicPacingCoverLimit(
  configuredCoverLimit: number,
  publicInventoryPercent: number,
) {
  if (
    !Number.isFinite(configuredCoverLimit) ||
    !Number.isFinite(publicInventoryPercent) ||
    configuredCoverLimit < 1 ||
    publicInventoryPercent < 0 ||
    publicInventoryPercent > 100
  )
    return 0;
  return Math.floor((configuredCoverLimit * publicInventoryPercent) / 100);
}

export async function loadPublicReleaseState(
  client: Pick<BookingApiClientContext, "organizationId" | "locationId">,
) {
  const admin = createAdminClient();
  const rpc = admin.rpc.bind(admin) as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
  const { data, error } = await rpc("service_public_release_state", {
    p_organization_id: client.organizationId,
    p_location_id: client.locationId,
  });
  const parsed = publicReleaseStateSchema.safeParse(data);
  if (error || !parsed.success)
    throw new BookingApiError(
      503,
      "booking_unavailable",
      "Online booking release controls are unavailable.",
    );
  return parsed.data;
}
