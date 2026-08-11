import { describe, expect, it } from "vitest";
import {
  createSaturdayServiceWorkspace,
  saturdayServiceSimulation,
} from "@/lib/demo";

describe("Saturday service simulation", () => {
  it("anchors the preview five months into service on a Saturday at 8 PM", () => {
    const workspace = createSaturdayServiceWorkspace();

    expect(saturdayServiceSimulation).toMatchObject({
      businessDate: "2026-04-18",
      observedAt: "2026-04-18T20:00:00-04:00",
      openedOn: "2025-11-18",
      monthsInService: 5,
      synthetic: true,
    });
    expect(new Date(`${saturdayServiceSimulation.businessDate}T12:00:00Z`).getUTCDay()).toBe(6);
    expect(workspace.asOf).toBe(saturdayServiceSimulation.observedAt);
    expect(workspace.organizations[0]?.createdAt).toBe("2025-11-18T10:00:00-05:00");
  });

  it("moves the cross-module demo history into the simulated operating window", () => {
    const workspace = createSaturdayServiceWorkspace();

    expect(workspace.schedules.some((schedule) => schedule.startsOn <= "2026-04-18")).toBe(true);
    expect(workspace.shifts.some((shift) => shift.startsAt.startsWith("2026-04-18"))).toBe(true);
    expect(workspace.closeouts.length).toBeGreaterThan(0);
    expect(workspace.inventoryItems.length).toBeGreaterThan(0);
    expect(workspace.guests.length).toBeGreaterThan(0);
    expect(workspace.tasks.length).toBeGreaterThan(0);
    expect(workspace.savedReports.length).toBeGreaterThan(0);
    expect(workspace.auditEvents.every((event) => event.immutable)).toBe(true);
  });

  it("keeps the primary room and owner access fixture intact", () => {
    const workspace = createSaturdayServiceWorkspace();
    const primaryLocation = workspace.locations[0];
    const donaldMembership = workspace.memberships.find(
      (membership) => membership.id === "membership-donald",
    );

    expect(primaryLocation?.name).toBe("Le Yard");
    expect(primaryLocation?.address.line1).toBe("858 9th Ave");
    expect(donaldMembership).toMatchObject({
      role: "owner",
      status: "active",
      organizationWide: true,
    });
  });
});
