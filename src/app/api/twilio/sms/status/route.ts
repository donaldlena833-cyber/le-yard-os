import { saveCommunicationMessage } from "@/lib/communication-groups.server";
import { logCommunicationEvent } from "@/lib/communications.server";
import {
  readTwilioForm, twilioRestClient, twilioPhoneNumber,
  validateTwilioRequest,
} from "@/lib/twilio.server";

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params))
    return new Response("Forbidden", { status: 403 });

  const sid = params.get("MessageSid") ?? "";
  if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid)) return new Response("Invalid message", {status:400});
  try {
    // Read the current resource so duplicate or out-of-order callbacks cannot
    // roll delivery status back. This also archives TwiML/agent-generated replies.
    const m = await twilioRestClient().messages(sid).fetch();
    if (m.from !== twilioPhoneNumber() && m.to !== twilioPhoneNumber()) return new Response("Forbidden",{status:403});
    await saveCommunicationMessage({sid:m.sid,from:m.from,to:m.to,body:m.body,status:m.status,
      at:(m.dateSent??m.dateCreated).toISOString(),mediaCount:Number(m.numMedia)||0,errorCode:m.errorCode,
      senderKind:m.direction === 'outbound-reply' ? 'automation' : undefined});
  } catch { return new Response("Transcript temporarily unavailable",{status:503}); }
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
