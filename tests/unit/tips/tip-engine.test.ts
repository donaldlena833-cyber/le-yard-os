import { describe, expect, it } from "vitest";

import {
  approveTipPoolCalculation,
  assertTipCalculationEditable,
  assertTipRunEditable,
  calculateTipPool,
  markTipPoolCalculationExported,
  TipPoolLockedError,
  TipPoolValidationError,
  type TipParticipant,
  type TipPoolPolicy,
  type TipPoolRun,
} from "../../../src/lib/tips";

function participant(
  employeeId: string,
  minutes: number | number[],
  jobCodeId = "server",
  overrides: Partial<TipParticipant> = {},
): TipParticipant {
  const minuteList = Array.isArray(minutes) ? minutes : minutes === 0 ? [] : [minutes];
  return {
    employeeId,
    displayName: `Employee ${employeeId}`,
    organizationRole: "employee",
    segments: minuteList.map((segmentMinutes, index) => ({
      id: `${employeeId}-shift-${index + 1}`,
      jobCodeId,
      minutes: segmentMinutes,
    })),
    ...overrides,
  };
}

function policy(overrides: Partial<TipPoolPolicy> = {}): TipPoolPolicy {
  return {
    id: "policy-main",
    organizationId: "org-1",
    locationId: "location-1",
    version: 3,
    name: "Front of house pool",
    status: "active",
    effectiveFrom: "2026-01-01",
    allocationMethod: "hours",
    ...overrides,
  };
}

function run(overrides: Partial<TipPoolRun> = {}): TipPoolRun {
  return {
    id: "run-2026-08-01",
    organizationId: "org-1",
    locationId: "location-1",
    businessDate: "2026-08-01",
    currency: "USD",
    policyId: "policy-main",
    policyVersion: 3,
    status: "draft",
    sources: [{ id: "card", label: "Card tips", kind: "card_tip", amountCents: 300 }],
    participants: [participant("employee-a", 60), participant("employee-b", 60)],
    ...overrides,
  };
}

function allocation(result: ReturnType<typeof calculateTipPool>, employeeId: string) {
  const found = result.employees.find((employee) => employee.employeeId === employeeId);
  if (!found) throw new Error(`Missing allocation for ${employeeId}`);
  return found;
}

