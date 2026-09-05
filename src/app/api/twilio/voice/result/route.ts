import twilio from "twilio";
import { logCommunicationEvent } from "@/lib/communications.server";
import { readTwilioForm, twilioAbsoluteUrl, twilioSmsEnabled, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params)) return new Response("Forbidden", { status: 403 });
  const callSid = params.get("CallSid") ?? "";
  const status = params.get("DialCallStatus") ?? "unknown";
  const bridged = params.get("DialBridged") === "true";
  const from = params.get("From") ?? "";
  await logCommunicationEvent({ eventType: bridged ? "voice.answered" : "voice.missed",
    message: bridged ? "Inbound call was answered." : `Inbound call ended ${status}.`,
    severity: bridged ? "info" : "warning", metadata: { callSid, from, dialStatus: status, bridged } });
  const response = new twilio.twiml.VoiceResponse();
  if (bridged || status === "completed") { response.hangup(); return xmlResponse(response.toString()); }
  if (twilioSmsEnabled() && process.env.TWILIO_MISSED_CALL_SMS_ENABLED?.trim() === "true") {
    const gather = response.gather({ input: ["dtmf"], numDigits: 1, timeout: 5,
      action: twilioAbsoluteUrl("/api/twilio/voice/missed-consent"), method: "POST" });
    gather.say("To receive Le Yard service texts about this request, press 1 to agree. Message frequency varies. Message and data rates may apply. Reply HELP for help or STOP to opt out. Terms at leyardny dot com slash terms. Privacy at leyardny dot com slash privacy. Otherwise, stay on the line to leave a voicemail.");
  }
  response.say("Please leave Le Yard a short voicemail after the tone.");
  response.record({ action: twilioAbsoluteUrl("/api/twilio/voice/voicemail"), method: "POST", maxLength: 120, playBeep: true });
  response.hangup();
  return xmlResponse(response.toString());
}
