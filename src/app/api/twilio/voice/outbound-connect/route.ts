import twilio from "twilio";
import { logCommunicationEvent } from "@/lib/communications.server";
import {
  normalizeE164,
  readTwilioForm,
  twilioAbsoluteUrl,
  twilioPhoneNumber,
  validateTwilioRequest,
  xmlResponse,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const staff = url.searchParams.get("staff") ?? "staff";
  let destination: string;
  try {
    destination = normalizeE164(url.searchParams.get("to") ?? "");
  } catch {
    return new Response("Invalid destination", { status: 400 });
  }

  const response = new twilio.twiml.VoiceResponse();
  if (params.get("Digits") !== "1") {
    response.hangup();
    return xmlResponse(response.toString());
  }

  await logCommunicationEvent({
    eventType: "voice.outbound.accepted",
    message: `Le Yard outbound call accepted by ${staff}.`,
    metadata: {
      staff,
      to: destination,
      callSid: params.get("CallSid") ?? "",
    },
  });

  const result = new URL(twilioAbsoluteUrl("/api/twilio/voice/outbound-result"));
  result.searchParams.set("staff", staff);
  result.searchParams.set("to", destination);
  const dial = response.dial({
    callerId: twilioPhoneNumber(),
    action: result.toString(),
    method: "POST",
    answerOnBridge: true,
    timeout: 30,
  });
  dial.number(destination);
  return xmlResponse(response.toString());
}
