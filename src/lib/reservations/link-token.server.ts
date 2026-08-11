import "server-only";

import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { BookingApiError } from "./api-auth.server";

export type ReservationLinkPurpose = "verify" | "manage_exchange";

const basePayloadSchema = z.object({
  v: z.literal(1),
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  subjectId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
});

const verificationChannelSchema = z.enum(["email", "sms"]);
export type ReservationVerificationChannel = z.infer<
  typeof verificationChannelSchema
>;

const verificationPayloadSchema = basePayloadSchema.extend({
  purpose: z.literal("verify"),
  verifiedChannel: verificationChannelSchema,
}).strict();

const managementExchangePayloadSchema = basePayloadSchema.extend({
  purpose: z.literal("manage_exchange"),
}).strict();

const payloadSchema = z.discriminatedUnion("purpose", [
  verificationPayloadSchema,
  managementExchangePayloadSchema,
]);

export type VerificationReservationLinkPayload = z.infer<
  typeof verificationPayloadSchema
>;
export type ManagementExchangeReservationLinkPayload = z.infer<
  typeof managementExchangePayloadSchema
>;
export type ReservationLinkPayload = z.infer<typeof payloadSchema>;
export type ReservationLinkInput =
  | Omit<VerificationReservationLinkPayload, "v">
  | Omit<ManagementExchangeReservationLinkPayload, "v">;

function signingSecret() {
  const secret = process.env.RESERVATION_LINK_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new BookingApiError(
      503,
      "verification_unavailable",
      "Reservation verification is temporarily unavailable.",
    );
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

export function createReservationLinkToken(
  input: ReservationLinkInput,
) {
  const payload = Buffer.from(
    JSON.stringify(payloadSchema.parse({ v: 1, ...input })),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function deriveReservationManagementToken(exchangeToken: string) {
  return createHmac("sha256", signingSecret())
    .update("reservation-management-session:v1\0", "utf8")
    .update(exchangeToken, "utf8")
    .digest("base64url");
}

export function verifyReservationLinkToken(
  token: string,
  purpose: "verify",
  now?: number,
): VerificationReservationLinkPayload;
export function verifyReservationLinkToken(
  token: string,
  purpose: "manage_exchange",
  now?: number,
): ManagementExchangeReservationLinkPayload;
export function verifyReservationLinkToken(
  token: string,
  purpose: ReservationLinkPurpose,
  now = Date.now(),
): ReservationLinkPayload {
  if (token.length < 80 || token.length > 2_048)
    throw new BookingApiError(
      404,
      "reservation_link_unavailable",
      "The reservation link is unavailable.",
    );
  const [payload, provided, extra] = token.split(".");
  if (!payload || !provided || extra)
    throw new BookingApiError(
      404,
      "reservation_link_unavailable",
      "The reservation link is unavailable.",
    );
  const expected = signature(payload);
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right))
    throw new BookingApiError(
      404,
      "reservation_link_unavailable",
      "The reservation link is unavailable.",
    );
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new BookingApiError(
      404,
      "reservation_link_unavailable",
      "The reservation link is unavailable.",
    );
  }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.purpose !== purpose)
    throw new BookingApiError(
      404,
      "reservation_link_unavailable",
      "The reservation link is unavailable.",
    );
  if (new Date(parsed.data.expiresAt).valueOf() <= now)
    throw new BookingApiError(
      410,
      "reservation_link_expired",
      "This reservation link has expired.",
    );
  return parsed.data;
}

export function requireReservationLinkScope(
  payload: ReservationLinkPayload,
  scope: { organizationId: string; locationId: string },
) {
  if (
    payload.organizationId !== scope.organizationId ||
    payload.locationId !== scope.locationId
  )
    throw new BookingApiError(
      404,
      "reservation_link_unavailable",
      "The reservation link is unavailable.",
    );
}
