import twilio from "twilio";
import {
  logCommunicationEvent,
  findGuestByPhone,
} from "@/lib/communications.server";
import {
  readTwilioForm,
  twilioAbsoluteUrl,
  twilioForwardNumbers,
  validateTwilioRequest,
  xmlResponse,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const from = params.get("From") ?? "";
  const callSid = params.get("CallSid") ?? "";
  const guest = from.startsWith("+") ? await findGuestByPhone(from).catch(() => null) : null;

  await logCommunicationEvent({
    eventType: "voice.inbound",
    message: "Inbound Le Yard call received.",
    metadata: {
      callSid,
      from,
      guestId: guest?.id,
      guestName: guest?.display_name,
      direction: "inbound",
    },
  });

  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    answerOnBridge: true,
    timeout: 24,
    action: twilioAbsoluteUrl("/api/twilio/voice/result"),
    method: "POST",
  });
  const forwarding = twilioForwardNumbers();
  for (const [label, phone] of Object.entries(forwarding)) {
    dial.number(
      {
        url: `${twilioAbsoluteUrl("/api/twilio/voice/screen")}?staff=${encodeURIComponent(label)}`,
        method: "POST",
        statusCallback: `${twilioAbsoluteUrl("/api/twilio/voice/status")}?staff=${encodeURIComponent(label)}`,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      },
      phone,
    );
  }
  return xmlResponse(response.toString());
}
