import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/communications.server", () => ({
  findGuestByPhone: vi.fn(async () => null),
  logCommunicationEvent: vi.fn(async () => undefined),
}));
vi.mock("@/lib/elevenlabs.server", () => ({
  elevenLabsConfigured: () => false,
  registerElevenLabsTwilioCall: vi.fn(),
}));
vi.mock("@/lib/twilio.server", () => ({
  readTwilioForm: async (request: Request) => ({ params: new URLSearchParams(await request.text()) }),
  validateTwilioRequest: () => true,
  twilioForwardNumbers: () => ({ donald: "+12025550101", maris: "+12025550102" }),
  twilioPhoneNumber: () => "+13328779035",
  twilioAbsoluteUrl: (path: string) => `https://operations.leyardny.com${path}`,
  xmlResponse: (xml: string) => new Response(xml, { headers: { "content-type": "text/xml" } }),
}));

import { POST } from "@/app/api/twilio/voice/incoming/route";

const request = () =>
  new Request("https://operations.leyardny.com/api/twilio/voice/incoming", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "From=%2B12025550100&To=%2B13328779035&CallSid=CA0123456789abcdef0123456789abcdef",
  });

afterEach(() => vi.unstubAllEnvs());

describe("inbound founder ring group", () => {
  it("welcomes the caller before ringing both founders in parallel", async () => {
    const xml = await (await POST(request())).text();
    expect(xml).toContain("Thank you for calling Le Yard");
    expect(xml).toContain('voice="Polly.Joanna"');
    expect(xml.indexOf("<Say")).toBeLessThan(xml.indexOf("<Dial"));
    expect(xml).toContain("+12025550101</Number>");
    expect(xml).toContain("+12025550102</Number>");
    expect(xml.match(/<Dial/g)).toHaveLength(1);
    expect(xml).toContain('answerOnBridge="true"');
  });

  it("plays a configured Fish Audio greeting before the same ring group", async () => {
    vi.stubEnv("TWILIO_RECEPTION_AUDIO_URL", "https://operations.leyardny.com/audio/le-yard-reception.mp3");
    const xml = await (await POST(request())).text();
    expect(xml).toContain("<Play>https://operations.leyardny.com/audio/le-yard-reception.mp3</Play>");
    expect(xml.indexOf("<Play")).toBeLessThan(xml.indexOf("<Dial"));
    expect(xml.match(/<Number/g)).toHaveLength(2);
  });

  it("refuses an unsafe audio URL and falls back to Twilio speech", async () => {
    vi.stubEnv("TWILIO_RECEPTION_AUDIO_URL", "http://127.0.0.1/private.mp3");
    const xml = await (await POST(request())).text();
    expect(xml).toContain("<Say");
    expect(xml).not.toContain("<Play>");
  });
});
