import { z } from "zod";
import { authenticateBookingApiRequest, bookingApiFailure, bookingApiResponse, enforceBookingRateLimit } from "@/lib/reservations/api-auth.server";
import { loadPublicAvailability } from "@/lib/reservations/public-availability.server";
import { isIsoCalendarDate } from "@/lib/reservations/availability";

const querySchema = z.object({
  date: z.string().refine(isIsoCalendarDate),
  partySize: z.coerce.number().int().min(1).max(100),
});

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(request, "availability:read");
    await enforceBookingRateLimit(request, client, 120, 60);
    const url = new URL(request.url);
    const input = querySchema.parse({ date: url.searchParams.get("date"), partySize: url.searchParams.get("partySize") });
    return bookingApiResponse({ data: await loadPublicAvailability(client, input.date, input.partySize), requestId });
  } catch (error) {
    if (error instanceof z.ZodError) return bookingApiResponse({ error: { code: "invalid_request", message: "Choose a valid date and party size.", requestId } }, { status: 400 });
    return bookingApiFailure(error, requestId);
  }
}
