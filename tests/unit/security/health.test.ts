import { describe, expect, it } from "vitest";
import { buildHealthState } from "@/lib/security/health";

describe("health state", () => {
  it("returns 503 when runtime readiness is blocked while preserving liveness", () => {
    expect(buildHealthState(false, "2026-08-01T12:00:00.000Z")).toEqual({
      statusCode: 503,
      body: {
        status: "not_ready",
        liveness: "ok",
        readiness: "blocked",
        checkedAt: "2026-08-01T12:00:00.000Z",
      },
    });
  });

  it("returns only generic readiness fields when configuration is valid", () => {
    const health = buildHealthState(true, "2026-08-01T12:00:00.000Z");
    expect(health.statusCode).toBe(200);
    expect(health.body).toEqual({
      status: "ready",
      liveness: "ok",
      readiness: "ok",
      checkedAt: "2026-08-01T12:00:00.000Z",
    });
    expect(JSON.stringify(health.body)).not.toMatch(/database|model|key|supabase/i);
  });
});
