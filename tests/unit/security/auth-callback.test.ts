import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "demo" as "demo" | "connected",
  exchangeCodeForSession: vi.fn(),
}));
const createClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  publicEnv: { NEXT_PUBLIC_APP_URL: "https://preview.example.com" },
}));

vi.mock("@/lib/env.server", () => ({
  getServerRuntimeConfiguration: () => ({
    mode: state.mode,
    ready: true,
    appUrl: "https://preview.example.com",
    playground: state.mode === "demo",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient }));

import { GET } from "@/app/auth/callback/route";

describe("authentication callback boundary", () => {
  beforeEach(() => {
    state.mode = "demo";
    state.exchangeCodeForSession.mockReset();
    state.exchangeCodeForSession.mockResolvedValue({ error: null });
    createClient.mockReset();
    createClient.mockResolvedValue({
      auth: { exchangeCodeForSession: state.exchangeCodeForSession },
    });
  });

  it("never contacts Supabase for a playground callback", async () => {
    const response = await GET(
      new Request(
        "https://preview.example.com/auth/callback?code=untrusted&next=%2Freports",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://preview.example.com/sign-in",
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it("keeps the connected provider exchange available", async () => {
    state.mode = "connected";
    const response = await GET(
      new Request(
        "https://preview.example.com/auth/callback?code=provider-code&next=%2Freports",
      ),
    );

    expect(state.exchangeCodeForSession).toHaveBeenCalledWith("provider-code");
    expect(response.headers.get("location")).toBe(
      "https://preview.example.com/reports",
    );
    expect(
      response.cookies.get("__Host-le-yard-session-deadline")?.value,
    ).toMatch(/^\d{10}$/);
  });
});
