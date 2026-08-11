import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runtime: {
    ready: true,
    mode: "connected" as "connected" | "demo",
    appUrl: "https://ops.example.com" as string | null,
    playground: false,
  },
  claims: null as Record<string, unknown> | null,
  refresh: true,
  playgroundPrincipal: null as "donald" | "maris" | null,
}));

const createServerClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env.server", () => ({
  getServerRuntimeConfiguration: () => state.runtime,
}));

vi.mock("@/lib/env", () => ({
  requireSupabasePublicEnv: () => ({
    url: "https://project.supabase.co",
    publishableKey: "publishable-test-key",
  }),
}));

vi.mock("@/lib/auth/playground-auth.server", () => ({
  PLAYGROUND_SESSION_COOKIE: "__Host-le-yard-playground-session",
  readPlaygroundSessionToken: (token?: string) =>
    token === "valid-playground-token" ? state.playgroundPrincipal : null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient,
}));

import { updateSession } from "@/lib/supabase/proxy";

interface SupabaseCookieAdapter {
  setAll(
    cookies: Array<{
      name: string;
      value: string;
      options: { path: string; httpOnly: boolean; sameSite: "lax" };
    }>,
    headers: Record<string, string>,
  ): void;
}

describe("session proxy", () => {
  beforeEach(() => {
    state.runtime = {
      ready: true,
      mode: "connected",
      appUrl: "https://ops.example.com",
      playground: false,
    };
    state.claims = null;
    state.refresh = true;
    state.playgroundPrincipal = null;
    createServerClient.mockReset();
    createServerClient.mockImplementation(
      (_url: string, _key: string, options: { cookies: SupabaseCookieAdapter }) => ({
        auth: {
          getClaims: async () => {
            if (state.refresh) {
              options.cookies.setAll(
                [
                  {
                    name: "sb-session",
                    value: "refreshed-token",
                    options: { path: "/", httpOnly: true, sameSite: "lax" },
                  },
                ],
                {
                  "Cache-Control":
                    "private, no-cache, no-store, must-revalidate, max-age=0",
                  Expires: "0",
                  Pragma: "no-cache",
                },
              );
            }
            return { data: { claims: state.claims } };
          },
        },
      }),
    );
  });

  it("fails closed when connected runtime configuration is incomplete", async () => {
    state.runtime = {
      ready: false,
      mode: "connected",
      appUrl: null,
      playground: false,
    };

    const blocked = await updateSession(
      new NextRequest("https://ops.example.com/today"),
    );
    expect(blocked.status).toBe(503);
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    expect(createServerClient).not.toHaveBeenCalled();

    const health = await updateSession(
      new NextRequest("https://ops.example.com/api/health"),
    );
    expect(health.status).toBe(200);
  });

  it("preserves refreshed cookies and auth cache headers on a sign-in redirect", async () => {
    const request = new NextRequest(
      "https://ops.example.com/reports?kind=tips&locationId=all",
    );
    const forwarded = new Headers({
      "Content-Security-Policy": "default-src 'self'",
      "x-nonce": "nonce-value",
    });

    const response = await updateSession(request, forwarded);
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe(
      "/reports?kind=tips&locationId=all",
    );
    expect(response.cookies.get("sb-session")?.value).toBe("refreshed-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("keeps refreshed cookies on an authenticated pass-through response", async () => {
    state.claims = { sub: "user-1" };
    const deadline = Math.floor(Date.now() / 1_000) + 60 * 60;
    const response = await updateSession(
      new NextRequest("https://ops.example.com/today", {
        headers: {
          cookie: `sb-session=active-token; __Host-le-yard-session-deadline=${deadline}`,
        },
      }),
      new Headers({ "x-nonce": "nonce-value" }),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get("sb-session")?.value).toBe("refreshed-token");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("expires connected auth cookies when the device session deadline is missing", async () => {
    state.claims = { sub: "user-1" };
    const response = await updateSession(
      new NextRequest("https://ops.example.com/today", {
        headers: { cookie: "sb-project-auth-token=active-token" },
      }),
    );

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/sign-in");
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe("");
  });

  it("does not initialize Supabase in explicit demo mode", async () => {
    state.runtime = {
      ready: true,
      mode: "demo",
      appUrl: "http://localhost:3000",
      playground: false,
    };
    const response = await updateSession(
      new NextRequest("https://ops.example.com/today"),
    );

    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("requires a valid session for every playground document and API", async () => {
    state.runtime = {
      ready: true,
      mode: "demo",
      appUrl: "https://preview.example.com",
      playground: true,
    };

    const documentResponse = await updateSession(
      new NextRequest("https://preview.example.com/reports?kind=tips"),
    );
    const documentLocation = new URL(
      documentResponse.headers.get("location")!,
    );
    expect(documentResponse.status).toBe(307);
    expect(documentLocation.pathname).toBe("/sign-in");
    expect(documentLocation.searchParams.get("next")).toBe(
      "/reports?kind=tips",
    );
    expect(documentResponse.headers.get("x-robots-tag")).toContain("noindex");

    const apiResponse = await updateSession(
      new NextRequest("https://preview.example.com/api/exports/reports"),
    );
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toEqual({
      error: "Authentication is required.",
    });
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("allows public playground routes and an authenticated workspace", async () => {
    state.runtime = {
      ready: true,
      mode: "demo",
      appUrl: "https://preview.example.com",
      playground: true,
    };

    const publicResponse = await updateSession(
      new NextRequest("https://preview.example.com/sign-in"),
    );
    expect(publicResponse.status).toBe(200);

    state.playgroundPrincipal = "maris";
    const authenticatedResponse = await updateSession(
      new NextRequest("https://preview.example.com/today", {
        headers: {
          cookie:
            "__Host-le-yard-playground-session=valid-playground-token",
        },
      }),
    );
    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedResponse.headers.get("cache-control")).toContain(
      "no-store",
    );

    const signInResponse = await updateSession(
      new NextRequest("https://preview.example.com/sign-in", {
        headers: {
          cookie:
            "__Host-le-yard-playground-session=valid-playground-token",
        },
      }),
    );
    expect(signInResponse.status).toBe(307);
    expect(new URL(signInResponse.headers.get("location")!).pathname).toBe(
      "/today",
    );
  });

  it("expires an invalid playground cookie", async () => {
    state.runtime = {
      ready: true,
      mode: "demo",
      appUrl: "https://preview.example.com",
      playground: true,
    };
    const response = await updateSession(
      new NextRequest("https://preview.example.com/sign-in", {
        headers: {
          cookie: "__Host-le-yard-playground-session=tampered",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("canonicalizes playground documents and rejects noncanonical API requests", async () => {
    state.runtime = {
      ready: true,
      mode: "demo",
      appUrl: "https://preview.example.com",
      playground: true,
    };

    const documentResponse = await updateSession(
      new NextRequest("https://generated-deployment.example.com/sign-in?next=%2Freports"),
    );
    expect(documentResponse.status).toBe(307);
    expect(documentResponse.headers.get("location")).toBe(
      "https://preview.example.com/sign-in?next=%2Freports",
    );

    const apiResponse = await updateSession(
      new NextRequest("https://generated-deployment.example.com/api/health"),
    );
    expect(apiResponse.status).toBe(421);
  });
});
