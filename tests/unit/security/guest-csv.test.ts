import { describe, expect, it } from "vitest";
import { escapeCsvField } from "@/lib/exports/csv";
import { buildGuestCsv } from "@/lib/exports/guest-csv";
import type { Guest } from "@/types";

function guest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: "guest-1",
    organizationId: "org-1",
    firstName: "Ada",
    lastName: "Lovelace",
    contact: {
      email: "ada@example.com",
      phone: "+1 212 555 0100",
      preferredChannel: "email",
    },
    birthdayMonthDay: null,
    vip: true,
    allergies: [],
    preferences: [],
    notes: "",
    tags: [],
    visitCount: 2,
    lifetimeSpendCents: 12_500,
    lastVisitAt: null,
    mergedIntoId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("guest CSV", () => {
  it("uses shared quote escaping and spreadsheet-formula protection", () => {
    const csv = buildGuestCsv([
      guest({
        firstName: "=HYPERLINK(\"https://evil.example\")",
        lastName: "Guest, One",
        contact: {
          email: "+SUM(1,1)",
          phone: "\t=1+1",
          preferredChannel: "email",
        },
      }),
    ]);

    expect(csv).toContain(
      `"'=HYPERLINK(""https://evil.example"") Guest, One"`,
    );
    expect(csv).toContain(`"'+SUM(1,1)"`);
    expect(csv).toContain(`'\t=1+1`);
    expect(csv).toContain("\r\n");
  });

  it("shares the same encoder used by report exports", () => {
    expect(escapeCsvField('Vendor, "One"')).toBe('"Vendor, ""One"""');
    expect(escapeCsvField("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
    expect(escapeCsvField("  =SUM(A1:A2)")).toBe("'  =SUM(A1:A2)");
  });
});
