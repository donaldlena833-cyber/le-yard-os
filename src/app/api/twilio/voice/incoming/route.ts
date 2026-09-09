import twilio from "twilio";
import { logCommunicationEvent, findGuestByPhone } from "@/lib/communications.server";
import { elevenLabsConfigured, registerElevenLabsTwilioCall } from "@/lib/elevenlabs.server";
import { readTwilioForm, twilioAbsoluteUrl, twilioForwardNumbers, twilioPhoneNumber, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";
import { addReceptionGreeting } from "@/lib/voice-reception.server";
import { buildVoiceGather, createVoiceState, voiceAiConfigured, VOICE_AI_GREETING } from "@/lib/voice-ai.server";

export const maxDuration = 15;

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params)) return new Response("Forbidden", { status: 403 });
  const from = params.get("From") ?? "";
  const to = params.get("To") ?? "";
  const callSid = params.get("CallSid") ?? "";
  if (to !== twilioPhoneNumber() || !/^CA[0-9a-f]{32}$/i.test(callSid)) return new Response("Forbidden", { status: 403 });
  const internalTest = params.get("InternalTest") === "true";
  if (internalTest && (!Number.isSafeInteger(Number(params.get("Timestamp"))) || Math.abs(Date.now() / 1000 - Number(params.get("Timestamp"))) > 300))
    return new Response("Invalid test", { status: 400 });
  if ((process.env.TWILIO_INBOUND_MODE?.trim().toLowerCase() === "fish-gemini" || internalTest) && voiceAiConfigured()) {
    const state = { ...createVoiceState(callSid), internalTest };
    if (!internalTest) await logCommunicationEvent({ eventType: "voice.inbound", message: "Inbound call answered by Le Yard's AI receptionist.", metadata: { callSid, from, direction: "inbound", provider: "fish-gemini" } }).catch(() => false);
    return xmlResponse(buildVoiceGather(state, VOICE_AI_GREETING, twilioAbsoluteUrl("/audio/le-yard-ai-welcome.wav")));
  }
  // A failed diagnostic must never fall through to a live founder ring group.
  if (internalTest) return new Response("AI unavailable", { status: 503 });
  const guest = from.startsWith("+") ? await findGuestByPhone(from).catch(() => null) : null;
  await logCommunicationEvent({ eventType: "voice.inbound", message: "Inbound Le Yard call received.",
    metadata: { callSid, from, guestId: guest?.id, guestName: guest?.display_name, direction: "inbound" } });

  if (process.env.TWILIO_INBOUND_MODE?.trim().toLowerCase() === "ai" && elevenLabsConfigured()) {
    try {
      const aiTwiml = await registerElevenLabsTwilioCall({ fromNumber: from, toNumber: to, callSid, guestId: guest?.id, guestName: guest?.display_name });
      await logCommunicationEvent({ eventType: "voice.ai.connected", message: "Inbound call routed to ElevenLabs.", metadata: { callSid, from, guestId: guest?.id } });
      return xmlResponse(aiTwiml);
    } catch {
      await logCommunicationEvent({ eventType: "voice.ai.fallback", message: "ElevenLabs routing failed; falling back to human ring group.", severity: "warning", metadata: { callSid } });
    }
  }
  const response = new twilio.twiml.VoiceResponse();
  addReceptionGreeting(response);
  const dial = response.dial({ answerOnBridge: true, timeout: 24, timeLimit: 1800,
    callerId: twilioPhoneNumber(), action: twilioAbsoluteUrl("/api/twilio/voice/result"), method: "POST" });
  for (const [label, phone] of Object.entries(twilioForwardNumbers())) {
    dial.number({ url: `${twilioAbsoluteUrl("/api/twilio/voice/screen")}?staff=${encodeURIComponent(label)}`,
      method: "POST", statusCallback: `${twilioAbsoluteUrl("/api/twilio/voice/status")}?staff=${encodeURIComponent(label)}`,
      statusCallbackMethod: "POST", statusCallbackEvent: ["initiated", "ringing", "answered", "completed"] }, phone);
  }
  return xmlResponse(response.toString());
}
