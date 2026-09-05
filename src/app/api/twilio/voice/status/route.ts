import { logCommunicationEvent } from "@/lib/communications.server";
import {
  readTwilioForm,
  validateTwilioRequest,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const status = params.get("CallStatus") ?? "unknown";
  const staff = new URL(request.url).searchParams.get("staff") ?? undefined;
  await logCommunicationEvent({
    eventType: `voice.status.${status}`,
    message: staff
      ? `Forwarded call leg for ${staff}: ${status}.`
      : `Le Yard call status: ${status}.`,
    severity: status === "failed" ? "error" : "debug",
    metadata: {
      callSid: params.get("CallSid") ?? "",
      parentCallSid: params.get("ParentCallSid") ?? undefined,
      from: params.get("From") ?? undefined,
      to: params.get("To") ?? undefined,
      durationSeconds: Number(params.get("CallDuration") ?? "0") || undefined,
      staff,
      status,
    },
  });
  return new Response(null, { status: 204 });
}
