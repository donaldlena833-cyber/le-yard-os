import { resolveLeYardTenant } from "@/lib/communications.server";
import { readTwilioForm, twilioForwardNumbers, twilioPhoneNumber, twilioSmsEnabled, validateTwilioRequest } from "@/lib/twilio.server";

// Signed read-only deployment probe. Never discloses keys, staff phones, or guest data.
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  try {
    const { params } = await readTwilioForm(request);
    if (!validateTwilioRequest(request, params)) return new Response("Forbidden", { status: 403, headers });
    const timestamp = Number(params.get("Timestamp"));
    const channel = params.get("ProbeChannel");
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 ||
        params.get("To") !== twilioPhoneNumber() || !["voice", "messaging"].includes(channel ?? ""))
      return new Response("Invalid probe", { status: 400, headers });
    if (channel === "voice") twilioForwardNumbers();
    else {
      if (!/^MG[0-9a-f]{32}$/i.test(process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() ?? ""))
        throw new Error("Messaging configuration incomplete.");
      await resolveLeYardTenant();
    }
    return Response.json({ protocol: "le-yard-twilio-v1", ready: true, channel,
      smsEnabled: twilioSmsEnabled(), liveCarrierTestsPassed: false }, { headers });
  } catch {
    return Response.json({ protocol: "le-yard-twilio-v1", ready: false,
      error: "Required server configuration is incomplete." }, { status: 503, headers });
  }
}
