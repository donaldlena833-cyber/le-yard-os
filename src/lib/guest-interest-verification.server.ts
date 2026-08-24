import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

const tokenPayloadSchema = z.object({
  requestId: z.uuid(),
  organizationId: z.uuid(),
  locationId: z.uuid(),
  destinationHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type GuestInterestVerificationPayload = z.infer<
  typeof tokenPayloadSchema
>;

function signingSecret() {
  const secret = process.env.GUEST_INTEREST_VERIFICATION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("Guest-interest verification is not configured.");
  }
  return secret;
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function guestInterestDestinationHash(
  organizationId: string,
  email: string,
) {
  return createHash("sha256")
    .update(
      `guest-interest-email:v2:${organizationId}:${email.trim().toLowerCase()}`,
    )
    .digest("hex");
}

export function guestInterestVerificationToken(
  payload: GuestInterestVerificationPayload,
) {
  const encoded = Buffer.from(
    JSON.stringify(tokenPayloadSchema.parse(payload)),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", signingSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function guestInterestVerificationTokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function parseGuestInterestVerificationToken(
  token: string,
  now = Date.now(),
) {
  const [encoded, providedSignature, extra] = token.split(".");
  if (!encoded || !providedSignature || extra) {
    throw new Error("Guest-interest verification is invalid.");
  }
  const expectedSignature = createHmac("sha256", signingSecret())
    .update(encoded)
    .digest("base64url");
  if (!safeEqual(providedSignature, expectedSignature)) {
    throw new Error("Guest-interest verification is invalid.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Guest-interest verification is invalid.");
  }
  const payload = tokenPayloadSchema.parse(decoded);
  if (new Date(payload.expiresAt).valueOf() <= now) {
    throw new Error("Guest-interest verification has expired.");
  }
  return payload;
}

