import twilio from "twilio";
import { logCommunicationEvent } from "@/lib/communications.server";
import { readTwilioForm, twilioAbsoluteUrl, twilioSmsEnabled, twilioRestClient, twilioForwardNumbers, twilioPhoneNumber, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";

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
  if (bridged) { response.hangup(); return xmlResponse(response.toString()); }
  // Twilio cancels sibling legs on handset answer, before screening completes.
  // If screening rejects that answer, give the other owner a fresh chance.
  const alreadyRetried = new URL(request.url).searchParams.get("retried") === "1";
  const childSid = params.get("DialCallSid") ?? "";
  if (!alreadyRetried && status === "completed" && /^CA[0-9a-f]{32}$/i.test(childSid)) {
    try {
      const child = await twilioRestClient().calls(childSid).fetch();
      const forwards = twilioForwardNumbers();
      const other = child.to === forwards.donald ? "maris" : child.to === forwards.maris ? "donald" : null;
      if (other) {
        response.say("Trying our other team member.");
        const dial = response.dial({ answerOnBridge: true, timeout: 24, timeLimit: 1800,
          callerId: twilioPhoneNumber(), action: `${twilioAbsoluteUrl("/api/twilio/voice/result")}?retried=1`, method: "POST" });
        dial.number({ url: `${twilioAbsoluteUrl("/api/twilio/voice/screen")}?staff=${other}`, method: "POST",
          statusCallback: `${twilioAbsoluteUrl("/api/twilio/voice/status")}?staff=${other}`, statusCallbackMethod: "POST",
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"] }, forwards[other]);
        await logCommunicationEvent({eventType:"voice.forward.retry",message:"Screened answer did not bridge; retrying the other owner.",metadata:{callSid,staff:other}});
        return xmlResponse(response.toString());
      }
    } catch { /* The standard voicemail path remains available if lookup fails. */ }
  }
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
