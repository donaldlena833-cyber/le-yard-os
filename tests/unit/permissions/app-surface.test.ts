import { describe, expect, it } from "vitest";
import { resolveAppSurface } from "@/lib/app-surface";

describe("application surface selection", () => {
  it("defaults to the complete operations system", () => {
    expect(resolveAppSurface(undefined)).toBe("operations");
    expect(resolveAppSurface("unexpected")).toBe("operations");
  });

  it("accepts the dedicated host deployment mode", () => {
    expect(resolveAppSurface("host")).toBe("host");
    expect(resolveAppSurface(" HOST ")).toBe("host");
  });
});
