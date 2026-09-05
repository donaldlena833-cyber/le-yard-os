import { z } from "zod";
import { validateAgentToolSecret } from "@/lib/elevenlabs.server";
import { communicationsAvailability } from "@/lib/communications-reservations.server";
import { logCommunicationEvent } from "@/lib/communications.server";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partySize: z.number().int().min(1).max(100),
});

export async function POST(request: Request) {
  if (!validateAgentToolSecret(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const availability = await communicationsAvailability(input);
    const slots = availability.slots.slice(0, 24);
    await logCommunicationEvent({
      eventType: "reservation.availability.ai",
      message: "AI checked live reservation availability.",
      metadata: { date: input.date, partySize: input.partySize, slotCount: slots.length },
    });
    return Response.json({
      date: availability.businessDate,
      partySize: availability.partySize,
      timeZone: availability.location.timeZone,
      slots: slots.map((slot) => ({
        timeLabel: slot.timeLabel,
        startsAt: slot.startsAt,
        durationMinutes: slot.durationMinutes,
        service: slot.service,
        slotToken: slot.slotToken,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Availability unavailable";
    return Response.json({ error: message }, { status: 409 });
  }
}
