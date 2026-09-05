import twilio from "twilio";
import {
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
  const context = (url.searchParams.get("context") ?? "").slice(0, 120);
  const response = new twilio.twiml.VoiceResponse();
  const action = new URL(twilioAbsoluteUrl("/api/twilio/voice/screen-result"));
  action.searchParams.set("staff", staff);
  const gather = response.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 4,
    action: action.toString(),
    method: "POST",
  });
  gather.say(
    context ? `Le Yard call. ${context}. Press 1 to accept.` : "Le Yard call. Press 1 to accept.",
  );
  response.hangup();
  return xmlResponse(response.toString());
}
