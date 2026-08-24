import { z } from "zod";
import { after } from "next/server";
import { guestInterestInputSchema } from "@/lib/guest-interest";
import {
  guestInterestDestinationHash,
  guestInterestVerificationToken,
  guestInterestVerificationTokenHash,
} from "@/lib/guest-interest-verification.server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateBookingApiRequest,
  BookingApiError,
  bookingApiFailure,
  bookingApiResponse,
  enforceBookingRateLimit,
  enforceGuestInterestContactRateLimit,
  readBookingJson,
} from "@/lib/reservations/api-auth.server";

const uuidSchema = z.string().uuid();

function requestKey(request: Request) {
  const parsed = uuidSchema.safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success)
    throw new BookingApiError(
      400,
      "idempotency_key_required",
      "A UUID Idempotency-Key header is required.",
    );
  return parsed.data;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const input = guestInterestInputSchema.parse(
      await readBookingJson(request, "The signup request is too large.", 16_384),
    );
    const client = await authenticateBookingApiRequest(
      request,
      "reservations:write",
    );
    const idempotencyKey = requestKey(request);
    await enforceBookingRateLimit(request, client, 12, 3_600);
    await enforceGuestInterestContactRateLimit(
      request,
      client,
      input.email,
      input.phone,
    );

    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const verificationToken = guestInterestVerificationToken({
      requestId: idempotencyKey,
      organizationId: client.organizationId,
      locationId: client.locationId,
      destinationHash: guestInterestDestinationHash(
        client.organizationId,
        input.email,
      ),
      expiresAt,
    });

    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "service_capture_guest_interest",
      {
        p_request_id: idempotencyKey,
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_first_name: input.firstName,
        p_last_name: input.lastName ?? null,
        p_email: input.email,
        p_phone: input.phone ?? null,
        p_birthday_month: input.birthdayMonth ?? null,
        p_birthday_day: input.birthdayDay ?? null,
        p_age_21_plus: input.age21Plus ?? null,
        p_interests: input.interests,
        p_email_consent: input.emailConsent,
        p_sms_consent: input.smsConsent,
        p_profile_consent: input.profileConsent,
        p_source: input.source,
        p_verification_token_hash:
          guestInterestVerificationTokenHash(verificationToken),
        p_expires_at: expiresAt,
      } as never,
    );
    if (error?.code === "23505")
      throw new BookingApiError(
        409,
        "idempotency_conflict",
        "This signup request conflicts with an earlier submission.",
      );
    if (error?.code === "22023")
      throw new BookingApiError(
        400,
        "invalid_request",
        "Review the signup details and consent choices.",
      );
    if (error) {
      console.error("public_guest_interest_rpc_error", {
        requestId,
        code: error.code,
        message: error.message,
      });
      throw new BookingApiError(
        503,
        "signup_unavailable",
        "The Le Yard list is temporarily unavailable.",
      );
    }
    const result = data as { status?: string; verificationPending?: boolean };
    const deliverySecret = process.env.IDENTITY_DELIVERY_SECRET?.trim();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (deliverySecret && deliverySecret.length >= 32 && appUrl) {
      const workerUrl = new URL("/api/internal/identity-delivery", appUrl);
      after(async () => {
        try {
          await fetch(workerUrl, {
            method: "POST",
            headers: { authorization: `Bearer ${deliverySecret}` },
            cache: "no-store",
            signal: AbortSignal.timeout(25_000),
          });
        } catch {
          // The committed outbox row remains available for a later worker run.
        }
      });
    }
    return bookingApiResponse(
      {
        data: {
          saved: false,
          status: result.status ?? "pending",
          verificationPending: result.verificationPending === true,
          emailConsent: false,
          smsConsent: false,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "Review the signup details and consent choices.",
            requestId,
            fields: z.flattenError(error).fieldErrors,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}
