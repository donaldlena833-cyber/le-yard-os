import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { BookingApiError } from "./api-auth.server";

export interface BookingSlotPayload {
  version: 1;
  clientId: string;
  locationId: string;
  startsAt: string;
  durationMinutes: number;
  partySize: number;
  tableIds: string[];
  expiresAt: string;
}

function secret() {
  const value = process.env.BOOKING_SLOT_SIGNING_SECRET?.trim();
  if (!value || value.length < 32)
    throw new BookingApiError(
      503,
      "availability_unavailable",
      "Availability could not be loaded.",
    );
  return value;
}

function signature(encoded: string) {
  return createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function createBookingSlotToken(payload: Omit<BookingSlotPayload, "version" | "expiresAt">) {
  const body: BookingSlotPayload = { ...payload, version: 1, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyBookingSlotToken(token: string, clientId: string): BookingSlotPayload {
  const [encoded, provided] = token.split(".");
  if (!encoded || !provided || provided.length > 128) throw new BookingApiError(400, "invalid_slot", "The selected time is invalid or expired.");
  const expected = signature(encoded);
  const valid = provided.length === expected.length && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!valid) throw new BookingApiError(400, "invalid_slot", "The selected time is invalid or expired.");
  let payload: BookingSlotPayload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BookingSlotPayload; } catch { throw new BookingApiError(400, "invalid_slot", "The selected time is invalid or expired."); }
  if (payload.version !== 1 || payload.clientId !== clientId || new Date(payload.expiresAt) <= new Date() || !Array.isArray(payload.tableIds) || !payload.tableIds.length) throw new BookingApiError(400, "invalid_slot", "The selected time is invalid or expired.");
  return payload;
}
