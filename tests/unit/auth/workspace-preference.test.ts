import { describe, expect, it } from "vitest";
import {
  decodeWorkspacePreference,
  encodeWorkspacePreference,
} from "@/lib/auth/workspace-preference";

describe("workspace preference codec", () => {
  it("round-trips the authenticated selector fields", () => {
    const preference = {
      userId: "10000000-0000-4000-8000-000000000001",
      organizationId: "20000000-0000-4000-8000-000000000001",
      locationId: "30000000-0000-4000-8000-000000000001",
    };
    expect(decodeWorkspacePreference(encodeWorkspacePreference(preference))).toEqual(
      preference,
    );
  });

  it("rejects malformed, unknown-version, and oversized values", () => {
    expect(decodeWorkspacePreference(undefined)).toBeNull();
    expect(decodeWorkspacePreference("v2:user:org:location")).toBeNull();
    expect(decodeWorkspacePreference("v1:user:org")).toBeNull();
    expect(decodeWorkspacePreference("v1:user:org:location:extra")).toBeNull();
    expect(decodeWorkspacePreference(`v1:${"a".repeat(1_100)}:org:location`)).toBeNull();
    expect(decodeWorkspacePreference("v1:%E0%A4%A:org:location")).toBeNull();
  });

  it("does not ascribe trust to the encoded identifiers", () => {
    expect(
      decodeWorkspacePreference(
        encodeWorkspacePreference({
          userId: "browser-supplied-user",
          organizationId: "browser-supplied-org",
          locationId: "browser-supplied-location",
        }),
      ),
    ).toEqual({
      userId: "browser-supplied-user",
      organizationId: "browser-supplied-org",
      locationId: "browser-supplied-location",
    });
  });
});
