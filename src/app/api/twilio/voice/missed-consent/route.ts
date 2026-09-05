import twilio from "twilio";
import {
  logCommunicationEvent,
  recordServiceSmsConsent,
} from "@/lib/communications.server";
import {
  readTwilioForm,
  sendTwilioMessage,
  validateTwilioRequest,
  xmlResponse,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const response = new twilio.twiml.VoiceResponse();
  const from = params.get("From") ?? "";
  const callSid = params.get("CallSid") ?? "";
  if (params.get("Digits") !== "1" || !from.startsWith("+")) {
    response.say("No problem. We hope to speak with you soon.");
    response.hangup();
    return xmlResponse(response.toString());
  }

  const evidence = `Caller pressed 1 during missed-call recovery for ${callSid}.`;
  await recordServiceSmsConsent({ phone: from, evidence }).catch(() => false);
  try {
    const message = await sendTwilioMessage(
      from,
      "Le Yard: Sorry we missed your call. Reply here with how we can help, including your preferred date, time, and party size for reservations. Reply STOP to opt out.",
    );
    await logCommunicationEvent({
      eventType: "voice.missed.sms_recovery",
      message: "Missed-call recovery SMS queued.",
      metadata: { callSid, from, messageSid: message.sid },
    });
    response.say("Thanks. We just sent you a text from Le Yard.");
  } catch (error) {
    await logCommunicationEvent({
      eventType: "voice.missed.sms_recovery_failed",
      message: "Missed-call recovery SMS could not be queued.",
      severity: "error",
      metadata: {
        callSid,
        from,
        error: error instanceof Error ? error.message.slice(0, 400) : "unknown",
      },
    });
    response.say("Thanks. We have your call and will follow up as soon as we can.");
  }
  response.hangup();
  return xmlResponse(response.toString());
}
