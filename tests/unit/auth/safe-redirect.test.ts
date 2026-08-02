import { describe, expect, it } from "vitest";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";

describe("safeInternalRedirect", () => {
  it.each([
    ["/today", "/today"],
    ["/reports?kind=tips#summary", "/reports?kind=tips#summary"],
    ["/guests/../today", "/today"],
  ])("keeps an internal application path %s", (value, expected) => {
    expect(safeInternalRedirect(value)).toBe(expected);
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "///evil.example/phish",
    "/\\evil.example/phish",
    "\\\\evil.example/phish",
    "/%5cevil.example/phish",
    "/%255cevil.example/phish",
    "/%2f%2fevil.example/phish",
    "/%252f%252fevil.example/phish",
    "/foo/%2e%2e//evil.example/phish",
    "/foo/..//evil.example/phish",
    "/today\nSet-Cookie: session=stolen",
    "/today%0d%0aLocation:%20https://evil.example",
    "javascript:alert(1)",
    " today",
    "%2Ftoday",
    "%not-valid",
  ])("rejects unsafe redirect input %s", (value) => {
    expect(safeInternalRedirect(value)).toBe("/today");
  });

  it("uses the caller's fixed fallback for missing input", () => {
    expect(safeInternalRedirect(null, "/sign-in")).toBe("/sign-in");
  });
});
