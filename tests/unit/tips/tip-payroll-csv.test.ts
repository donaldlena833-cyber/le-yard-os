import { describe, expect, it } from "vitest";

import {
  approveTipPoolCalculation,
  calculateTipPool,
  type TipParticipant,
  type TipPoolPolicy,
  type TipPoolRun,
} from "../../../src/lib/tips";
import {
  escapeCsvField,
  formatCentsAsDecimal,
  formatMinutesAsDecimalHours,
  generateTipPayrollCsv,
} from "../../../src/lib/exports";

const csvPolicy: TipPoolPolicy = {
  id: "policy-1",
  organizationId: "org-1",
  locationId: "location-1",
  version: 1,
  name: "Payroll pool",
  status: "active",
  effectiveFrom: "2026-01-01",
  allocationMethod: "hours",
};

function csvRun(participants: TipParticipant[]): TipPoolRun {
  return {
    id: "run-1",
    organizationId: "org-1",
    locationId: "location-1",
    businessDate: "2026-08-01",
    currency: "USD",
    policyId: "policy-1",
    policyVersion: 1,
    status: "draft",
    sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 100 }],
    participants,
  };
}

function csvParticipant(employeeId: string, displayName: string, minutes: number): TipParticipant {
  return {
    employeeId,
    displayName,
    organizationRole: "employee",
    segments: minutes === 0 ? [] : [{ id: `${employeeId}-shift`, jobCodeId: "server", minutes }],
  };
}

function approvedCalculation(participants: TipParticipant[]) {
  return approveTipPoolCalculation(calculateTipPool(csvPolicy, csvRun(participants)), {
    approvedBy: "manager-1",
    approvedAt: "2026-08-02T02:00:00Z",
  });
}

describe("payroll CSV", () => {
  it("requires an approved calculation by default", () => {
    const calculation = calculateTipPool(csvPolicy, csvRun([csvParticipant("employee-a", "A", 60)]));
    expect(() => generateTipPayrollCsv(calculation)).toThrowError(/approved/i);
    expect(() => generateTipPayrollCsv(calculation, { requireApproval: false })).not.toThrow();
  });

  it("escapes commas, quotes, and newlines according to CSV rules", () => {
    expect(escapeCsvField('Doe, "D"\nJr')).toBe('"Doe, ""D""\nJr"');
    const calculation = approvedCalculation([csvParticipant("employee-a", 'Doe, "D"\nJr', 60)]);
    const csv = generateTipPayrollCsv(calculation);
    expect(csv).toContain('"Doe, ""D""\nJr"');
  });

  it("protects text cells from spreadsheet formula injection", () => {
    const calculation = approvedCalculation([csvParticipant("employee-a", "=2+2", 60)]);
    const csv = generateTipPayrollCsv(calculation);
    expect(csv).toContain("employee-a,'=2+2,true");

    const unprotected = generateTipPayrollCsv(calculation, { preventSpreadsheetFormulas: false });
    expect(unprotected).toContain("employee-a,=2+2,true");
  });

  it("formats positive and negative integer cents without floating-point drift", () => {
    expect(formatCentsAsDecimal(1)).toBe("0.01");
    expect(formatCentsAsDecimal(12_345)).toBe("123.45");
    expect(formatCentsAsDecimal(-9)).toBe("-0.09");
  });

  it("formats integer minutes as four-place decimal hours", () => {
    expect(formatMinutesAsDecimalHours(1)).toBe("0.0167");
    expect(formatMinutesAsDecimalHours(30)).toBe("0.5000");
    expect(formatMinutesAsDecimalHours(90)).toBe("1.5000");
  });

  it("omits zero-dollar rows by default and can include them for audit exports", () => {
    const calculation = approvedCalculation([
      csvParticipant("employee-a", "A", 60),
      csvParticipant("employee-z", "Z", 0),
    ]);
    const standard = generateTipPayrollCsv(calculation);
    const audit = generateTipPayrollCsv(calculation, { includeZeroRows: true });

    expect(standard).not.toContain("employee-z");
    expect(audit).toContain("employee-z");
  });

  it("orders payroll rows by employee ID regardless of source order", () => {
    const calculation = approvedCalculation([
      csvParticipant("employee-z", "Z", 60),
      csvParticipant("employee-a", "A", 60),
    ]);
    const csv = generateTipPayrollCsv(calculation);

    expect(csv.indexOf("employee-a")).toBeLessThan(csv.indexOf("employee-z"));
  });

  it("uses CRLF records and optionally emits a UTF-8 BOM", () => {
    const calculation = approvedCalculation([csvParticipant("employee-a", "A", 60)]);
    const csv = generateTipPayrollCsv(calculation, { includeUtf8Bom: true });

    expect(csv.startsWith("\uFEFFOrganization ID")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });
});
