import { describe, expect, it } from "vitest";

import {
  TipPoolValidationError,
  validateTipPoolPolicy,
  validateTipPoolRun,
  type TipPoolPolicy,
  type TipPoolRun,
} from "../../../src/lib/tips";

const validPolicy: TipPoolPolicy = {
  id: "policy-1",
  organizationId: "org-1",
  locationId: "location-1",
  version: 1,
  name: "Tip pool",
  status: "active",
  effectiveFrom: "2026-01-01",
  allocationMethod: "hours",
};

const validRun: TipPoolRun = {
  id: "run-1",
  organizationId: "org-1",
  locationId: "location-1",
  businessDate: "2026-08-01",
  currency: "USD",
  policyId: "policy-1",
  policyVersion: 1,
  status: "draft",
  sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 100 }],
  participants: [
    {
      employeeId: "employee-1",
      displayName: "Employee One",
      organizationRole: "employee",
      segments: [{ id: "shift-1", jobCodeId: "server", minutes: 60 }],
    },
  ],
};

describe("tip policy and run validation", () => {
  it("rejects impossible calendar dates", () => {
    expect(() => validateTipPoolPolicy({ ...validPolicy, effectiveFrom: "2026-02-30" })).toThrowError(
      /real calendar date/i,
    );
    expect(() => validateTipPoolRun({ ...validRun, businessDate: "2026-13-01" })).toThrowError(
      /real calendar date/i,
    );
  });

  it("rejects duplicate source, employee, segment, and adjustment identifiers", () => {
    const invalid = structuredClone(validRun);
    invalid.sources.push({ ...invalid.sources[0] });
    invalid.participants.push({ ...structuredClone(invalid.participants[0]) });
    invalid.participants[0].segments.push({ ...invalid.participants[0].segments[0] });
    invalid.adjustments = [
      { id: "adj-1", employeeId: "employee-1", amountCents: 1, reason: "A" },
      { id: "adj-1", employeeId: "employee-1", amountCents: 2, reason: "B" },
    ];

    try {
      validateTipPoolRun(invalid);
      expect.fail("Expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TipPoolValidationError);
      const codes = (error as TipPoolValidationError).issues.map((item) => item.code);
      expect(codes).toEqual(expect.arrayContaining(["duplicate_source", "duplicate_employee", "duplicate_segment", "duplicate_adjustment"]));
    }
  });

  it("requires auditable reasons for participant and segment exclusions", () => {
    const invalid = structuredClone(validRun);
    invalid.participants[0].excluded = true;
    invalid.participants[0].segments[0].excluded = true;

    try {
      validateTipPoolRun(invalid);
      expect.fail("Expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TipPoolValidationError);
      expect((error as TipPoolValidationError).issues.filter((item) => item.code === "missing_exclusion_reason")).toHaveLength(2);
    }
  });

  it("rejects adjustments for employees outside the run", () => {
    const invalid: TipPoolRun = {
      ...validRun,
      adjustments: [{ id: "adj-1", employeeId: "missing", amountCents: 10, reason: "Correction" }],
    };
    expect(() => validateTipPoolRun(invalid)).toThrowError(/No participant exists/);
  });

  it("rejects zero-value adjustments and unsafe integer cents", () => {
    expect(() =>
      validateTipPoolRun({
        ...validRun,
        adjustments: [{ id: "adj-1", employeeId: "employee-1", amountCents: 0, reason: "No-op" }],
      }),
    ).toThrowError(/cannot be zero/i);
    expect(() =>
      validateTipPoolRun({
        ...validRun,
        sources: [{ ...validRun.sources[0], amountCents: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).toThrowError(TipPoolValidationError);
  });

  it("rejects duplicate eligibility lists and unknown role weights", () => {
    const invalid = {
      ...validPolicy,
      eligibility: { jobCodeIds: ["server", "server"] },
      weights: { organizationRoleBasisPoints: { chef: 10_000 } },
    };
    try {
      validateTipPoolPolicy(invalid);
      expect.fail("Expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TipPoolValidationError);
      expect((error as TipPoolValidationError).issues.map((item) => item.code)).toEqual(
        expect.arrayContaining(["duplicate_job_code", "unknown_role_weight"]),
      );
    }
  });

  it("requires timezone-bearing ISO timestamps for adjustment audit data", () => {
    const invalid: TipPoolRun = {
      ...validRun,
      adjustments: [
        {
          id: "adj-1",
          employeeId: "employee-1",
          amountCents: 10,
          reason: "Correction",
          createdAt: "2026-08-01T12:00:00",
        },
      ],
    };
    expect(() => validateTipPoolRun(invalid)).toThrowError(/timezone/i);
  });
});
