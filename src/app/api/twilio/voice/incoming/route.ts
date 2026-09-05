import twilio from "twilio";
import {
  logCommunicationEvent,
  findGuestByPhone,
} from "@/lib/communications.server";
import {
  elevenLabsConfigured,
  registerElevenLabsTwilioCall,
} from "@/lib/elevenlabs.server";
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
  const to = params.get("To") ?? "";
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

  if (
    process.env.TWILIO_INBOUND_MODE?.trim().toLowerCase() === "ai" &&
    elevenLabsConfigured()
  ) {
    try {
      const aiTwiml = await registerElevenLabsTwilioCall({
        fromNumber: from,
        toNumber: to,
        callSid,
        guestId: guest?.id,
        guestName: guest?.display_name,
      });
      await logCommunicationEvent({
        eventType: "voice.ai.connected",
        message: "Inbound call routed to ElevenLabs.",
        metadata: { callSid, from, guestId: guest?.id },
      });
      return xmlResponse(aiTwiml);
    } catch (error) {
      await logCommunicationEvent({
        eventType: "voice.ai.fallback",
        message: "ElevenLabs routing failed; falling back to human ring group.",
        severity: "warning",
        metadata: {
          callSid,
          error: error instanceof Error ? error.message.slice(0, 400) : "unknown",
        },
      });
    }
  }

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
