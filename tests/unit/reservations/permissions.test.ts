import { describe, expect, it } from "vitest";
import {
  canAccessReservationHost,
  deriveReservationHostPermissions,
} from "@/lib/reservations/model";

describe("reservation host permissions", () => {
  it("keeps each exact reservation capability independent", () => {
    expect(deriveReservationHostPermissions(["reservations.view"])).toEqual({
      view: true,
      operate: false,
      override: false,
      configure: false,
    });
    expect(
      deriveReservationHostPermissions(["reservations.operate"]),
    ).toEqual({
      view: false,
      operate: true,
      override: false,
      configure: false,
    });
  });

  it("allows the read model for any database-approved reservation grant", () => {
    for (const capability of [
      "reservations.view",
      "reservations.operate",
      "reservations.override",
      "reservations.configure",
    ]) {
      expect(
        canAccessReservationHost(
          deriveReservationHostPermissions([capability]),
        ),
      ).toBe(true);
    }
  });

  it("denies a workspace with no reservation grant", () => {
    expect(
      canAccessReservationHost(
        deriveReservationHostPermissions([
          "schedule.manage",
          "guest.manage",
        ]),
      ),
    ).toBe(false);
  });
});
