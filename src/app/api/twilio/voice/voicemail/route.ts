import twilio from "twilio";
import {
  logCommunicationEvent,
  notifyOwnersOfCommunication,
} from "@/lib/communications.server";
import {
  readTwilioForm,
  validateTwilioRequest,
  xmlResponse,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const from = params.get("From") ?? "";
  const recordingSid = params.get("RecordingSid") ?? "";
  const callSid = params.get("CallSid") ?? "";
  const duration = Number(params.get("RecordingDuration") ?? "0") || 0;
  await logCommunicationEvent({
    eventType: "voice.voicemail",
    message: "New Le Yard voicemail recorded.",
    metadata: { from, callSid, recordingSid, durationSeconds: duration },
  });
  await notifyOwnersOfCommunication({
    title: "New Le Yard voicemail",
    body: `Missed call${from ? ` from ${from}` : ""} left a ${duration || "short"}-second voicemail.`,
    eventType: "voice_voicemail",
  });

  const response = new twilio.twiml.VoiceResponse();
  response.say("Thank you. We received your message.");
  response.hangup();
  return xmlResponse(response.toString());
}
