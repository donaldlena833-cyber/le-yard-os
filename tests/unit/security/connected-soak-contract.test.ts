import { describe, expect, it } from "vitest";

import { connectedAcceptanceRoles } from "../../connected/attestation-preflight";
import {
  CONNECTED_SOAK_REFRESH_P95_BUDGET_MS,
  CONNECTED_SOAK_SESSION_COUNT,
  connectedSoakPlan,
  percentile95,
} from "../../connected/soak-contract";

describe("connected fourteen-session soak contract", () => {
  it("requires fourteen ordered sessions and exercises every acceptance role", () => {
    expect(CONNECTED_SOAK_SESSION_COUNT).toBe(14);
    expect(connectedSoakPlan).toHaveLength(CONNECTED_SOAK_SESSION_COUNT);
    expect(connectedSoakPlan.map((entry) => entry.session)).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
    for (const role of connectedAcceptanceRoles) {
      expect(connectedSoakPlan.some((entry) => entry.role === role)).toBe(true);
    }
    expect(
      connectedSoakPlan
        .filter((entry) => ["Denied", "Expired", "CrossLocation"].includes(entry.role))
        .every((entry) => !entry.reservationsExpected),
    ).toBe(true);
  });

  it("uses the locked three-second authoritative refresh budget", () => {
    expect(CONNECTED_SOAK_REFRESH_P95_BUDGET_MS).toBe(3_000);
    expect(percentile95([400, 500, 600, 700, 800, 900, 1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700])).toBe(1_700);
    expect(percentile95([])).toBe(0);
  });
});
