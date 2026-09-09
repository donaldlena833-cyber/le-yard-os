import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(), fetch: vi.fn(), calls: vi.fn(), callFetch: vi.fn(), callUpdate: vi.fn(),
  callCreate: vi.fn(), messageCreate: vi.fn(), event: vi.fn(), log: vi.fn(), guest: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/twilio.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/twilio.server")>(),
  validateTwilioRequest: mocks.validate,
  twilioRestClient: () => ({ calls: mocks.calls, messages: { create: mocks.messageCreate } }),
}));
vi.mock("@/lib/voice-telemetry.server", () => ({ recordVoiceEvent: mocks.event }));
vi.mock("@/lib/communications.server", () => ({ logCommunicationEvent: mocks.log, findGuestByPhone: mocks.guest }));
vi.mock("@/lib/elevenlabs.server", () => ({ elevenLabsConfigured: () => false, registerElevenLabsTwilioCall: vi.fn() }));

import {
  buildLiveVoiceConnect, createLiveVoiceSession, LIVE_VOICE_MODEL,
  liveSessionInputSchema, liveStreamUrl, liveVoiceSetup, validateLiveSession,
} from "@/lib/voice-live.server";
import { createVoiceState, openVoiceState, sealVoiceState } from "@/lib/voice-ai.server";
import { POST as sessionRoute } from "@/app/api/twilio/voice/live/session/route";
import { POST as actionRoute } from "@/app/api/twilio/voice/live/action/route";
import { POST as fallbackRoute } from "@/app/api/twilio/voice/live/fallback/route";
import { POST as incomingRoute } from "@/app/api/twilio/voice/incoming/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";

const callSid = `CA${"1".repeat(32)}`;
const otherCallSid = `CA${"2".repeat(32)}`;
const accountSid = `AC${"a".repeat(32)}`;
const authToken = "synthetic-twilio-live-test-token";
const geminiKey = "synthetic-root-gemini-secret-never-live";
const base = "https://phone.example.test";
const stream = "wss://le-yard-reception.donaldlena833.workers.dev/stream";
const streamHttps = stream.replace("wss:", "https:");
const businessNumber = "+12125550100";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-09T14:00:00.000Z"));
  vi.stubEnv("VOICE_AI_STATE_SECRET", "synthetic-live-voice-state-secret-".repeat(2));
  vi.stubEnv("VOICE_LIVE_STREAM_URL", stream);
  vi.stubEnv("TWILIO_INBOUND_MODE", "gemini-live");
  vi.stubEnv("GEMINI_API_KEY", geminiKey);
  vi.stubEnv("TWILIO_ACCOUNT_SID", accountSid);
  vi.stubEnv("TWILIO_AUTH_TOKEN", authToken);
  vi.stubEnv("TWILIO_PUBLIC_BASE_URL", base);
  vi.stubEnv("TWILIO_FROM_NUMBER", businessNumber);
  vi.stubEnv("TWILIO_PHONE_NUMBER", businessNumber);
  vi.stubEnv("TWILIO_FORWARD_DONALD", "+12125550101");
  vi.stubEnv("TWILIO_FORWARD_MARIS", "+12125550102");
  vi.stubGlobal("fetch", mocks.fetch);
  vi.resetAllMocks();
  mocks.validate.mockReturnValue(true);
  mocks.event.mockResolvedValue(undefined);
  mocks.log.mockResolvedValue(undefined);
  mocks.guest.mockResolvedValue(null);
  mocks.fetch.mockResolvedValue(Response.json({ name: "auth_tokens/synthetic-once-only" }));
  mocks.callFetch.mockResolvedValue({ sid: callSid, status: "in-progress", direction: "inbound", to: businessNumber });
  mocks.callUpdate.mockResolvedValue({ sid: callSid });
  mocks.calls.mockReturnValue({ fetch: mocks.callFetch, update: mocks.callUpdate });
  Object.assign(mocks.calls, { create: mocks.callCreate });
});