describe("calculateTipPool", () => {
  it("splits an hourly pool equally for equal eligible minutes", () => {
    const result = calculateTipPool(policy(), run());

    expect(result.employees.map((employee) => employee.poolShareCents)).toEqual([150, 150]);
    expect(result.reconciliation).toMatchObject({ balanced: true, poolDifferenceCents: 0 });
  });

  it("allocates proportionally to eligible minutes", () => {
    const result = calculateTipPool(
      policy(),
      run({ participants: [participant("employee-a", 120), participant("employee-b", 60)] }),
    );

    expect(allocation(result, "employee-a").poolShareCents).toBe(200);
    expect(allocation(result, "employee-b").poolShareCents).toBe(100);
  });

  it("aggregates split shifts for the same employee before allocating", () => {
    const result = calculateTipPool(
      policy(),
      run({ participants: [participant("employee-a", [30, 90]), participant("employee-b", 60)] }),
    );

    const employee = allocation(result, "employee-a");
    expect(employee.workedMinutes).toBe(120);
    expect(employee.eligibleMinutes).toBe(120);
    expect(employee.poolShareCents).toBe(200);
    expect(employee.explanation.segments).toHaveLength(2);
  });

  it("uses job weights for weighted-points policies", () => {
    const weightedPolicy = policy({
      allocationMethod: "weighted_points",
      weights: { jobCodeBasisPoints: { server: 10_000, bartender: 20_000 } },
    });
    const result = calculateTipPool(
      weightedPolicy,
      run({ participants: [participant("employee-a", 60, "server"), participant("employee-b", 60, "bartender")] }),
    );

    expect(allocation(result, "employee-a").poolShareCents).toBe(100);
    expect(allocation(result, "employee-b").poolShareCents).toBe(200);
  });

  it("falls back to organization-role weights", () => {
    const weightedPolicy = policy({
      allocationMethod: "weighted_points",
      weights: { organizationRoleBasisPoints: { employee: 10_000, manager: 30_000 } },
    });
    const manager = participant("manager-a", 60, "manager-job", { organizationRole: "manager" });
    const result = calculateTipPool(weightedPolicy, run({ participants: [participant("employee-a", 60), manager] }));

    expect(allocation(result, "employee-a").poolShareCents).toBe(75);
    expect(allocation(result, "manager-a").poolShareCents).toBe(225);
  });

  it("gives employee weights precedence over job and role weights", () => {
    const weightedPolicy = policy({
      allocationMethod: "weighted_points",
      weights: {
        defaultBasisPoints: 5_000,
        organizationRoleBasisPoints: { employee: 10_000 },
        jobCodeBasisPoints: { server: 20_000 },
        employeeBasisPoints: { "employee-a": 40_000 },
      },
    });
    const result = calculateTipPool(weightedPolicy, run());

    expect(allocation(result, "employee-a").poolShareCents).toBe(200);
    expect(allocation(result, "employee-b").poolShareCents).toBe(100);
    expect(allocation(result, "employee-a").explanation.segments[0].note).toContain("employee override");
  });

  it("uses the policy default weight when there is no override", () => {
    const weightedPolicy = policy({
      allocationMethod: "weighted_points",
      weights: { defaultBasisPoints: 15_000 },
    });
    const result = calculateTipPool(weightedPolicy, run());

    expect(result.employees.map((employee) => employee.contributionUnits)).toEqual(["900000", "900000"]);
  });

  it("excludes work performed under an ineligible job code", () => {
    const eligiblePolicy = policy({ eligibility: { jobCodeIds: ["server"] } });
    const mixed = participant("employee-a", 60);
    mixed.segments.push({ id: "employee-a-training", jobCodeId: "training", minutes: 60 });
    const result = calculateTipPool(eligiblePolicy, run({ participants: [mixed, participant("employee-b", 60)] }));

    expect(allocation(result, "employee-a").eligibleMinutes).toBe(60);
    expect(allocation(result, "employee-a").poolShareCents).toBe(150);
    expect(allocation(result, "employee-a").explanation.segments[1].code).toBe("job_ineligible");
  });

  it("excludes organization roles not listed by the policy", () => {
    const employeeOnly = policy({ eligibility: { organizationRoles: ["employee"] } });
    const manager = participant("manager-a", 60, "server", { organizationRole: "manager" });
    const result = calculateTipPool(employeeOnly, run({ participants: [participant("employee-a", 60), manager] }));

    expect(allocation(result, "employee-a").poolShareCents).toBe(300);
    expect(allocation(result, "manager-a")).toMatchObject({ eligible: false, poolShareCents: 0 });
    expect(allocation(result, "manager-a").explanation.eligibilityCode).toBe("role_ineligible");
  });

  it("honors a run-level participant exclusion and records its reason", () => {
    const excluded = participant("employee-a", 60, "server", {
      excluded: true,
      exclusionReason: "Training shift",
    });
    const result = calculateTipPool(policy(), run({ participants: [excluded, participant("employee-b", 60)] }));

    expect(allocation(result, "employee-a").poolShareCents).toBe(0);
    expect(allocation(result, "employee-a").explanation.eligibilityNote).toBe("Training shift");
  });

  it("honors excluded work segments while retaining worked minutes", () => {
    const employee = participant("employee-a", [30, 30]);
    employee.segments[1] = {
      ...employee.segments[1],
      excluded: true,
      exclusionReason: "Manager-approved correction",
    };
    const result = calculateTipPool(policy(), run({ participants: [employee, participant("employee-b", 30)] }));

    expect(allocation(result, "employee-a")).toMatchObject({ workedMinutes: 60, eligibleMinutes: 30, poolShareCents: 150 });
  });

  it("honors policy-level employee exclusions", () => {
    const result = calculateTipPool(
      policy({ eligibility: { excludedEmployeeIds: ["employee-a"] } }),
      run(),
    );

    expect(allocation(result, "employee-a").explanation.eligibilityCode).toBe("policy_employee_excluded");
    expect(allocation(result, "employee-b").poolShareCents).toBe(300);
  });

  it("keeps a zero-hour employee in the explanation with a zero share", () => {
    const result = calculateTipPool(
      policy(),
      run({ participants: [participant("employee-a", 0), participant("employee-b", 60)] }),
    );

    expect(allocation(result, "employee-a")).toMatchObject({ eligible: false, workedMinutes: 0, poolShareCents: 0 });
    expect(allocation(result, "employee-a").explanation.eligibilityCode).toBe("no_worked_minutes");
  });

  it("rejects a positive pool when every employee has zero contribution", () => {
    expect(() =>
      calculateTipPool(policy(), run({ participants: [participant("employee-a", 0), participant("employee-b", 0)] })),
    ).toThrowError(TipPoolValidationError);
  });

  it("allows a zero-dollar pool with zero-hour employees", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "card", label: "Card tips", kind: "card_tip", amountCents: 0 }],
        participants: [participant("employee-a", 0)],
      }),
    );

    expect(result.totals.payrollTipCents).toBe(0);
    expect(result.reconciliation.balanced).toBe(true);
  });

  it("pools multiple tip sources and separates service charges by default", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [
          { id: "cash", label: "Cash", kind: "cash_tip", amountCents: 100 },
          { id: "card", label: "Card", kind: "card_tip", amountCents: 200 },
          { id: "service", label: "Service charge", kind: "service_charge", amountCents: 400 },
        ],
      }),
    );

    expect(result.totals).toMatchObject({
      grossSourceCents: 700,
      pooledTipCents: 300,
      separatedSourceCents: 400,
      separatedServiceChargeCents: 400,
      payrollTipCents: 300,
    });
    expect(result.reconciliation.classifiedSourceCents).toBe(700);
  });

  it("supports explicitly excluded and separately held tip sources", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [
          { id: "cash", label: "Cash", kind: "cash_tip", amountCents: 100, disposition: "pool" },
          { id: "private", label: "Private event", kind: "other_tip", amountCents: 50, disposition: "separate" },
          { id: "test", label: "Test payment", kind: "card_tip", amountCents: 25, disposition: "exclude" },
        ],
      }),
    );

    expect(result.totals).toMatchObject({ pooledTipCents: 100, separatedSourceCents: 50, excludedSourceCents: 25 });
  });

  it("rejects attempts to pool a service charge", () => {
    const invalidRun = run({
      sources: [
        { id: "service", label: "Service charge", kind: "service_charge", amountCents: 100, disposition: "pool" },
      ],
    });

    expect(() => calculateTipPool(policy(), invalidRun)).toThrowError(/Service charges cannot be included/);
  });

  it("adds positive manual adjustments after pool allocation", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 100 }],
        adjustments: [{ id: "adj-1", employeeId: "employee-a", amountCents: 25, reason: "Prior shift correction" }],
      }),
    );

    expect(allocation(result, "employee-a")).toMatchObject({ poolShareCents: 50, adjustmentCents: 25, totalTipCents: 75 });
    expect(result.totals).toMatchObject({ adjustmentCents: 25, payrollTipCents: 125 });
  });

  it("applies negative manual adjustments without changing the base pool", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 100 }],
        adjustments: [{ id: "adj-1", employeeId: "employee-a", amountCents: -20, reason: "Duplicate payout reversal" }],
      }),
    );

    expect(allocation(result, "employee-a")).toMatchObject({ poolShareCents: 50, adjustmentCents: -20, totalTipCents: 30 });
    expect(result.totals).toMatchObject({ allocatedPoolCents: 100, payrollTipCents: 80 });
  });

  it("nets multiple adjustments deterministically and explains each one", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 100 }],
        adjustments: [
          { id: "z-adjustment", employeeId: "employee-a", amountCents: -10, reason: "Correction B" },
          { id: "a-adjustment", employeeId: "employee-a", amountCents: 30, reason: "Correction A" },
        ],
      }),
    );

    const employee = allocation(result, "employee-a");
    expect(employee.totalTipCents).toBe(70);
    expect(employee.explanation.adjustmentDetails.map((item) => item.id)).toEqual(["a-adjustment", "z-adjustment"]);
  });

  it("permits a positive adjustment for a zero-hour participant", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 0 }],
        participants: [participant("employee-a", 0)],
        adjustments: [{ id: "adj-1", employeeId: "employee-a", amountCents: 75, reason: "Prior approved correction" }],
      }),
    );

    expect(allocation(result, "employee-a")).toMatchObject({ eligible: false, poolShareCents: 0, totalTipCents: 75 });
  });

  it("rejects a negative adjustment that would create a negative employee payout", () => {
    const invalidRun = run({
      sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 100 }],
      adjustments: [{ id: "adj-1", employeeId: "employee-a", amountCents: -51, reason: "Too large" }],
    });

    expect(() => calculateTipPool(policy(), invalidRun)).toThrowError(/below zero/);
  });

  it("uses employee ID ascending as the explicit rounding tie-breaker", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "cash", label: "Cash", kind: "cash_tip", amountCents: 2 }],
        participants: [participant("employee-c", 1), participant("employee-b", 1), participant("employee-a", 1)],
      }),
    );

    expect(result.employees.map((employee) => [employee.employeeId, employee.poolShareCents])).toEqual([
      ["employee-a", 1],
      ["employee-b", 1],
      ["employee-c", 0],
    ]);
    expect(result.rounding).toMatchObject({ tieBreaker: "employee_id_ascending", centsAwarded: 2 });
  });

  it("awards a remainder cent to the largest fractional share", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "cash", label: "Cash", kind: "cash_tip", amountCents: 10 }],
        participants: [participant("employee-a", 1), participant("employee-b", 2), participant("employee-c", 3)],
      }),
    );

    expect(result.employees.map((employee) => employee.poolShareCents)).toEqual([2, 3, 5]);
    expect(allocation(result, "employee-a").explanation.roundingAwardCents).toBe(1);
  });

  it("reconciles every cent for a repeating fractional split", () => {
    const result = calculateTipPool(
      policy(),
      run({
        sources: [{ id: "card", label: "Card", kind: "card_tip", amountCents: 10_001 }],
        participants: [participant("employee-a", 1), participant("employee-b", 1), participant("employee-c", 1)],
      }),
    );

    expect(result.employees.map((employee) => employee.poolShareCents)).toEqual([3334, 3334, 3333]);
    expect(result.employees.reduce((sum, employee) => sum + employee.totalTipCents, 0)).toBe(10_001);
    expect(result.reconciliation).toMatchObject({ poolDifferenceCents: 0, payrollDifferenceCents: 0, balanced: true });
  });

  it("is independent of source, participant, segment, and adjustment input order", () => {
    const firstEmployee = participant("employee-a", [30, 90]);
    const secondEmployee = participant("employee-b", 60);
    const firstRun = run({
      sources: [
        { id: "z-card", label: "Card", kind: "card_tip", amountCents: 200 },
        { id: "a-cash", label: "Cash", kind: "cash_tip", amountCents: 100 },
      ],
      participants: [secondEmployee, firstEmployee],
      adjustments: [
        { id: "z-adj", employeeId: "employee-a", amountCents: -5, reason: "B" },
        { id: "a-adj", employeeId: "employee-a", amountCents: 5, reason: "A" },
      ],
    });
    const secondRun = structuredClone(firstRun);
    secondRun.sources.reverse();
    secondRun.participants.reverse();
    secondRun.participants[0].segments.reverse();
    secondRun.adjustments?.reverse();

    expect(calculateTipPool(policy(), firstRun)).toEqual(calculateTipPool(policy(), secondRun));
  });

  it("provides exact integer calculation evidence for every employee", () => {
    const result = calculateTipPool(policy(), run());
    const employee = allocation(result, "employee-a");

    expect(employee.explanation).toMatchObject({
      allocationMethod: "hours",
      contributionUnits: "60",
      totalContributionUnits: "120",
      exactShareNumerator: "18000",
      exactShareDenominator: "120",
      floorShareCents: 150,
      remainderNumerator: "0",
      roundingAwardCents: 0,
    });
  });

  it("rejects approved and exported runs before recalculation", () => {
    expect(() => calculateTipPool(policy(), run({ status: "approved" }))).toThrowError(TipPoolLockedError);
    expect(() => calculateTipPool(policy(), run({ status: "exported" }))).toThrowError(TipPoolLockedError);
  });

  it("rejects draft policies and mismatched policy versions", () => {
    expect(() => calculateTipPool(policy({ status: "draft" }), run())).toThrowError(/draft policy/i);
    expect(() => calculateTipPool(policy(), run({ policyVersion: 2 }))).toThrowError(/different policy version/i);
  });

  it("enforces the policy effective window", () => {
    expect(() =>
      calculateTipPool(policy({ effectiveFrom: "2026-08-02" }), run({ businessDate: "2026-08-01" })),
    ).toThrowError(/not yet effective/i);
    expect(() =>
      calculateTipPool(policy({ effectiveTo: "2026-07-31" }), run({ businessDate: "2026-08-01" })),
    ).toThrowError(/no longer effective/i);
  });
});

