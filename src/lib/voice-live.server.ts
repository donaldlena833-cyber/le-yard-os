import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import twilio from "twilio";
import { z } from "zod";
import { openVoiceState, sealVoiceState, type VoiceState } from "@/lib/voice-ai.server";
import { twilioAbsoluteUrl, twilioAccountSid, twilioAuthToken } from "@/lib/twilio.server";

export const LIVE_VOICE_MODEL = "gemini-3.1-flash-live-preview";
export function liveStreamUrl() {
  const raw = process.env.VOICE_LIVE_STREAM_URL?.trim();
  if (!raw) throw new Error("live_voice_not_configured");
  const url = new URL(raw);
  if (url.protocol !== "wss:" || url.search || url.hash || url.username || url.password || url.pathname !== "/stream") throw new Error("invalid_live_voice_url");
  return url.toString();
}

export function buildLiveVoiceConnect(state: VoiceState) {
  const token = sealVoiceState(state);
  if (token.length + 5 >= 500) throw new Error("live_voice_token_too_large");
  const response = new twilio.twiml.VoiceResponse();
  const stream = response.connect().stream({ url: liveStreamUrl(), name: "le-yard-live-reception" });
  stream.parameter({ name: "token", value: token });
  response.redirect({ method: "POST" }, `${twilioAbsoluteUrl("/api/twilio/voice/live/fallback")}?state=${token}`);
  return response.toString();
}

export const liveSessionInputSchema = z.object({
  token: z.string().min(50).max(499), callSid: z.string().regex(/^CA[0-9a-f]{32}$/i),
  accountSid: z.string().regex(/^AC[0-9a-f]{32}$/i), streamUrl: z.string().max(300),
  twilioSignature: z.string().max(100).optional().default(""),
}).strict();

export function validateLiveSession(input: z.infer<typeof liveSessionInputSchema>) {
  const state = openVoiceState(input.token, input.callSid);
  if (state.turn !== 0 || state.history.length || input.accountSid !== twilioAccountSid()) throw new Error("invalid_live_session");
  const expected = new URL(liveStreamUrl()); expected.protocol = "https:";
  const requested = new URL(input.streamUrl);
  if (requested.protocol === "wss:") requested.protocol = "https:";
  if (requested.toString() !== expected.toString()) throw new Error("invalid_stream_origin");
  if (!state.internalTest) {
    // Twilio's WS upgrade signature authenticates the exact configured stream URL.
    // A separate encrypted CallSid capability binds the subsequent start frame.
    const signature = input.twilioSignature;
    if (!signature || ![expected.toString(), liveStreamUrl()].some(url => twilio.validateRequest(twilioAuthToken(), signature, url, {}))) throw new Error("invalid_stream_signature");
  }
  return state;
}

let instruction: string | undefined;
export function liveVoiceSetup() {
  instruction ??= readFileSync(join(process.cwd(), "docs/le-yard-receptionist-live.md"), "utf8");
  return {
    model: `models/${LIVE_VOICE_MODEL}`,
    generationConfig: { responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } } },
    systemInstruction: { parts: [{ text: `${instruction}\nCurrent New York date and time: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(new Date())}.` }] },
    realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 200, silenceDurationMs: 500 }, activityHandling: "START_OF_ACTIVITY_INTERRUPTS" },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    tools: [{ functionDeclarations: [
      { name: "transfer_to_team", description: "Connect this caller to Le Yard's founders when they ask for a person or a matter needs the team. No phone number argument.", parameters: { type: "OBJECT", properties: {} } },
      { name: "take_voicemail", description: "Let this caller leave the team a recorded message after they choose voicemail. Tell them to leave it after the tone.", parameters: { type: "OBJECT", properties: {} } },
      { name: "end_call", description: "End this call after the caller says goodbye or is finished. Say a brief warm goodbye first.", parameters: { type: "OBJECT", properties: {} } },
    ] }],
  };
}

export async function createLiveVoiceSession() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("live_voice_not_configured");
  const setup = liveVoiceSetup();
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ uses: 1, expireTime: new Date(Date.now() + 20 * 60_000).toISOString(),
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(), bidiGenerateContentSetup: setup }),
    signal: AbortSignal.timeout(6000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`live_token_http_${response.status}`);
  const token = await response.json();
  if (typeof token.name !== "string" || !token.name.startsWith("auth_tokens/")) throw new Error("invalid_live_token");
  return { url: "https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
    headers: { Authorization: `Token ${token.name}` }, setup };
}
