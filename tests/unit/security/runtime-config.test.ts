import { describe, expect, it } from "vitest";
import {
  assessPublicRuntimeConfiguration,
  assessServerRuntimeConfiguration,
  enableValidatedPlayground,
} from "@/lib/env";

describe("runtime configuration", () => {
  it("does not silently default a production deployment to demo mode or localhost", () => {
    const configuration = assessPublicRuntimeConfiguration({
      NODE_ENV: "production",
    });

    expect(configuration.ready).toBe(false);
    expect(configuration.mode).toBe("invalid");
    expect(configuration.issues).toEqual(
      expect.arrayContaining(["demo_mode_missing", "app_url_missing"]),
    );
  });

  it("rejects demo mode in production even when it was explicitly copied", () => {
    const configuration = assessServerRuntimeConfiguration(
      assessPublicRuntimeConfiguration({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_DEMO_MODE: "true",
      }),
      undefined,
    );

    expect(configuration.ready).toBe(false);
    expect(configuration.mode).toBe("demo");
    expect(configuration.issues).toContain("production_demo_mode_forbidden");
  });

  it("allows production-built demo data only after preview auth is separately validated", () => {
    const base = assessServerRuntimeConfiguration(
      assessPublicRuntimeConfiguration({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://le-yard-os-preview.example.com",
        NEXT_PUBLIC_DEMO_MODE: "true",
      }),
      undefined,
    );
    const incomplete = enableValidatedPlayground(base, false);
    const preview = enableValidatedPlayground(base, true);

    expect(incomplete.ready).toBe(false);
    expect(incomplete.playground).toBe(false);
    expect(preview.ready).toBe(true);
    expect(preview.playground).toBe(true);
    expect(preview.issues).not.toContain("production_demo_mode_forbidden");
  });

  it.each([
    {
      label: "a valid Supabase URL",
      publicValues: { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" },
      secret: undefined,
    },
    {
      label: "even a malformed Supabase URL",
      publicValues: { NEXT_PUBLIC_SUPABASE_URL: "inherited-but-invalid" },
      secret: undefined,
    },
    {
      label: "a publishable key",
      publicValues: {
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      },
      secret: undefined,
    },
    {
      label: "a server secret",
      publicValues: {},
      secret: "server-secret",
    },
  ])("rejects $label in a validated playground", ({ publicValues, secret }) => {
    const base = assessServerRuntimeConfiguration(
      assessPublicRuntimeConfiguration({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://le-yard-os-playground.example.com",
        NEXT_PUBLIC_DEMO_MODE: "true",
        ...publicValues,
      }),
      secret,
    );
    const playground = enableValidatedPlayground(base, true);

    expect(playground.ready).toBe(false);
    expect(playground.issues).toContain(
      "playground_connected_configuration_forbidden",
    );
  });

  it("rejects local or insecure origins for production connected mode", () => {
    const configuration = assessServerRuntimeConfiguration(
      assessPublicRuntimeConfiguration({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_DEMO_MODE: "false",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      }),
      "server-secret",
    );

    expect(configuration.ready).toBe(false);
    expect(configuration.issues).toEqual(
      expect.arrayContaining([
        "app_url_not_production_safe",
        "supabase_url_not_production_safe",
      ]),
    );
  });

  it("requires every Supabase credential in connected mode", () => {
    const publicConfiguration = assessPublicRuntimeConfiguration({
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://ops.leyard.example",
      NEXT_PUBLIC_DEMO_MODE: "false",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    });
    const missingSecret = assessServerRuntimeConfiguration(
      publicConfiguration,
      undefined,
    );
    const complete = assessServerRuntimeConfiguration(
      publicConfiguration,
      "server-secret",
    );

    expect(missingSecret.ready).toBe(false);
    expect(missingSecret.issues).toContain("supabase_secret_key_missing");
    expect(complete.ready).toBe(true);
    expect(complete.mode).toBe("connected");
  });

  it("accepts local connected origins outside production when all values are explicit", () => {
    const configuration = assessServerRuntimeConfiguration(
      assessPublicRuntimeConfiguration({
        NODE_ENV: "development",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_DEMO_MODE: "false",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
      }),
      "server-secret",
    );

    expect(configuration.ready).toBe(true);
  });
});
