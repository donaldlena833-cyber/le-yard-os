import "server-only";

import { after } from "next/server";

type DeliveryTriggerResult =
  | { status: "accepted" }
  | { status: "rejected"; httpStatus: number }
  | { status: "transport_error"; errorName: string };

export async function triggerReservationMessageDelivery(
  workerUrl: URL,
  secret: string,
  fetcher: typeof fetch = fetch,
): Promise<DeliveryTriggerResult> {
  try {
    const response = await fetcher(workerUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (response.ok) return { status: "accepted" };
    console.warn("reservation_message_delivery_trigger_rejected", {
      httpStatus: response.status,
    });
    return { status: "rejected", httpStatus: response.status };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.warn("reservation_message_delivery_trigger_transport_error", {
      errorName,
    });
    return { status: "transport_error", errorName };
  }
}

export function scheduleReservationMessageDelivery(request: Request) {
  const secret = process.env.RESERVATION_DELIVERY_SECRET?.trim();
  if (!secret || secret.length < 32) {
    console.warn("reservation_message_delivery_trigger_skipped", {
      reason: "delivery_secret_unavailable",
    });
    return;
  }
  const workerUrl = new URL("/api/internal/reservation-messages", request.url);
  try {
    after(() => triggerReservationMessageDelivery(workerUrl, secret));
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.warn("reservation_message_delivery_trigger_skipped", {
      reason: "request_lifecycle_unavailable",
      errorName,
    });
    // Fail closed when invoked outside a request lifecycle (for example tests).
  }
}