afterEach(() => {
  // Direct API creation of calls/messages is never needed by these handlers.
  expect(mocks.callCreate).not.toHaveBeenCalled();
  expect(mocks.messageCreate).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function capability(internalTest = false) {
  return sealVoiceState({ ...createVoiceState(callSid), internalTest });
}
function signature(url = streamHttps) {
  return createHmac("sha1", authToken).update(url).digest("base64");
}
function sessionInput(internalTest = false) {
  return { token: capability(internalTest), callSid, accountSid, streamUrl: stream, twilioSignature: internalTest ? "" : signature() };
}
function jsonRequest(path: string, body: unknown) {
  return new Request(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function formRequest(path: string, fields: Record<string, string> = {}) {
  return new Request(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "mocked-request-signature" },
    body: new URLSearchParams({ CallSid: callSid, AccountSid: accountSid, To: businessNumber, From: "+12125550103", Timestamp: String(Date.now() / 1000), ...fields }),
  });
}

describe("live media capability and upgrade authentication", () => {
  it("accepts only a call-bound encrypted capability and authentic provider upgrade signature", () => {
    const input = sessionInput();
    expect(input.token.length + "token".length).toBeLessThan(500);
    expect(validateLiveSession(input)).toMatchObject({ callSid, internalTest: false });
    expect(() => validateLiveSession({ ...input, callSid: otherCallSid })).toThrow();
    expect(() => validateLiveSession({ ...input, accountSid: `AC${"b".repeat(32)}` })).toThrow();
    expect(() => validateLiveSession({ ...input, twilioSignature: "" })).toThrow();
    expect(() => validateLiveSession({ ...input, twilioSignature: "forged-signature" })).toThrow();
  });

  it("supports provider signatures for the exact HTTPS upgrade or configured WSS URL", () => {
    const input = sessionInput();
    expect(validateLiveSession({ ...input, streamUrl: streamHttps, twilioSignature: signature(streamHttps) }).callSid).toBe(callSid);
    expect(validateLiveSession({ ...input, twilioSignature: signature(stream) }).callSid).toBe(callSid);
  });

  it.each([
    "wss://attacker.example/stream", `${stream}?other=1`, `${stream}/other`,
    "ws://le-yard-reception.donaldlena833.workers.dev/stream", `${stream}#fragment`,
    "https://le-yard-reception.donaldlena833.workers.dev.attacker.example/stream",
  ])("rejects any nonmatching stream origin or path: %s", (streamUrl) => {
    expect(() => validateLiveSession({ ...sessionInput(), streamUrl })).toThrow();
  });

  it("allows signature omission only for an authenticated internal capability", () => {
    expect(validateLiveSession(sessionInput(true))).toMatchObject({ internalTest: true });
    expect(() => liveSessionInputSchema.parse({ ...sessionInput(), internalTest: true })).toThrow();
    const input = sessionInput();
    const index = Math.floor(input.token.length / 2);
    const token = input.token.slice(0, index) + (input.token[index] === "A" ? "B" : "A") + input.token.slice(index + 1);
    expect(() => validateLiveSession({ ...input, token, twilioSignature: "" })).toThrow();
    expect(() => validateLiveSession({ ...sessionInput(true), streamUrl: "wss://attacker.example/stream" })).toThrow();
  });

  it("rejects expired and conversation-bearing capabilities", () => {
    const input = sessionInput();
    const state = openVoiceState(input.token, callSid);
    expect(() => validateLiveSession({ ...input, token: sealVoiceState({ ...state, turn: 1 }) })).toThrow();
    expect(() => validateLiveSession({ ...input, token: sealVoiceState({ ...state, history: [{ role: "user", text: "Not a new live call" }] }) })).toThrow();
    vi.setSystemTime(state.expiresAt + 1);
    expect(() => validateLiveSession(input)).toThrow();
  });

  it.each(["https://example.test/stream", "wss://example.test/stream?token=secret", "wss://user:pass@example.test/stream", "wss://example.test/other"])(
    "rejects unsafe configured stream URLs: %s", (url) => {
      vi.stubEnv("VOICE_LIVE_STREAM_URL", url);
      expect(() => liveStreamUrl()).toThrow();
    },
  );
});

describe("live incoming TwiML", () => {
  it("uses a bidirectional stream with a short encrypted parameter and no Gather or recorded introduction", () => {
    const state = { ...createVoiceState(callSid), internalTest: true };
    const xml = buildLiveVoiceConnect(state);
    expect(xml).toMatch(/<Connect><Stream\b/);
    expect(xml).toContain(`url="${stream}"`);
    expect(xml).not.toMatch(/<(?:Gather|Say|Play|Dial|Record)\b/);
    const token = xml.match(/<Parameter name="token" value="([^"]+)"/)?.[1];
    expect(token).toBeTruthy();
    expect(token!.length + "token".length).toBeLessThan(500);
    expect(openVoiceState(token!, callSid)).toEqual(state);
    expect(xml).toContain("/api/twilio/voice/live/fallback?state=");
    expect(xml).not.toContain("I'm the AI");
  });

  it("refuses a stream capability that exceeds the provider custom-parameter limit", () => {
    const state = { ...createVoiceState(callSid), history: [{ role: "user" as const, text: "x".repeat(450) }] };
    expect(() => buildLiveVoiceConnect(state)).toThrow("live_voice_token_too_large");
  });

  it("answers synthetic live calls without logging guest events or touching Twilio REST", async () => {
    const response = await incomingRoute(formRequest("/api/twilio/voice/incoming", { InternalTest: "true", VoiceEngine: "live" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("<Connect><Stream");
    expect(xml).not.toContain("<Gather");
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.calls).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects unsigned incoming calls and prevents a failed diagnostic from falling through to dialing", async () => {
    mocks.validate.mockReturnValue(false);
    expect((await incomingRoute(formRequest("/api/twilio/voice/incoming"))).status).toBe(403);
    mocks.validate.mockReturnValue(true);
    vi.stubEnv("VOICE_LIVE_STREAM_URL", "");
    const response = await incomingRoute(formRequest("/api/twilio/voice/incoming", { InternalTest: "true", VoiceEngine: "live" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/<(?:Dial|Number|Record)\b/);
    expect(mocks.calls).not.toHaveBeenCalled();
  });
});

describe("ephemeral provider session boundary", () => {
  it("locks model, voice, short endpointing, and interruptible audio into a single-use session", async () => {
    const result = await createLiveVoiceSession();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, request] = mocks.fetch.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    expect(url).not.toContain(geminiKey);
    expect(request.headers["x-goog-api-key"]).toBe(geminiKey);
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.cache).toBe("no-store");
    const body = JSON.parse(request.body);
    expect(body.uses).toBe(1);
    expect(Date.parse(body.newSessionExpireTime) - Date.now()).toBeLessThanOrEqual(60_000);
    expect(Date.parse(body.expireTime) - Date.now()).toBeLessThanOrEqual(20 * 60_000);
    expect(body.bidiGenerateContentSetup).toEqual(liveVoiceSetup());
    expect(body.bidiGenerateContentSetup.model).toBe(`models/${LIVE_VOICE_MODEL}`);
    expect(body.bidiGenerateContentSetup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.bidiGenerateContentSetup.realtimeInputConfig.activityHandling).toBe("START_OF_ACTIVITY_INTERRUPTS");
    expect(body.bidiGenerateContentSetup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBeLessThanOrEqual(500);
    const functions = body.bidiGenerateContentSetup.tools[0].functionDeclarations;
    expect(functions.map((f: { name: string }) => f.name)).toEqual(["transfer_to_team", "take_voicemail", "end_call"]);
    expect(functions.every((f: { parameters: { properties: object } }) => Object.keys(f.parameters.properties).length === 0)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(geminiKey);
    expect(result.headers.Authorization).toBe("Token auth_tokens/synthetic-once-only");
    const prompt = result.setup.systemInstruction.parts[0].text;
    expect(prompt).toContain('Open once: “Thanks for calling Le Yard. How can I help?”');
    expect(prompt).toMatch(/If asked.+answer honestly/);
  });

  it("returns only the constrained ephemeral connection after successful session verification", async () => {
    const response = await sessionRoute(jsonRequest("/api/twilio/voice/live/session", sessionInput(true)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(geminiKey);
    expect(JSON.parse(text)).toMatchObject({ callSid, internalTest: true, gemini: { headers: { Authorization: "Token auth_tokens/synthetic-once-only" } } });
    expect(mocks.calls).not.toHaveBeenCalled();
  });

  it.each([
    { token: "bad" }, { model: "models/unrestricted-model" }, { destination: "+12125550999" }, { extra: "x".repeat(2100) },
  ])("rejects malformed, oversized, or expanded session input before provider use", async (override) => {
    const response = await sessionRoute(jsonRequest("/api/twilio/voice/live/session", { ...sessionInput(), ...override }));
    expect(response.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and unauthenticated sessions", async () => {
    const malformed = new Request(`${base}/api/twilio/voice/live/session`, { method: "POST", body: "{" });
    expect((await sessionRoute(malformed)).status).toBe(400);
    expect((await sessionRoute(jsonRequest("/api/twilio/voice/live/session", { ...sessionInput(), twilioSignature: "" }))).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("sanitizes upstream failures and refuses a response without a valid ephemeral token", async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: "secret provider diagnostic" }, { status: 429 }));
    const failed = await sessionRoute(jsonRequest("/api/twilio/voice/live/session", sessionInput(true)));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("secret provider diagnostic");
    mocks.fetch.mockResolvedValueOnce(Response.json({ name: "not-an-auth-token" }));
    await expect(createLiveVoiceSession()).rejects.toThrow("invalid_live_token");
  });
});

describe("live tool actions stay on the authorized incoming call", () => {
  it.each(["handoff", "voicemail", "end"])("suppresses every internal %s action before Twilio REST", async (action) => {
    const response = await actionRoute(jsonRequest("/api/twilio/voice/live/action", { token: capability(true), callSid, action }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, action, suppressed: true });
    expect(mocks.calls).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { action: "dial" }, { destination: "+12125550999" }, { to: "+12125550999" }, { token: "invalid" }, { extra: "x".repeat(1300) },
  ])("rejects unsupported actions and extra destination data", async (override) => {
    const response = await actionRoute(jsonRequest("/api/twilio/voice/live/action", { token: capability(), callSid, action: "handoff", ...override }));
    expect(response.status).toBe(400);
    expect(mocks.calls).not.toHaveBeenCalled();
  });

  it("rejects mismatched or expired call capabilities before looking up a provider call", async () => {
    const token = capability();
    expect((await actionRoute(jsonRequest("/api/twilio/voice/live/action", { token, callSid: otherCallSid, action: "handoff" }))).status).toBe(403);
    vi.setSystemTime(Date.now() + 21 * 60_000);
    expect((await actionRoute(jsonRequest("/api/twilio/voice/live/action", { token, callSid, action: "handoff" }))).status).toBe(403);
    expect(mocks.calls).not.toHaveBeenCalled();
  });

  it.each([
    { status: "completed" }, { status: "ringing" }, { direction: "outbound-api" }, { to: "+12125550999" },
  ])("blocks a live action unless the call is inbound, active, and addressed to Le Yard", async (override) => {
    mocks.callFetch.mockResolvedValue({ status: "in-progress", direction: "inbound", to: businessNumber, ...override });
    const response = await actionRoute(jsonRequest("/api/twilio/voice/live/action", { token: capability(), callSid, action: "handoff" }));
    expect(response.status).toBe(409);
    expect(mocks.calls).toHaveBeenCalledWith(callSid);
    expect(mocks.callUpdate).not.toHaveBeenCalled();
  });

  it.each(["handoff", "voicemail", "end"])("updates only the authenticated active incoming call for %s", async (action) => {
    const response = await actionRoute(jsonRequest("/api/twilio/voice/live/action", { token: capability(), callSid, action }));
    expect(response.status).toBe(200);
    expect(mocks.calls).toHaveBeenCalledWith(callSid);
    expect(mocks.callFetch).toHaveBeenCalledOnce();
    expect(mocks.callUpdate).toHaveBeenCalledOnce();
    const xml = mocks.callUpdate.mock.calls[0][0].twiml;
    if (action === "handoff") {
      expect(xml.match(/<Dial\b/g)).toHaveLength(1);
      expect(xml.match(/<Number\b/g)).toHaveLength(2);
      expect(xml).toContain("/voice/screen?staff=donald");
      expect(xml).toContain("/voice/screen?staff=maris");
    } else if (action === "voicemail") expect(xml).toContain("<Record");
    else {
      expect(xml).toContain("<Hangup/>");
      expect(xml).not.toMatch(/<(?:Dial|Record)\b/);
    }
  });
});

describe("live fallback and exact public routes", () => {
  it("requires the signed provider callback and matching call binding for fallback", async () => {
    const path = `/api/twilio/voice/live/fallback?state=${capability(true)}`;
    mocks.validate.mockReturnValue(false);
    expect((await fallbackRoute(formRequest(path))).status).toBe(403);
    mocks.validate.mockReturnValue(true);
    expect((await fallbackRoute(formRequest(path, { To: "+12125550999" }))).status).toBe(403);
    expect((await fallbackRoute(formRequest(path, { CallSid: otherCallSid }))).status).toBe(403);
    const response = await fallbackRoute(formRequest(path));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toMatch(/<(?:Dial|Number|Record)\b/);
    expect(mocks.calls).not.toHaveBeenCalled();
  });

  it("exposes only the exact provider-authenticated live handlers", () => {
    for (const path of ["session", "action", "fallback"]) {
      expect(isPublicRequestPath(`/api/twilio/voice/live/${path}`)).toBe(true);
      expect(isPublicRequestPath(`/api/twilio/voice/live/${path}/extra`)).toBe(false);
    }
    for (const path of ["/api/twilio/voice/live", "/api/twilio/voice/live/admin", "/api/twilio/voice/outbound", "/api/twilio/private"])
      expect(isPublicRequestPath(path)).toBe(false);
  });
});
