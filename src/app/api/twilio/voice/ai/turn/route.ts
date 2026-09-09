import { readTwilioForm, twilioPhoneNumber, validateTwilioRequest, xmlResponse } from "@/lib/twilio.server";
import { buildVoiceExit, buildVoiceGather, generateVoiceReply, openVoiceState, type VoiceReply, type VoiceState } from "@/lib/voice-ai.server";
import { publishReceptionSpeech } from "@/lib/fish-voice.server";
import { recordVoiceEvent } from "@/lib/voice-telemetry.server";

export const maxDuration = 15;

export async function POST(request: Request) {
  const { params } = await readTwilioForm(request);
  if (!validateTwilioRequest(request, params) || params.get("To") !== twilioPhoneNumber()) return new Response("Forbidden", { status: 403 });
  let state: VoiceState;
  try { state = openVoiceState(new URL(request.url).searchParams.get("state") ?? "", params.get("CallSid") ?? ""); }
  catch { return new Response("Invalid session", { status: 403 }); }

  const started = Date.now();
  const speech = (params.get("SpeechResult") ?? "").trim().slice(0, 1000);
  const digit = params.get("Digits");
  let reply: VoiceReply;
  let fallback = false;
  if (digit === "0") reply = { action: "handoff", text: "Of course. I'll try the team for you." };
  else if (state.turn >= 12) reply = { action: "voicemail", text: "Let's make sure the team gets your request. Please leave a message after the tone." };
  else if (!speech) {
    state.silences += 1;
    reply = state.silences < 2 ? { action: "continue", text: "Are you still there? Tell me how I can help, or press zero for the team." }
      : { action: "end", text: "I couldn't hear you. You're welcome to call us again, or visit le yard n y dot com. Take care." };
  } else {
    state.silences = 0;
    try { reply = await generateVoiceReply(state, speech); }
    catch { fallback = true; reply = { action: "continue", text: "I'm having a little trouble connecting. You can press zero for the team, or leave a message by saying voicemail." }; }
    // A second provider failure exits cleanly rather than leaving the caller in a loop.
    if (fallback && state.history.at(-1)?.text.includes("trouble connecting")) reply = { action: "voicemail", text: "I'm sorry about that. Please leave the team a message after the tone." };
    if (/^(?:voice\s?mail|leave (?:a )?message)[.!]?$/i.test(speech)) reply = { action: "voicemail", text: "Of course. Please leave your name and request after the tone." };
  }
  state.turn += 1;
  state.history = [...state.history, ...(speech ? [{ role: "user" as const, text: speech.slice(0, 220) }] : []), { role: "model" as const, text: reply.text.slice(0, 220) }].slice(-8);
  while (Buffer.byteLength(JSON.stringify(state), "utf8") > 2500 && state.history.length > 1) state.history.shift();
  let audioUrl: string | undefined;
  try { audioUrl = await publishReceptionSpeech(reply.text); } catch { /* intelligible Twilio speech remains available */ }
  if (!state.internalTest) await recordVoiceEvent({ eventType: "voice.ai.turn", message: `AI receptionist ${reply.action === "continue" ? "answered the caller" : `requested ${reply.action}`}.`,
    metadata: { callSid: state.callSid, turn: state.turn, action: reply.action, modelFallback: fallback, voice: audioUrl ? "fish" : "polly", latencyMs: Date.now() - started } });
  return xmlResponse(reply.action === "continue" ? buildVoiceGather(state, reply.text, audioUrl) : buildVoiceExit(state, reply.action, reply.text, audioUrl));
}
