import { createLiveVoiceSession, liveSessionInputSchema, validateLiveSession } from "@/lib/voice-live.server";
export const maxDuration = 10;
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  let input;
  try {
    const body = await request.text();
    if (body.length > 2000) throw new Error();
    input = liveSessionInputSchema.parse(JSON.parse(body));
  } catch { return new Response("Invalid session", { status: 400, headers }); }
  let state;
  try { state = validateLiveSession(input); }
  catch { return new Response("Forbidden", { status: 403, headers }); }
  try {
    const gemini = await createLiveVoiceSession();
    return Response.json({ callSid: state.callSid, internalTest: state.internalTest === true, gemini }, { headers });
  } catch { return Response.json({ error: "Voice connection is unavailable" }, { status: 503, headers }); }
}
