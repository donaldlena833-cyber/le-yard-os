import twilio from "twilio";
import { logCommunicationEvent, recordServiceSmsConsent } from "@/lib/communications.server";
import { readTwilioForm, sendTwilioMessage, twilioAbsoluteUrl, twilioSmsEnabled, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params)) return new Response("Forbidden", { status: 403 });
  const response = new twilio.twiml.VoiceResponse();
  const from = params.get("From") ?? "";
  const callSid = params.get("CallSid") ?? "";
  if (params.get("Digits") !== "1" || !from.startsWith("+")) {
    response.say("No problem. Please leave Le Yard a short voicemail after the tone.");
    response.record({ action: twilioAbsoluteUrl("/api/twilio/voice/voicemail"), method: "POST", maxLength: 120, playBeep: true });
    response.hangup(); return xmlResponse(response.toString());
  }
  try {
    if (!twilioSmsEnabled() || process.env.TWILIO_MISSED_CALL_SMS_ENABLED?.trim() !== "true") throw new Error("Missed-call SMS is not enabled.");
    const evidence = `Disclosure guest-care-v1; caller pressed 1 for ${callSid}; ${new Date().toISOString()}.`;
    await recordServiceSmsConsent({ phone: from, evidence });
    const message = await sendTwilioMessage(from,
      "Le Yard: You agreed to service texts about your request. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out. How can we help?");
    await logCommunicationEvent({ eventType: "voice.missed.sms_recovery", message: "Missed-call recovery SMS queued.", metadata: { callSid, from, messageSid: message.sid } });
    response.say("Thank you. Your service-text request is recorded. We are attempting to deliver your text.");
  } catch {
    await logCommunicationEvent({ eventType: "voice.missed.sms_recovery_failed", message: "Missed-call recovery SMS could not be queued.", severity: "error", metadata: { callSid, from } });
    response.say("We could not send the text. Please leave your name, callback number, and request after the tone.");
    response.record({ action: twilioAbsoluteUrl("/api/twilio/voice/voicemail"), method: "POST", maxLength: 120, playBeep: true });
  }
  response.hangup();
  return xmlResponse(response.toString());
}
