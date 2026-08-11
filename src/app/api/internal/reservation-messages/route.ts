import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isReservationMessageChannelBound,
  sendReservationOutboxMessage,
  type ReservationDeliveryResult,
} from "@/lib/reservations/messaging.server";
import {
  reservationMessageClaimIsLeaseSafe,
  reservationMessageClaimLimit,
  reservationMessageLeaseSeconds,
} from "@/lib/reservations/outbox-policy";

const supportedTemplates = [
  "reservation_verify",
  "reservation_confirmed",
  "reservation_cancelled",
  "reservation_modified",
  "reservation_reminder_24h",
  "reservation_reminder_2h",
  "waitlist_table_ready",
] as const;

type SupportedTemplate = (typeof supportedTemplates)[number];

function isSupportedTemplate(value: string): value is SupportedTemplate {
  return (supportedTemplates as readonly string[]).includes(value);
}

type ClaimedMessage = {
  id: string;
  claimToken: string;
  organizationId: string;
  locationId: string;
  reservationId: string | null;
  bookingHoldId: string | null;
  waitlistEntryId: string | null;
  channel: string;
  templateKey: string;
  templateData: unknown;
  attempts: number;
  createdAt: string;
  guestName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  publicCode: string | null;
  reservedAt: string | null;
  offerExpiresAt: string | null;
  holdExpiresAt: string | null;
};

type ReservationRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: { code?: string } | null;
}>;

async function completeReservationMessage(
  rpc: ReservationRpc,
  args: Record<string, unknown>,
) {
  try {
    const completed = await rpc(
      "service_complete_reservation_message_outbox",
      args,
    );
    const result = completed.data as { status?: unknown } | null;
    return !completed.error && result?.status === args.p_status;
  } catch {
    return false;
  }
}

function authorized(request: Request) {
  const expected = process.env.RESERVATION_DELIVERY_SECRET?.trim();
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (!expected || !provided || expected.length < 32) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

async function reservationScopes(admin: ReturnType<typeof createAdminClient>) {
  const scopes: Array<{ organizationId: string; locationId: string }> = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const result = await admin
      .from("reservation_settings")
      .select("organization_id,location_id")
      .order("organization_id")
      .order("location_id")
      .range(offset, offset + pageSize - 1);
    if (result.error) throw new Error("reservation_scopes_unavailable");
    for (const row of result.data ?? [])
      scopes.push({
        organizationId: row.organization_id,
        locationId: row.location_id,
      });
    if ((result.data?.length ?? 0) < pageSize) return scopes;
  }
}

