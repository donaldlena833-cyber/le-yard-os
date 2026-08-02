import { describe, expect, it } from "vitest";

import { demoIds, demoWorkspace } from "../../../src/lib/demo";

function collectDateInstances(value: unknown, path = "root", found: string[] = []): string[] {
  if (value instanceof Date) found.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDateInstances(item, `${path}[${index}]`, found));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => collectDateInstances(item, `${path}.${key}`, found));
  }
  return found;
}

describe("demo workspace integrity", () => {
  it("contains one organization, two locations, and the two requested owners", () => {
    expect(demoWorkspace.organizations).toHaveLength(1);
    expect(demoWorkspace.locations).toHaveLength(2);

    const owners = demoWorkspace.people.filter((person) => person.primaryRole === "owner");
    expect(owners.map((person) => person.id).sort()).toEqual(
      [demoIds.people.donald, demoIds.people.maris].sort(),
    );
    expect(owners.every((owner) => owner.locationIds.length === 2)).toBe(true);
  });

  it("presents the owner-supplied Le Yard playground location without disguising mock scope", () => {
    expect(demoWorkspace.organizations[0].name).toBe("Le Yard — Playground");
    expect(demoWorkspace.locations[0]).toMatchObject({
      name: "Le Yard — Playground",
      address: {
        line1: "858 9th Ave",
        line2: null,
        city: "New York",
        region: "NY",
        postalCode: "10019",
        countryCode: "US",
      },
    });
    expect(demoWorkspace.locations[1].name).toContain("Demo");
  });

  it("stores owner assumptions as unpublished reference-only notes with calculations disabled", () => {
    const assumptions = demoWorkspace.ownerDraftOperatingAssumptions;

    expect(assumptions).toMatchObject({
      status: "unpublished",
      source: "owner_supplied",
      purpose: "reference_only",
      break: {
        scheduledShiftLongerThanMinutes: 360,
        minimumUnpaidBreakMinutes: 30,
        timingStatus: "compliance_review_pending",
        calculationEnabled: false,
      },
      overtime: {
        multiplier: 1.5,
        thresholdHours: null,
        workweek: null,
        exemptionsConfigured: false,
        calculationEnabled: false,
      },
      gratuity: {
        automaticGratuity: false,
        customerTips: "voluntary",
      },
      eventFee: {
        rateBasisPoints: 1_000,
        includedInTips: false,
        treatmentStatus: "review_pending",
        calculationEnabled: false,
      },
      payrollExport: { status: "undecided", enabled: false },
      retention: { status: "unset", automaticDeletionEnabled: false },
    });
  });

  it("gives every synthetic fixture shift longer than six hours at least 30 unpaid minutes", () => {
    const longShifts = demoWorkspace.shifts.filter((shift) => {
      const durationMinutes =
        (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 60_000;
      return durationMinutes > 360;
    });

    expect(longShifts.length).toBeGreaterThan(0);
    expect(longShifts.every((shift) => shift.unpaidBreakMinutes >= 30)).toBe(true);
  });

  it("is fully JSON serializable and never exports Date objects", () => {
    expect(collectDateInstances(demoWorkspace)).toEqual([]);
    expect(JSON.parse(JSON.stringify(demoWorkspace))).toEqual(demoWorkspace);
  });

  it("uses reserved synthetic contact details", () => {
    for (const person of demoWorkspace.people) {
      expect(person.email.endsWith(".invalid")).toBe(true);
      expect(person.phone).toMatch(/^\+1-212-555-01\d{2}$/);
      if (person.emergencyContact) {
        expect(person.emergencyContact.phone).toMatch(/^\+1-212-555-01\d{2}$/);
      }
    }
    for (const guest of demoWorkspace.guests) {
      if (guest.contact.email) expect(guest.contact.email.endsWith(".invalid")).toBe(true);
      if (guest.contact.phone) expect(guest.contact.phone).toMatch(/^\+1-212-555-01\d{2}$/);
    }
    for (const vendor of demoWorkspace.vendors) {
      expect(vendor.email.endsWith(".invalid")).toBe(true);
      expect(vendor.phone).toMatch(/^\+1-212-555-01\d{2}$/);
    }
  });

  it("keeps high-value foreign references resolvable", () => {
    const locationIds = new Set(demoWorkspace.locations.map(({ id }) => id));
    const personIds = new Set(demoWorkspace.people.map(({ id }) => id));
    const roleIds = new Set(demoWorkspace.jobRoles.map(({ id }) => id));
    const scheduleIds = new Set(demoWorkspace.schedules.map(({ id }) => id));
    const channelIds = new Set(demoWorkspace.chatChannels.map(({ id }) => id));
    const guestIds = new Set(demoWorkspace.guests.map(({ id }) => id));
    const reservationIds = new Set(demoWorkspace.reservations.map(({ id }) => id));
    const itemIds = new Set(demoWorkspace.inventoryItems.map(({ id }) => id));
    const vendorIds = new Set(demoWorkspace.vendors.map(({ id }) => id));
    const purchaseOrderIds = new Set(demoWorkspace.purchaseOrders.map(({ id }) => id));

    for (const shift of demoWorkspace.shifts) {
      expect(locationIds.has(shift.locationId)).toBe(true);
      expect(scheduleIds.has(shift.scheduleId)).toBe(true);
      expect(roleIds.has(shift.jobRoleId)).toBe(true);
      if (shift.personId) expect(personIds.has(shift.personId)).toBe(true);
    }
    for (const message of demoWorkspace.chatMessages) {
      expect(channelIds.has(message.channelId)).toBe(true);
      expect(personIds.has(message.authorId)).toBe(true);
    }
    for (const visit of demoWorkspace.guestVisits) {
      expect(guestIds.has(visit.guestId)).toBe(true);
      if (visit.reservationId) expect(reservationIds.has(visit.reservationId)).toBe(true);
    }
    for (const purchaseOrder of demoWorkspace.purchaseOrders) {
      expect(vendorIds.has(purchaseOrder.vendorId)).toBe(true);
      purchaseOrder.lines.forEach((line) => expect(itemIds.has(line.itemId)).toBe(true));
    }
    for (const delivery of demoWorkspace.deliveries) {
      expect(vendorIds.has(delivery.vendorId)).toBe(true);
      expect(purchaseOrderIds.has(delivery.purchaseOrderId)).toBe(true);
    }
  });

  it("keeps closeout and tip totals balanced to the cent", () => {
    for (const closeout of demoWorkspace.closeouts) {
      expect(closeout.grossSalesCents - closeout.compsCents - closeout.voidsCents).toBe(
        closeout.netSalesCents,
      );
      expect(closeout.actualCashCents - closeout.expectedCashCents).toBe(closeout.cashVarianceCents);
    }
    for (const run of demoWorkspace.tipPoolRuns) {
      expect(run.cashTipsCents + run.cardTipsCents + run.adjustmentsCents).toBe(run.distributableCents);
      expect(run.allocations.reduce((sum, allocation) => sum + allocation.allocatedCents, 0)).toBe(
        run.distributableCents,
      );
    }
  });

  it("keeps all AI insights cited and human-gated when they propose mutations", () => {
    for (const insight of demoWorkspace.aiInsights) {
      expect(insight.citations.length).toBeGreaterThan(0);
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
      if (insight.proposedAction) expect(insight.status).toBe("awaiting_human_review");
    }
  });
});
