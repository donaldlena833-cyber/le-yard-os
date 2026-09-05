import twilio from "twilio";
import {
  normalizeE164,
  readTwilioForm,
  twilioAbsoluteUrl,
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

  const action = new URL(twilioAbsoluteUrl("/api/twilio/voice/outbound-connect"));
  action.searchParams.set("to", destination);
  action.searchParams.set("staff", staff);
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 5,
    action: action.toString(),
    method: "POST",
  });
  gather.say("Le Yard outbound call. Press 1 to connect.");
  response.hangup();
  return xmlResponse(response.toString());
}
