import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  log: vi.fn(),
  guest: vi.fn(),
  generate: vi.fn(),
  publish: vi.fn(),
  elevenConfigured: vi.fn(),
  elevenRegister: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/twilio.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/twilio.server")>(),
  validateTwilioRequest: mocks.validate,
}));
vi.mock("@/lib/voice-ai.server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/voice-ai.server")>(),
  generateVoiceReply: mocks.generate,
}));
vi.mock("@/lib/communications.server", () => ({
  logCommunicationEvent: mocks.log,
  findGuestByPhone: mocks.guest,
}));
vi.mock("@/lib/fish-voice.server", () => ({ publishReceptionSpeech: mocks.publish }));
vi.mock("@/lib/elevenlabs.server", () => ({
  elevenLabsConfigured: mocks.elevenConfigured,
  registerElevenLabsTwilioCall: mocks.elevenRegister,
}));

import { POST as incoming } from "@/app/api/twilio/voice/incoming/route";
import { POST as turn } from "@/app/api/twilio/voice/ai/turn/route";
import { createVoiceState, openVoiceState, sealVoiceState } from "@/lib/voice-ai.server";

const base = "https://phone.example.test";
const callSid = `CA${"1".repeat(32)}`;
const otherCallSid = `CA${"2".repeat(32)}`;
const businessNumber = "+12125550100";
const firstFounder = "+12125550101";
const secondFounder = "+12125550102";
const greetingReply = { text: "Happy to help. What would you like to know?", action: "continue" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-09T02:30:00.000Z"));
  vi.stubEnv("VOICE_AI_STATE_SECRET", "synthetic-voice-route-secret-".repeat(3));
  vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-not-live");
  vi.stubEnv("TWILIO_INBOUND_MODE", "fish-gemini");
  vi.stubEnv("TWILIO_PUBLIC_BASE_URL", base);
  vi.stubEnv("TWILIO_FROM_NUMBER", businessNumber);
  vi.stubEnv("TWILIO_PHONE_NUMBER", businessNumber);
  vi.stubEnv("TWILIO_FORWARD_DONALD", firstFounder);
  vi.stubEnv("TWILIO_FORWARD_MARIS", secondFounder);
  vi.stubEnv("TWILIO_SMS_ENABLED", "false");
  vi.stubGlobal("fetch", mocks.fetch);
  vi.resetAllMocks();
  mocks.validate.mockReturnValue(true);
  mocks.log.mockResolvedValue(undefined);
  mocks.guest.mockResolvedValue(null);
  mocks.generate.mockResolvedValue(greetingReply);
  mocks.publish.mockResolvedValue(`${base}/audio/synthetic-reply.wav`);
  mocks.elevenConfigured.mockReturnValue(false);
  mocks.fetch.mockRejectedValue(new Error("A unit test must never make a network request"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(path: string, overrides: Record<string, string | undefined> = {}) {
  const fields: Record<string, string | undefined> = {
    CallSid: callSid,
    From: "+12125550103",
    To: businessNumber,
    Timestamp: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
  return new Request(path.startsWith("https:") ? path : `${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "synthetic-mocked-signature" },
    body: new URLSearchParams(Object.entries(fields).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  });
}

function callback(xml: string) {
  const action = xml.match(/<Gather\b[^>]*action="([^"]+)"/)?.[1];
  expect(action).toBeTruthy();
  return action!.replaceAll("&amp;", "&");
}

function stateUrl(internalTest = true) {
  return `${base}/api/twilio/voice/ai/turn?state=${sealVoiceState({ ...createVoiceState(callSid), internalTest })}`;
}

function expectNoExternalEffects(xml: string) {
  expect(xml).not.toMatch(/<(?:Dial|Number|Client|Record|Redirect)\b/);
  expect(mocks.log).not.toHaveBeenCalled();
  expect(mocks.guest).not.toHaveBeenCalled();
  expect(mocks.elevenRegister).not.toHaveBeenCalled();
  expect(mocks.fetch).not.toHaveBeenCalled();
}

describe("incoming AI call boundary", () => {
  it("rejects requests whose signature validation fails before any work", async () => {
    mocks.validate.mockReturnValue(false);
    const response = await incoming(request("/api/twilio/voice/incoming", { InternalTest: "true" }));
    expect(response.status).toBe(403);
    expectNoExternalEffects(await response.text());
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it.each([
    { To: "+12125550999" },
    { CallSid: "not-a-call-sid" },
    { CallSid: "" },
  ])("rejects another destination or a malformed call identifier", async (fields) => {
    const response = await incoming(request("/api/twilio/voice/incoming", { InternalTest: "true", ...fields }));
    expect(response.status).toBe(403);
    expectNoExternalEffects(await response.text());
  });

  it.each([undefined, "", "not-a-number", "1", "9999999999999", "1788911400.5"])(
    "rejects absent, invalid, or expired internal-test timestamps without ringing",
    async (Timestamp) => {
      const response = await incoming(request("/api/twilio/voice/incoming", { InternalTest: "true", Timestamp }));
      expect(response.status).toBe(400);
      expectNoExternalEffects(await response.text());
    },
  );

  it("starts an authenticated synthetic session with the test flag sealed into its callback", async () => {
    const response = await incoming(request("/api/twilio/voice/incoming", { InternalTest: "true" }));
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toContain("<Gather");
    expect(xml).toContain('bargeIn="true"');
    expect(xml).toContain("/audio/le-yard-ai-welcome.wav");
    const token = new URL(callback(xml)).searchParams.get("state")!;
    expect(openVoiceState(token, callSid)).toMatchObject({ callSid, internalTest: true, turn: 0 });
    expectNoExternalEffects(xml);
  });

  it("returns unavailable if a diagnostic lacks AI configuration instead of falling through to founders", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const response = await incoming(request("/api/twilio/voice/incoming", { InternalTest: "true" }));
    expect(response.status).toBe(503);
    expectNoExternalEffects(await response.text());
  });

  it("answers an ordinary incoming caller with AI and records only the operational event", async () => {
    const response = await incoming(request("/api/twilio/voice/incoming"));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("<Gather");
    expect(xml).not.toContain("<Dial");
    const token = new URL(callback(xml)).searchParams.get("state")!;
    expect(openVoiceState(token, callSid).internalTest).toBe(false);
    expect(mocks.log).toHaveBeenCalledOnce();
    expect(mocks.log.mock.calls[0][0].eventType).toBe("voice.inbound");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("still answers an ordinary call when event logging is unavailable", async () => {
    mocks.log.mockRejectedValue(new Error("synthetic database outage"));
    const response = await incoming(request("/api/twilio/voice/incoming"));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("<Gather");
    expect(xml).not.toContain("synthetic database outage");
    expect(mocks.log).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("AI conversation turn boundary", () => {
  it("rejects invalid signatures, wrong destinations, and state from another call", async () => {
    const url = stateUrl();
    mocks.validate.mockReturnValue(false);
    expect((await turn(request(url, { SpeechResult: "Hello" }))).status).toBe(403);
    mocks.validate.mockReturnValue(true);
    expect((await turn(request(url, { SpeechResult: "Hello", To: "+12125550999" }))).status).toBe(403);
    expect((await turn(request(url, { SpeechResult: "Hello", CallSid: otherCallSid }))).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expectNoExternalEffects("");
  });

  it("rejects expired and altered tokens before generation or a founder handoff", async () => {
    const state = { ...createVoiceState(callSid), internalTest: true };
    const token = sealVoiceState(state);
    const altered = `${token.slice(0, 40)}${token[40] === "A" ? "B" : "A"}${token.slice(41)}`;
    expect((await turn(request(`/api/twilio/voice/ai/turn?state=${altered}`, { Digits: "0" }))).status).toBe(403);
    vi.setSystemTime(state.expiresAt + 1);
    expect((await turn(request(`/api/twilio/voice/ai/turn?state=${token}`, { Digits: "0" }))).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
    expectNoExternalEffects("");
  });

  it.each(["handoff", "voicemail", "end"])(
    "keeps a complete synthetic incoming-to-%s exchange isolated",
    async (action) => {
      const greeting = await incoming(request("/api/twilio/voice/incoming", { InternalTest: "true" }));
      const firstUrl = callback(await greeting.text());
      const conversational = await turn(request(firstUrl, { SpeechResult: "Where are you?" }));
      const conversationalXml = await conversational.text();
      expect(conversationalXml).toContain("<Gather");
      const nextUrl = callback(conversationalXml);
      expect(openVoiceState(new URL(nextUrl).searchParams.get("state")!, callSid)).toMatchObject({ internalTest: true, turn: 1 });
      mocks.generate.mockResolvedValue({ text: "Of course. This is the end of the synthetic test.", action });
      const terminal = await turn(request(nextUrl, { SpeechResult: "Please finish the test." }));
      const xml = await terminal.text();
      expect(terminal.status).toBe(200);
      expect(xml).toContain("<Hangup/>");
      expectNoExternalEffects(xml);
    },
  );

  it("makes zero an immediate isolated handoff without waiting for the language model", async () => {
    const response = await turn(request(stateUrl(), { Digits: "0" }));
    const xml = await response.text();
    expect(xml).toContain("<Hangup/>");
    expect(mocks.generate).not.toHaveBeenCalled();
    expectNoExternalEffects(xml);
  });

  it("places both configured screened destinations in the same Dial for a normal zero shortcut", async () => {
    const response = await turn(request(stateUrl(false), { Digits: "0" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml.match(/<Dial\b/g)).toHaveLength(1);
    expect(xml.match(/<Number\b/g)).toHaveLength(2);
    const dial = xml.match(/<Dial\b[^>]*>[\s\S]*?<\/Dial>/)?.[0] ?? "";
    expect(dial).toContain(firstFounder);
    expect(dial).toContain(secondFounder);
    expect(dial).toContain("/api/twilio/voice/screen?staff=donald");
    expect(dial).toContain("/api/twilio/voice/screen?staff=maris");
    expect(dial).toContain('answerOnBridge="true"');
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("checks once after silence and then ends without an infinite gather loop", async () => {
    const first = await turn(request(stateUrl()));
    const firstXml = await first.text();
    expect(firstXml).toContain("<Gather");
    const next = callback(firstXml);
    expect(openVoiceState(new URL(next).searchParams.get("state")!, callSid).silences).toBe(1);
    const second = await turn(request(next));
    const secondXml = await second.text();
    expect(secondXml).toContain("<Hangup/>");
    expect(secondXml).not.toContain("<Gather");
    expect(mocks.generate).not.toHaveBeenCalled();
    expectNoExternalEffects(secondXml);
  });

  it("resets the silence counter when the caller resumes speaking", async () => {
    const first = await turn(request(stateUrl()));
    const response = await turn(request(callback(await first.text()), { SpeechResult: "Sorry, I'm here." }));
    const next = callback(await response.text());
    expect(openVoiceState(new URL(next).searchParams.get("state")!, callSid).silences).toBe(0);
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it("offers a fallback after one model failure and exits toward voicemail after a second", async () => {
    mocks.generate.mockRejectedValue(new Error("synthetic provider failure"));
    const first = await turn(request(stateUrl(), { SpeechResult: "Hello" }));
    const firstXml = await first.text();
    expect(firstXml).toContain("<Gather");
    expect(mocks.publish.mock.calls[0][0]).toMatch(/trouble connecting/i);
    const second = await turn(request(callback(firstXml), { SpeechResult: "Try again please" }));
    const secondXml = await second.text();
    expect(mocks.publish.mock.calls[1][0]).toMatch(/leave.+message.+tone/i);
    expect(secondXml).toContain("<Hangup/>");
    expect(secondXml).not.toContain("<Gather");
    expectNoExternalEffects(secondXml);
  });

  it("honors an explicit voicemail request even if Gemini is down", async () => {
    mocks.generate.mockRejectedValue(new Error("synthetic provider failure"));
    const response = await turn(request(stateUrl(), { SpeechResult: "voicemail" }));
    const xml = await response.text();
    expect(xml).toContain("<Hangup/>");
    expect(mocks.publish.mock.calls[0][0]).toMatch(/leave your name and request after the tone/i);
    expectNoExternalEffects(xml);
  });

  it("keeps a spoken Polly fallback when Fish cannot produce audio", async () => {
    mocks.publish.mockRejectedValue(new Error("synthetic Fish unavailable"));
    const response = await turn(request(stateUrl(), { SpeechResult: "Hello" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain('<Say voice="Polly.Joanna"');
    expect(xml).toContain(greetingReply.text);
    expect(xml).not.toContain("<Play");
    expectNoExternalEffects(xml);
  });

  it("returns the successful AI answer even when operational event logging fails", async () => {
    mocks.log.mockRejectedValue(new Error("synthetic database outage"));
    const response = await turn(request(stateUrl(false), { SpeechResult: "Hello" }));
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain("<Gather");
    expect(xml).toContain("synthetic-reply.wav");
    expect(xml).not.toContain("synthetic database outage");
    expect(mocks.log).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("reaches the turn limit without making another Gemini request", async () => {
    const token = sealVoiceState({ ...createVoiceState(callSid), internalTest: true, turn: 12 });
    const response = await turn(request(`/api/twilio/voice/ai/turn?state=${token}`, { SpeechResult: "One more thing" }));
    const xml = await response.text();
    expect(xml).toContain("<Hangup/>");
    expect(mocks.generate).not.toHaveBeenCalled();
    expectNoExternalEffects(xml);
  });
});
