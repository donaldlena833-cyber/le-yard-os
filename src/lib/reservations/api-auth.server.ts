import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export interface BookingApiClientContext {
  id: string;
  organizationId: string;
  locationId: string;
  name: string;
  scopes: string[];
  abuseIdentity: string;
}

export class BookingApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const abuseIdentityPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function managementExchangeBrowserBindingHash(
  client: Pick<BookingApiClientContext, "id" | "abuseIdentity">,
) {
  if (
    !uuidPattern.test(client.id) ||
    !abuseIdentityPattern.test(client.abuseIdentity)
  )
    throw new BookingApiError(
      404,
      "management_exchange_unavailable",
      "This reservation management link is unavailable.",
    );
  return sha256(
    `reservation-management-browser:v1\0${client.id}\0${client.abuseIdentity}`,
  );
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function trustedAbuseIdentity(
  request: Request,
  apiKey: string,
  now = Date.now(),
) {
  const identity = request.headers.get("x-booking-abuse-identity")?.trim() ?? "";
  const timestamp = request.headers.get("x-booking-abuse-timestamp")?.trim() ?? "";
  const signature = request.headers.get("x-booking-abuse-signature")?.trim() ?? "";
  const seconds = Number(timestamp);
  if (
    !abuseIdentityPattern.test(identity) ||
    !Number.isSafeInteger(seconds) ||
    Math.abs(Math.floor(now / 1_000) - seconds) > 300 ||
    !/^[0-9a-f]{64}$/i.test(signature)
  )
    return "untrusted";
  const expected = createHmac("sha256", apiKey)
    .update(`${timestamp}.${identity}`)
    .digest("hex");
  return safeEqual(signature.toLowerCase(), expected) ? identity : "untrusted";
}

export async function readBookingJson(
  request: Request,
  message: string,
  maximumBytes = 32_768,
) {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)
  )
    throw new BookingApiError(413, "request_too_large", message);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes)
    throw new BookingApiError(413, "request_too_large", message);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new BookingApiError(
      400,
      "invalid_json",
      "The request body must be valid JSON.",
    );
  }
}

export async function authenticateBookingApiRequest(request: Request, requiredScope: "availability:read" | "reservations:write"): Promise<BookingApiClientContext> {
  const authorization = request.headers.get("authorization") ?? "";
  const key = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!key || key.length < 24 || key.length > 512) throw new BookingApiError(401, "unauthorized", "A valid booking API key is required.");
  const admin = createAdminClient();
  const { data, error } = await admin.from("booking_api_clients").select("id,organization_id,location_id,name,scopes,allowed_origins,is_active,expires_at").eq("key_hash", sha256(key)).maybeSingle();
  if (error || !data || !data.is_active || !data.location_id || (data.expires_at && new Date(data.expires_at) <= new Date())) {
    throw new BookingApiError(401, "unauthorized", "A valid booking API key is required.");
  }
  if (!data.scopes.includes(requiredScope)) throw new BookingApiError(403, "forbidden", "This API client does not have the required scope.");
  const origin = request.headers.get("origin");
  if (origin && data.allowed_origins.length && !data.allowed_origins.includes(origin)) throw new BookingApiError(403, "origin_not_allowed", "This origin is not allowed for the booking API client.");
  void admin.from("booking_api_clients").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return {
    id: data.id,
    organizationId: data.organization_id,
    locationId: data.location_id,
    name: data.name,
    scopes: data.scopes,
    abuseIdentity: trustedAbuseIdentity(request, key),
  };
}

export function bookingGlobalRateLimitMultiplier(
  configured = process.env.BOOKING_GLOBAL_RATE_LIMIT_MULTIPLIER,
) {
  const value = Number(configured ?? "2");
  return Number.isInteger(value) && value >= 2 && value <= 20 ? value : 2;
}

export function bookingContactRateLimitBucketHashes(input: {
  clientId: string;
  path: string;
  email: string;
  phone: string;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phone.replace(/\D/g, "");
  return {
    email: sha256(
      `booking-contact:v1\0${input.clientId}\0${input.path}\0email\0${sha256(normalizedEmail)}`,
    ),
    phone: sha256(
      `booking-contact:v1\0${input.clientId}\0${input.path}\0phone\0${sha256(normalizedPhone)}`,
    ),
  };
}

export function guestInterestContactRateLimitBucketHashes(input: {
  clientId: string;
  path: string;
  email: string;
  phone?: string | null;
}) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = input.phone?.replace(/\D/g, "") || null;
  return {
    email: sha256(
      `guest-interest-contact:v1\0${input.clientId}\0${input.path}\0email\0${sha256(normalizedEmail)}`,
    ),
    phone: normalizedPhone
      ? sha256(
          `guest-interest-contact:v1\0${input.clientId}\0${input.path}\0phone\0${sha256(normalizedPhone)}`,
        )
      : null,
  };
}

