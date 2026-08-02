import { describe, expect, it } from "vitest";
import {
  addGuestNoteInputSchema,
  mergeGuestInputSchema,
  recordGuestConsentInputSchema,
  saveGuestInputSchema,
} from "@/data/guest-schemas";

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  guest: "33333333-3333-4333-8333-333333333333",
  targetGuest: "55555555-5555-4555-8555-555555555555",
  location: "44444444-4444-4444-8444-444444444444",
};

describe("guest workflow schemas", () => {
  it("accepts a bounded human-authored guest profile", () => {
    expect(
      saveGuestInputSchema.safeParse({
        requestId: ids.request,
        organizationId: ids.organization,
        guestId: null,
        firstName: "Avery",
        lastName: "Guest",
        displayName: "Avery Guest",
        email: "avery@example.com",
        phone: "+1 212 555 0100",
        birthday: "1990-08-14",
        vip: false,
        preferences: "Corner table",
        allergies: "Peanut",
        notes: null,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed email and missing display name", () => {
    const parsed = saveGuestInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      displayName: "",
      email: "not-an-email",
      vip: false,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires a real hospitality note", () => {
    expect(
      addGuestNoteInputSchema.safeParse({
        requestId: ids.request,
        organizationId: ids.organization,
        guestId: ids.guest,
        locationId: ids.location,
        note: "   ",
        sensitive: false,
      }).success,
    ).toBe(false);
  });

  it("allows only appendable granted or revoked consent events", () => {
    const base = {
      requestId: ids.request,
      organizationId: ids.organization,
      guestId: ids.guest,
      channel: "email",
      evidenceNote: "Confirmed in person",
    };
    expect(recordGuestConsentInputSchema.safeParse({ ...base, status: "granted" }).success).toBe(true);
    expect(recordGuestConsentInputSchema.safeParse({ ...base, status: "unknown" }).success).toBe(false);
  });

  it("requires an explicit source and different target for a guest merge", () => {
    const valid = {
      requestId: ids.request,
      organizationId: ids.organization,
      sourceGuestId: ids.guest,
      targetGuestId: ids.targetGuest,
      matchScore: 0.97,
      reasons: ["Exact normalized email match", "Confirmed by a manager"],
    };
    expect(mergeGuestInputSchema.safeParse(valid).success).toBe(true);
    expect(
      mergeGuestInputSchema.safeParse({
        ...valid,
        targetGuestId: ids.guest,
      }).success,
    ).toBe(false);
    expect(
      mergeGuestInputSchema.safeParse({
        ...valid,
        matchScore: 1.01,
      }).success,
    ).toBe(false);
  });
});
