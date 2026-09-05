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

  const url = new URL(request.url);
  const staff = url.searchParams.get("staff") ?? "staff";
  const destination = url.searchParams.get("to") ?? "";
  const status = params.get("DialCallStatus") ?? "unknown";
  await logCommunicationEvent({
    eventType: `voice.outbound.${status}`,
    message: `Le Yard outbound call by ${staff}: ${status}.`,
    severity: ["failed", "busy", "no-answer"].includes(status) ? "warning" : "info",
    metadata: {
      staff,
      to: destination,
      callSid: params.get("CallSid") ?? "",
      dialCallSid: params.get("DialCallSid") ?? undefined,
      dialStatus: status,
      dialDurationSeconds: Number(params.get("DialCallDuration") ?? "0") || undefined,
    },
  });
  const response = new twilio.twiml.VoiceResponse();
  response.hangup();
  return xmlResponse(response.toString());
}