export function bookingRateLimitBucketHashes(input: {
  clientId: string;
  abuseIdentity: string;
  method: string;
  path: string;
}) {
  const operation = `${input.method.toUpperCase()}:${input.path}`;
  return {
    identity: sha256(
      `${input.clientId}:identity:${input.abuseIdentity}:${operation}`,
    ),
    global: sha256(`${input.clientId}:global:${operation}`),
  };
}

export async function enforceBookingRateLimit(request: Request, client: BookingApiClientContext, limit: number, windowSeconds: number) {
  const admin = createAdminClient();
  const path = new URL(request.url).pathname;
  const bucketHashes = bookingRateLimitBucketHashes({
    clientId: client.id,
    abuseIdentity: client.abuseIdentity,
    method: request.method,
    path,
  });
  const globalMultiplier = bookingGlobalRateLimitMultiplier();
  const claims = await Promise.all([
    admin.rpc("service_claim_booking_rate_limit", {
      p_bucket_hash: bucketHashes.identity,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }),
    admin.rpc("service_claim_booking_rate_limit", {
      p_bucket_hash: bucketHashes.global,
      p_limit: limit * globalMultiplier,
      p_window_seconds: windowSeconds,
    }),
  ]);
  if (claims.some((claim) => claim.error))
    throw new BookingApiError(
      503,
      "rate_limit_unavailable",
      "Booking protection is temporarily unavailable.",
    );
  const identityClaim = claims[0].data as {
    allowed?: boolean;
    remaining?: number;
    resetAt?: string;
  };
  const globalClaim = claims[1].data as { allowed?: boolean };
  if (!identityClaim.allowed || !globalClaim.allowed)
    throw new BookingApiError(
      429,
      "rate_limited",
      "Too many booking requests. Try again shortly.",
    );
  return identityClaim;
}

export async function enforceBookingContactRateLimit(
  request: Request,
  client: BookingApiClientContext,
  email: string,
  phone: string,
) {
  const configuredLimit = Number(
    process.env.BOOKING_CONTACT_RATE_LIMIT_PER_HOUR ?? "4",
  );
  const limit =
    Number.isInteger(configuredLimit) &&
    configuredLimit >= 1 &&
    configuredLimit <= 50
      ? configuredLimit
      : 4;
  const bucketHashes = bookingContactRateLimitBucketHashes({
    clientId: client.id,
    path: new URL(request.url).pathname,
    email,
    phone,
  });
  const admin = createAdminClient();
  const claims = await Promise.all(
    Object.values(bucketHashes).map((bucketHash) =>
      admin.rpc("service_claim_booking_rate_limit", {
        p_bucket_hash: bucketHash,
        p_limit: limit,
        p_window_seconds: 3_600,
      }),
    ),
  );
  if (claims.some((claim) => claim.error))
    throw new BookingApiError(
      503,
      "rate_limit_unavailable",
      "Booking protection is temporarily unavailable.",
    );
  if (claims.some((claim) => !(claim.data as { allowed?: boolean }).allowed))
    throw new BookingApiError(
      429,
      "contact_rate_limited",
      "Too many reservation attempts were made for these contact details. Try again later.",
    );
}

export async function enforceGuestInterestContactRateLimit(
  request: Request,
  client: BookingApiClientContext,
  email: string,
  phone?: string | null,
) {
  const configuredLimit = Number(
    process.env.GUEST_INTEREST_CONTACT_RATE_LIMIT_PER_HOUR ?? "6",
  );
  const limit =
    Number.isInteger(configuredLimit) &&
    configuredLimit >= 1 &&
    configuredLimit <= 50
      ? configuredLimit
      : 6;
  const bucketHashes = guestInterestContactRateLimitBucketHashes({
    clientId: client.id,
    path: new URL(request.url).pathname,
    email,
    phone,
  });
  const admin = createAdminClient();
  const claims = await Promise.all(
    Object.values(bucketHashes)
      .filter((bucketHash): bucketHash is string => Boolean(bucketHash))
      .map((bucketHash) =>
        admin.rpc("service_claim_booking_rate_limit", {
          p_bucket_hash: bucketHash,
          p_limit: limit,
          p_window_seconds: 3_600,
        }),
      ),
  );
  if (claims.some((claim) => claim.error))
    throw new BookingApiError(
      503,
      "rate_limit_unavailable",
      "Signup protection is temporarily unavailable.",
    );
  if (claims.some((claim) => !(claim.data as { allowed?: boolean }).allowed))
    throw new BookingApiError(
      429,
      "contact_rate_limited",
      "Too many signup attempts were made for these contact details. Try again later.",
    );
}

export function bookingApiResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function bookingApiFailure(error: unknown, requestId: string) {
  if (error instanceof BookingApiError) return bookingApiResponse({ error: { code: error.code, message: error.message, requestId } }, { status: error.status });
  console.error("booking_api_internal_error", {
    requestId,
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown booking error",
  });
  return bookingApiResponse({ error: { code: "internal_error", message: "The booking service could not complete the request.", requestId } }, { status: 500 });
}