describe("approval and lock guards", () => {
  it("creates a deeply frozen approved snapshot with explicit audit data", () => {
    const calculated = calculateTipPool(policy(), run());
    const approved = approveTipPoolCalculation(calculated, {
      approvedBy: "manager-1",
      approvedAt: "2026-08-02T02:30:00Z",
      note: "  Closeout verified  ",
    });

    expect(approved).toMatchObject({
      status: "approved",
      lock: { locked: true, reason: "approved" },
      approval: { approvedBy: "manager-1", approvedAt: "2026-08-02T02:30:00Z", note: "Closeout verified" },
    });
    expect(Object.isFrozen(approved)).toBe(true);
    expect(Object.isFrozen(approved.employees)).toBe(true);
    expect(calculated.status).toBe("calculated");
  });

  it("prevents editing or reapproving an approved calculation", () => {
    const approved = approveTipPoolCalculation(calculateTipPool(policy(), run()), {
      approvedBy: "manager-1",
      approvedAt: "2026-08-02T02:30:00Z",
    });

    expect(() => assertTipCalculationEditable(approved)).toThrowError(TipPoolLockedError);
    expect(() =>
      approveTipPoolCalculation(approved, { approvedBy: "manager-2", approvedAt: "2026-08-02T03:00:00Z" }),
    ).toThrowError(TipPoolLockedError);
  });

  it("refuses to approve a calculation whose reconciliation was altered", () => {
    const calculated = calculateTipPool(policy(), run());
    calculated.reconciliation.payrollDifferenceCents = 1;

    expect(() =>
      approveTipPoolCalculation(calculated, { approvedBy: "manager-1", approvedAt: "2026-08-02T02:30:00Z" }),
    ).toThrowError(/exactly reconciled/i);
  });

  it("requires approval before recording an export and locks the exported snapshot", () => {
    const calculated = calculateTipPool(policy(), run());
    expect(() =>
      markTipPoolCalculationExported(calculated, {
        exportedBy: "owner-1",
        exportedAt: "2026-08-02T04:00:00Z",
      }),
    ).toThrowError(/must be approved/i);

    const approved = approveTipPoolCalculation(calculated, {
      approvedBy: "manager-1",
      approvedAt: "2026-08-02T02:30:00Z",
    });
    const exported = markTipPoolCalculationExported(approved, {
      exportedBy: "owner-1",
      exportedAt: "2026-08-02T04:00:00Z",
    });
    expect(exported).toMatchObject({ status: "exported", lock: { locked: true, reason: "exported" } });
    expect(() => assertTipCalculationEditable(exported)).toThrowError(TipPoolLockedError);
  });

  it("validates audit actors and timestamps", () => {
    const calculated = calculateTipPool(policy(), run());
    expect(() =>
      approveTipPoolCalculation(calculated, { approvedBy: "", approvedAt: "tomorrow" }),
    ).toThrowError(TipPoolValidationError);
  });

  it("exposes a run-level guard for persistence mutation paths", () => {
    expect(() => assertTipRunEditable({ id: "run-1", status: "draft" })).not.toThrow();
    expect(() => assertTipRunEditable({ id: "run-1", status: "approved" })).toThrowError(TipPoolLockedError);
  });
});
