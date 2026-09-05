import { z } from "zod";
import { resolveLeYardTenant, logCommunicationEvent } from "@/lib/communications.server";
import { createClient } from "@/lib/supabase/server";
import {
  createTwilioCall,
  normalizeE164,
  twilioAbsoluteUrl,
  twilioForwardNumbers,
} from "@/lib/twilio.server";

const inputSchema = z.object({
  to: z.string().trim().min(8).max(32),
  staff: z.enum(["donald", "maris"]),
});

export async function POST(request: Request) {
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await resolveLeYardTenant();
  const { data: membership } = await client
    .from("organization_memberships")
    .select("id")
    .eq("organization_id", tenant.organizationId)
    .eq("user_id", authData.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!membership) return Response.json({ error: "Forbidden" }, { status: 403 });

  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const destination = normalizeE164(input.to);
  const staffNumber = twilioForwardNumbers()[input.staff];
  const url = new URL(twilioAbsoluteUrl("/api/twilio/voice/outbound-bridge"));
  url.searchParams.set("to", destination);
  url.searchParams.set("staff", input.staff);

  const call = await createTwilioCall({ to: staffNumber, url: url.toString() });
  await logCommunicationEvent({
    eventType: "voice.outbound.requested",
    message: `Le Yard outbound call requested by ${input.staff}.`,
    metadata: {
      callSid: call.sid,
      to: destination,
      staff: input.staff,
      requestedByUserId: authData.user.id,
    },
  });
  return Response.json({ callSid: call.sid, status: call.status }, { status: 201 });
}
