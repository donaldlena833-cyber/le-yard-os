import { buildVoiceExit, openVoiceState } from "@/lib/voice-ai.server";
import { readTwilioForm, twilioPhoneNumber, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";
export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params) || params.get("To") !== twilioPhoneNumber()) return new Response("Forbidden", { status: 403 });
  try {
    const state = openVoiceState(new URL(request.url).searchParams.get("state") ?? "", params.get("CallSid") ?? "");
    return xmlResponse(buildVoiceExit(state, "handoff", "Let me try the team for you."));
  } catch { return new Response("Invalid session", { status: 403 }); }
}
