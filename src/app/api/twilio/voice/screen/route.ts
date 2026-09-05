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

  const staff = new URL(request.url).searchParams.get("staff") ?? "staff";
  const response = new twilio.twiml.VoiceResponse();
  const gather = response.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 4,
    action: `${twilioAbsoluteUrl("/api/twilio/voice/screen-result")}?staff=${encodeURIComponent(staff)}`,
    method: "POST",
  });
  gather.say("Le Yard call. Press 1 to accept.");
  response.hangup();
  return xmlResponse(response.toString());
}
