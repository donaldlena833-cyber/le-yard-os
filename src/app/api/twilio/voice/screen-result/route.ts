import twilio from "twilio";
import { logCommunicationEvent } from "@/lib/communications.server";
import {
  readTwilioForm,
  validateTwilioRequest,
  xmlResponse,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const staff = new URL(request.url).searchParams.get("staff") ?? "staff";
  const accepted = params.get("Digits") === "1";
  await logCommunicationEvent({
    eventType: accepted ? "voice.forward.accepted" : "voice.forward.declined",
    message: accepted
      ? `Forwarded call accepted by ${staff}.`
      : `Forwarded call declined by ${staff}.`,
    metadata: {
      staff,
      callSid: params.get("CallSid") ?? "",
      parentCallSid: params.get("ParentCallSid") ?? undefined,
    },
  });

  const response = new twilio.twiml.VoiceResponse();
  if (accepted) response.say("Connecting.");
  else response.hangup();
  return xmlResponse(response.toString());
}
