import { z } from "zod";
import { validateAgentToolSecret } from "@/lib/elevenlabs.server";
import { communicationsCreateReservation } from "@/lib/communications-reservations.server";
import { logCommunicationEvent } from "@/lib/communications.server";

const schema = z.object({
  slotToken: z.string().min(40).max(4000),
  partySize: z.number().int().min(1).max(100),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().min(7).max(80),
  specialRequests: z.string().trim().max(5000).nullable().optional(),
});

export async function POST(request: Request) {
  if (!validateAgentToolSecret(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid reservation details" }, { status: 400 });
  }
  try {
    const result = await communicationsCreateReservation(request, input);
    await logCommunicationEvent({
      eventType: "reservation.created.ai",
      message: "AI created a reservation through Le Yard inventory.",
      metadata: {
        reservationId: result.reservationId,
        partySize: input.partySize,
        phone: input.phone,
      },
    });
    return Response.json({
      reservationId: result.reservationId,
      status: result.status,
      confirmation: "Reservation confirmed in Le Yard OS.",
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reservation unavailable";
    return Response.json({ error: message }, { status: 409 });
  }
}
