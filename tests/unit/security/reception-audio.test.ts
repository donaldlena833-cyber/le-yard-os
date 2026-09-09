import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn() }));
import { config } from "@/proxy";

describe("public reception recording", () => {
  it.each(["/audio/le-yard-reception.mp3", "/audio/le-yard-reception.mp3?v=1", "/audio/le-yard-reception-v2.wav", "/audio/le-yard-reception-v2.wav?v=2", "/audio/le-yard-ai-welcome.wav"])(
    "serves the exact recording without requiring a caller session: %s",
    (url) => expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false),
  );

  it.each(["/audio/private.mp3", "/audio/private.wav", "/audio/le-yard-reception.mp3.bak", "/audio/le-yard-reception-v2.wav.bak", "/phone", "/api/twilio/voice/outbound"])(
    "retains authentication handling for %s",
    (url) => expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true),
  );
});
