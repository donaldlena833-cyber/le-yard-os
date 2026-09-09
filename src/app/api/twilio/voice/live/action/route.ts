import { z } from "zod";
import { buildVoiceExit, openVoiceState } from "@/lib/voice-ai.server";
import { twilioPhoneNumber, twilioRestClient } from "@/lib/twilio.server";
import { recordVoiceEvent } from "@/lib/voice-telemetry.server";
export const maxDuration = 15;
const inputSchema = z.object({ token: z.string().min(50).max(499), callSid: z.string().regex(/^CA[0-9a-f]{32}$/i), action: z.enum(["handoff", "voicemail", "end"]) }).strict();
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  let input;
  try { const body = await request.text(); if (body.length > 1200) throw new Error(); input = inputSchema.parse(JSON.parse(body)); }
  catch { return new Response("Invalid action", { status: 400, headers }); }
  let state;
  try { state = openVoiceState(input.token, input.callSid); if (state.turn !== 0 || state.history.length) throw new Error(); }
  catch { return new Response("Forbidden", { status: 403, headers }); }
  if (state.internalTest) return Response.json({ ok: true, action: input.action, suppressed: true }, { headers });
  try {
    const resource = twilioRestClient().calls(state.callSid);
    const call = await resource.fetch();
    if (call.status !== "in-progress" || call.direction !== "inbound" || call.to !== twilioPhoneNumber()) return new Response("Inactive call", { status: 409, headers });
    await resource.update({ twiml: buildVoiceExit(state, input.action, "") });
    await recordVoiceEvent({ eventType: "voice.live.action", message: `Streaming receptionist requested ${input.action}.`, metadata: { callSid: state.callSid, action: input.action } });
    return Response.json({ ok: true, action: input.action }, { headers });
  } catch { return Response.json({ error: "Call action unavailable" }, { status: 503, headers }); }
}
