import { z } from "zod";
import { validateAgentToolSecret } from "@/lib/elevenlabs.server";
import { twilioPhoneNumber } from "@/lib/twilio.server";
import { performCommunicationHandoff } from "@/lib/communication-handoff.server";
const schema = z
  .object({
    requestId: z.string().uuid(),
    phone: z.string().regex(/^\+1[2-9]\d{9}$/),
    reason: z.string().trim().min(2).max(160),
    summary: z.string().trim().max(10000),
  })
  .strict();
export async function POST(request: Request) {
  if (!validateAgentToolSecret(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.phone === twilioPhoneNumber())
    return Response.json({ error: "Invalid handoff" }, { status: 400 });
  return performCommunicationHandoff(parsed.data);
}
