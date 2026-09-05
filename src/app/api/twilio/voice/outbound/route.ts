import { z } from "zod";
import { resolveLeYardTenant, logCommunicationEvent } from "@/lib/communications.server";
import { createClient } from "@/lib/supabase/server";
import { createTwilioCall, normalizeE164, twilioAbsoluteUrl, twilioForwardNumbers, twilioPhoneNumber } from "@/lib/twilio.server";

const inputSchema = z.object({ to: z.string().trim().min(8).max(32), staff: z.enum(["donald", "maris"]) }).strict();

export async function POST(request: Request) {
  // Supplying carrier credentials must not silently activate paid outbound calls.
  if (process.env.TWILIO_OUTBOUND_ENABLED !== "true")
    return Response.json({ error: "Outbound calling is not activated." }, { status: 503 });
  if (request.headers.get("origin") !== new URL(twilioAbsoluteUrl("/")).origin)
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const client = await createClient();
  const { data: authData } = await client.auth.getUser();
  if (!authData.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const tenant = await resolveLeYardTenant();
  const { data: membership } = await client.from("organization_memberships").select("id")
    .eq("organization_id", tenant.organizationId).eq("user_id", authData.user.id).eq("status", "active").maybeSingle();
  if (!membership) return Response.json({ error: "Forbidden" }, { status: 403 });
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  let destination: string;
  try { destination = normalizeE164(input.to); }
  catch { return Response.json({ error: "Use an international-format phone number." }, { status: 400 }); }
  // NANP is not equivalent to USA. Carrier geo-permissions must also be limited.
  if (!/^\+1[2-9]\d{9}$/.test(destination))
    return Response.json({ error: "Only +1 destinations are enabled." }, { status: 400 });
  const forwarding = twilioForwardNumbers();
  if (destination === twilioPhoneNumber() || Object.values(forwarding).includes(destination))
    return Response.json({ error: "Cannot call the business number or forwarding cellphones through this flow." }, { status: 400 });
  const url = new URL(twilioAbsoluteUrl("/api/twilio/voice/outbound-bridge"));
  url.searchParams.set("to", destination); url.searchParams.set("staff", input.staff);
  const call = await createTwilioCall({ to: forwarding[input.staff], url: url.toString() });
  // Once Twilio accepts the call, a logging error must not make staff retry it.
  await logCommunicationEvent({ eventType: "voice.outbound.requested", message: `Le Yard outbound call requested by ${input.staff}.`,
    metadata: { callSid: call.sid, to: destination, staff: input.staff, requestedByUserId: authData.user.id } }).catch(() => false);
  return Response.json({ callSid: call.sid, status: call.status }, { status: 201 });
}
