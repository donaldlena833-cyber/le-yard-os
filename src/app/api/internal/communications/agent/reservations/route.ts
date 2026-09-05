import { z } from "zod";
import { validateAgentToolSecret } from "@/lib/elevenlabs.server";
import { communicationsCreateReservation } from "@/lib/communications-reservations.server";
import { logCommunicationEvent } from "@/lib/communications.server";
import { BookingApiError } from "@/lib/reservations/api-auth.server";

const schema = z.object({ guestConfirmed: z.literal(true), slotToken: z.string().min(40).max(4000),
  partySize: z.number().int().min(1).max(100), firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120), email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(80), specialRequests: z.string().trim().max(5000).nullable().optional(),
}).strict();

export async function POST(request: Request) {
  if (!validateAgentToolSecret(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (process.env.TWILIO_AI_BOOKING_ENABLED?.trim() !== "true")
    return Response.json({ error: "AI booking is not activated; offer human assistance." }, { status: 503 });
  if (!z.string().uuid().safeParse(request.headers.get("idempotency-key")).success)
    return Response.json({ error: "A stable UUID Idempotency-Key is required." }, { status: 400 });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid reservation details or missing guest confirmation" }, { status: 400 }); }
  try {
    const result = await communicationsCreateReservation(request, input);
    const confirmed = result.status === "confirmed";
    await logCommunicationEvent({ eventType: confirmed ? "reservation.created.ai" : "reservation.requested.ai",
      message: "AI reservation operation completed with the status returned by Le Yard inventory.",
      metadata: { reservationId: result.reservationId, status: result.status, partySize: input.partySize } });
    return Response.json({ reservationId: result.reservationId, status: result.status, confirmed,
      deliveryState: result.deliveryState,
      confirmation: confirmed ? "Reservation confirmed in Le Yard OS. Message delivery is tracked separately."
        : "Not confirmed. Follow the returned booking status and offer human assistance; do not promise a table.",
    }, { status: confirmed ? 201 : 202 });
  } catch (error) {
    const known = error instanceof BookingApiError;
    return Response.json({ error: known ? error.message : "Booking result requires human verification. Retain the original request identifier." }, { status: known ? error.status : 503 });
  }
}
