import twilio from "twilio";
import { findGuestByPhone } from "@/lib/communications.server";
import { elevenLabsConfigured, registerElevenLabsTwilioCall } from "@/lib/elevenlabs.server";
import { readTwilioForm, twilioAbsoluteUrl, twilioForwardNumbers, twilioPhoneNumber, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";
import { addReceptionGreeting } from "@/lib/voice-reception.server";
import { buildVoiceGather, createVoiceState, voiceAiConfigured, VOICE_AI_GREETING } from "@/lib/voice-ai.server";
import { recordVoiceEvent } from "@/lib/voice-telemetry.server";
import { buildLiveVoiceConnect } from "@/lib/voice-live.server";

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
  if ((process.env.TWILIO_INBOUND_MODE?.trim().toLowerCase() === "gemini-live" || (internalTest && params.get("VoiceEngine") === "live")) && voiceAiConfigured()) {
    const state = { ...createVoiceState(callSid), internalTest };
    try {
      const xml = buildLiveVoiceConnect(state);
      if (!internalTest) await recordVoiceEvent({ eventType: "voice.inbound", message: "Inbound call answered by Le Yard reception.", metadata: { callSid, from, direction: "inbound", provider: "gemini-live" } });
      return xmlResponse(xml);
    } catch { if (internalTest) return new Response("Live voice unavailable", { status: 503 }); }
  }
  if ((process.env.TWILIO_INBOUND_MODE?.trim().toLowerCase() === "fish-gemini" || internalTest) && voiceAiConfigured()) {
    const state = { ...createVoiceState(callSid), internalTest };
    if (!internalTest) await recordVoiceEvent({ eventType: "voice.inbound", message: "Inbound call answered by Le Yard's AI receptionist.", metadata: { callSid, from, direction: "inbound", provider: "fish-gemini" } });
    return xmlResponse(buildVoiceGather(state, VOICE_AI_GREETING, twilioAbsoluteUrl("/audio/le-yard-ai-welcome.wav")));
  }
  // A failed diagnostic must never fall through to a live founder ring group.
  if (internalTest) return new Response("AI unavailable", { status: 503 });
  let guest: Awaited<ReturnType<typeof findGuestByPhone>> = null;
  if (from.startsWith("+")) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      guest = await Promise.race([findGuestByPhone(from).catch(() => null),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 300); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  await recordVoiceEvent({ eventType: "voice.inbound", message: "Inbound Le Yard call received.",
    metadata: { callSid, from, guestId: guest?.id, guestName: guest?.display_name, direction: "inbound" } });

  if (process.env.TWILIO_INBOUND_MODE?.trim().toLowerCase() === "ai" && elevenLabsConfigured()) {
    try {
      const aiTwiml = await registerElevenLabsTwilioCall({ fromNumber: from, toNumber: to, callSid, guestId: guest?.id, guestName: guest?.display_name });
      await recordVoiceEvent({ eventType: "voice.ai.connected", message: "Inbound call routed to ElevenLabs.", metadata: { callSid, from, guestId: guest?.id } });
      return xmlResponse(aiTwiml);
    } catch {
      await recordVoiceEvent({ eventType: "voice.ai.fallback", message: "ElevenLabs routing failed; falling back to human ring group.", severity: "warning", metadata: { callSid } });
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
