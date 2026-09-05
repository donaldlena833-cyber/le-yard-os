import { logCommunicationEvent } from "@/lib/communications.server";
import {
  readTwilioForm,
  validateTwilioRequest,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const status = params.get("MessageStatus") ?? "unknown";
  const failed = status === "failed" || status === "undelivered";
  await logCommunicationEvent({
    eventType: `sms.status.${status}`,
    message: `Le Yard SMS status: ${status}.`,
    severity: failed ? "error" : "debug",
    metadata: {
      messageSid: params.get("MessageSid") ?? "",
      to: params.get("To") ?? undefined,
      from: params.get("From") ?? undefined,
      status,
      errorCode: params.get("ErrorCode") ?? undefined,
      errorMessage: params.get("ErrorMessage") ?? undefined,
    },
  });
  return new Response(null, { status: 204 });
}