async function deliverReservationMessages(request: Request) {
  if (!authorized(request))
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );

  const admin = createAdminClient();
  const rpc = admin.rpc as unknown as ReservationRpc;
  const now = new Date();
  let scopes: Array<{ organizationId: string; locationId: string }>;
  try {
    scopes = await reservationScopes(admin);
  } catch {
    return Response.json(
      { error: "Reservation expiry scopes could not be loaded." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const expired = { holds: 0, waitlist: 0 };
  const expiryConcurrency = 8;
  for (let offset = 0; offset < scopes.length; offset += expiryConcurrency) {
    const expiryResults = await Promise.all(
      scopes.slice(offset, offset + expiryConcurrency).map((scope) =>
        rpc("service_expire_reservation_deadlines", {
          p_organization_id: scope.organizationId,
          p_location_id: scope.locationId,
          p_now: now.toISOString(),
          p_limit: 500,
        }),
      ),
    );
    if (expiryResults.some((result) => result.error))
      return Response.json(
        { error: "Reservation deadlines could not be expired." },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    for (const result of expiryResults) {
      const value = result.data as {
        holdsExpired?: number;
        waitlistExpired?: number;
      } | null;
      expired.holds += value?.holdsExpired ?? 0;
      expired.waitlist += value?.waitlistExpired ?? 0;
    }
  }
  const { error: reminderError } = await admin.rpc(
    "service_enqueue_reservation_reminders",
    { p_now: now.toISOString() },
  );
  if (reminderError)
    return Response.json(
      { error: "Reservation reminders could not be scheduled." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  if (!reservationMessageClaimIsLeaseSafe())
    return Response.json(
      { error: "Reservation message lease policy is unsafe." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  const { data, error } = await rpc(
    "service_claim_reservation_message_outbox",
    {
      p_worker_id: crypto.randomUUID(),
      p_limit: reservationMessageClaimLimit,
      p_lease_seconds: reservationMessageLeaseSeconds,
      p_now: now.toISOString(),
    },
  );
  if (error)
    return Response.json(
      { error: "Reservation messages could not be claimed." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let completionErrors = 0;
  for (const message of (data ?? []) as ClaimedMessage[]) {
    const templateKey = message.templateKey;
    if (!isSupportedTemplate(templateKey)) {
      const completed = await completeReservationMessage(rpc, {
        p_id: message.id,
        p_claim_token: message.claimToken,
        p_status: "cancelled",
        p_error_code: "unsupported_template",
        p_next_attempt_at: null,
        p_provider_message_id: null,
      });
      if (completed) skipped += 1;
      else completionErrors += 1;
      continue;
    }

    const validatedAt = new Date();
    let validation: Awaited<ReturnType<ReservationRpc>>;
    try {
      validation = await rpc("service_validate_reservation_message_claim", {
        p_id: message.id,
        p_claim_token: message.claimToken,
        p_now: validatedAt.toISOString(),
      });
    } catch {
      validation = { data: null, error: { code: "validation_unavailable" } };
    }
    if (validation.error || validation.data !== true) {
      const retryAt = validation.error
        ? new Date(validatedAt.valueOf() + 5 * 60_000).toISOString()
        : null;
      const completed = await completeReservationMessage(rpc, {
        p_id: message.id,
        p_claim_token: message.claimToken,
        p_status: validation.error ? "failed" : "cancelled",
        p_error_code: validation.error
          ? "claim_validation_unavailable"
          : "linked_lifecycle_stale",
        p_next_attempt_at: retryAt,
        p_provider_message_id: null,
      });
      if (completed) {
        if (validation.error) failed += 1;
        else skipped += 1;
      } else completionErrors += 1;
      continue;
    }

    if (!isReservationMessageChannelBound(message)) {
      const completed = await completeReservationMessage(rpc, {
        p_id: message.id,
        p_claim_token: message.claimToken,
        p_status: "cancelled",
        p_error_code: "channel_binding_invalid",
        p_next_attempt_at: null,
        p_provider_message_id: null,
      });
      if (completed) skipped += 1;
      else completionErrors += 1;
      continue;
    }

    const channel = message.channel as "email" | "sms";
    const hasRecipient =
      channel === "email"
        ? Boolean(message.recipientEmail)
        : Boolean(message.recipientPhone);
    let delivered: ReservationDeliveryResult = {
      state: "failed",
      providerMessageId: null,
    };
    if (hasRecipient) {
      try {
        delivered = await sendReservationOutboxMessage({
          messageId: message.id,
          organizationId: message.organizationId,
          locationId: message.locationId,
          reservationId: message.reservationId,
          bookingHoldId: message.bookingHoldId,
          channel,
          templateKey,
          guestName: message.guestName ?? "Guest",
          email: message.recipientEmail,
          phone: message.recipientPhone,
          publicCode: message.publicCode,
          reservedAt: message.reservedAt,
          offerExpiresAt: message.offerExpiresAt,
          holdExpiresAt: message.holdExpiresAt,
          messageCreatedAt: message.createdAt,
        });
      } catch {
        delivered = { state: "failed", providerMessageId: null };
      }
    }

    const completedAt = new Date().toISOString();
    if (delivered.state === "sent") {
      const completed = await completeReservationMessage(rpc, {
        p_id: message.id,
        p_claim_token: message.claimToken,
        p_status: "sent",
        p_error_code: null,
        p_next_attempt_at: null,
        p_provider_message_id: delivered.providerMessageId,
      });
      if (completed) sent += 1;
      else completionErrors += 1;
      continue;
    }

    const retryAt = new Date(
      new Date(completedAt).valueOf() +
        Math.min(30, 2 ** Math.max(1, message.attempts)) * 60_000,
    ).toISOString();
    const completed = await completeReservationMessage(rpc, {
      p_id: message.id,
      p_claim_token: message.claimToken,
      p_status: "failed",
      p_error_code: hasRecipient ? delivered.state : "recipient_missing",
      p_next_attempt_at: retryAt,
      p_provider_message_id: null,
    });
    if (completed) failed += 1;
    else completionErrors += 1;
  }

  const result = { expired, sent, failed, skipped, completionErrors };
  if (completionErrors > 0)
    return Response.json(
      {
        error: "Reservation message completion could not be recorded.",
        data: result,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  return Response.json(
    { data: result },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return deliverReservationMessages(request);
}

export async function POST(request: Request) {
  return deliverReservationMessages(request);
}
