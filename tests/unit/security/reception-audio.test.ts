import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

vi.mock("@/lib/supabase/proxy", () => ({ updateSession: vi.fn() }));
import { config } from "@/proxy";

describe("public reception recording", () => {
  it.each(["/audio/le-yard-reception.mp3", "/audio/le-yard-reception.mp3?v=1"])(
    "serves the exact recording without requiring a caller session: %s",
    (url) => expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false),
  );

  it.each(["/audio/private.mp3", "/audio/le-yard-reception.mp3.bak", "/phone", "/api/twilio/voice/outbound"])(
    "retains authentication handling for %s",
    (url) => expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true),
  );
});
