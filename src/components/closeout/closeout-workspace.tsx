"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownToLine,
  Calculator,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  LockKeyhole,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import {
  ResponsiveDataView,
  type ResponsiveDataColumn,
} from "@/components/ui/responsive-data-view";
import { StatusPill } from "@/components/ui/status-pill";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { demoIds, demoWorkspace } from "@/lib/demo";
import { generateTipPayrollCsv } from "@/lib/exports";
import {
  TipPoolValidationError,
  approveTipPoolCalculation,
  calculateTipPool,
  type OrganizationRole,
  type TipParticipant,
  type TipPoolCalculation,
  type TipPoolPolicy,
  type TipPoolRun,
} from "@/lib/tips";
import { cn, formatMoney } from "@/lib/utils";

type CloseoutStatus = "draft" | "submitted" | "approved";

type DraftValues = {
  businessDate: string;
  covers: string;
  grossSales: string;
  cashSales: string;
  cardSales: string;
  comps: string;
  voids: string;
  expectedCash: string;
  actualCash: string;
  notes: string;
  cashTips: string;
  cardTips: string;
  serviceCharges: string;
};

type ParticipantSource = {
  personId: string;
  displayName: string;
  organizationRole: OrganizationRole;
  jobRoleId: string;
  jobName: string;
  minutes: number;
  sourceLabel: string;
  policyEligible: boolean;
  defaultWeight: number;
};

type Scenario = {
  locationId: string;
  draft: DraftValues;
  participants: ParticipantSource[];
  weights: Record<string, string>;
};

const MONEY_KEYS = [
  "grossSales",
  "cashSales",
  "cardSales",
  "comps",
  "voids",
  "expectedCash",
  "actualCash",
  "cashTips",
  "cardTips",
  "serviceCharges",
] as const;

type MoneyKey = (typeof MONEY_KEYS)[number];

function centsInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function parseCents(value: string, allowNegative = false): number | null {
  const normalized = value.trim().replaceAll(",", "");
  const pattern = allowNegative ? /^-?\d+(?:\.\d{0,2})?$/ : /^\d+(?:\.\d{0,2})?$/;
  if (!pattern.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

function parseWeightBasisPoints(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,4})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
  return Number.isSafeInteger(basisPoints) && basisPoints <= 1_000_000 ? basisPoints : null;
}

function minutesFromIso(startsAt: string, endsAt: string, unpaidBreakMinutes: number): number {
  return Math.max(0, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000) - unpaidBreakMinutes);
}

function scenarioForLocation(locationId: string): Scenario {
  const closeout = demoWorkspace.closeouts.find((item) => item.locationId === locationId) ?? demoWorkspace.closeouts[0];
  const sourceRun = demoWorkspace.tipPoolRuns.find((item) => item.locationId === locationId);
  const rule = demoWorkspace.tipPoolRules[0];
  const participantMap = new Map<string, ParticipantSource>();

  if (sourceRun) {
    for (const allocation of sourceRun.allocations) {
      const person = demoWorkspace.people.find((item) => item.id === allocation.personId);
      if (!person?.locationIds.includes(locationId)) continue;
      const jobRoleId =
        person.jobRoleIds.find((roleId) => rule.eligibleJobRoleIds.includes(roleId)) ?? person.jobRoleIds[0];
      const job = demoWorkspace.jobRoles.find((item) => item.id === jobRoleId);
      participantMap.set(person.id, {
        personId: person.id,
        displayName: person.displayName,
        organizationRole: person.primaryRole,
        jobRoleId,
        jobName: job?.name ?? "Unknown role",
        minutes: allocation.eligibleMinutes,
        sourceLabel: "Prior approved time record",
        policyEligible: rule.eligibleJobRoleIds.includes(jobRoleId),
        defaultWeight: rule.roleWeights[jobRoleId] ?? 0,
      });
    }
  }

  if (participantMap.size === 0) {
    for (const card of demoWorkspace.timecards.filter(
      (item) => item.locationId === locationId && item.clockedInAt.slice(0, 10) === closeout.businessDate,
    )) {
      const person = demoWorkspace.people.find((item) => item.id === card.personId);
      const job = demoWorkspace.jobRoles.find((item) => item.id === card.jobRoleId);
      if (!person) continue;
      const existing = participantMap.get(person.id);
      participantMap.set(person.id, {
        personId: person.id,
        displayName: person.displayName,
        organizationRole: person.primaryRole,
        jobRoleId: card.jobRoleId,
        jobName: job?.name ?? "Unknown role",
        minutes: (existing?.minutes ?? 0) + card.regularMinutes + card.overtimeMinutes,
        sourceLabel: existing ? "Multiple timecard segments" : "Approved timecard minutes",
        policyEligible: rule.eligibleJobRoleIds.includes(card.jobRoleId),
        defaultWeight: rule.roleWeights[card.jobRoleId] ?? 0,
      });
    }
  }

  if (participantMap.size === 0) {
    for (const shift of demoWorkspace.shifts.filter(
      (item) => item.locationId === locationId && item.personId !== null,
    )) {
      const person = demoWorkspace.people.find((item) => item.id === shift.personId);
      const job = demoWorkspace.jobRoles.find((item) => item.id === shift.jobRoleId);
      if (!person) continue;
      const existing = participantMap.get(person.id);
      participantMap.set(person.id, {
        personId: person.id,
        displayName: person.displayName,
        organizationRole: person.primaryRole,
        jobRoleId: shift.jobRoleId,
        jobName: job?.name ?? "Unknown role",
        minutes:
          (existing?.minutes ?? 0) +
          minutesFromIso(shift.startsAt, shift.endsAt, shift.unpaidBreakMinutes),
        sourceLabel: existing ? "Multiple scheduled segments" : "Scheduled minutes",
        policyEligible: rule.eligibleJobRoleIds.includes(shift.jobRoleId),
        defaultWeight: rule.roleWeights[shift.jobRoleId] ?? 0,
      });
    }
  }

  const participants = [...participantMap.values()].sort((left, right) =>
    left.personId.localeCompare(right.personId),
  );
  return {
    locationId,
    draft: {
      businessDate: closeout.businessDate,
      covers: String(closeout.covers),
      grossSales: centsInput(closeout.grossSalesCents),
      cashSales: centsInput(closeout.cashSalesCents),
      cardSales: centsInput(closeout.cardSalesCents),
      comps: centsInput(closeout.compsCents),
      voids: centsInput(closeout.voidsCents),
      expectedCash: centsInput(closeout.expectedCashCents),
      actualCash: centsInput(closeout.actualCashCents),
      notes: closeout.notes,
      cashTips: centsInput(sourceRun?.cashTipsCents ?? 0),
      cardTips: centsInput(sourceRun?.cardTipsCents ?? 0),
      serviceCharges: centsInput(sourceRun?.serviceChargesCents ?? 0),
    },
    participants,
    weights: Object.fromEntries(
      participants.map((participant) => [participant.personId, participant.defaultWeight.toFixed(2)]),
    ),
  };
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  disabled,
  detail,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  detail?: string;
}) {
  const valid = parseCents(value) !== null;
  return (
    <label htmlFor={id} className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-4 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{label}</span>
        {detail ? <span className="mt-1 block text-xs leading-4 text-[var(--ink-faint)]">{detail}</span> : null}
      </span>
      <span className={cn("flex h-10 items-center rounded-xl border bg-[var(--paper-strong)] px-3", valid ? "border-[var(--line)]" : "border-[var(--danger)]")}>
        <span className="mr-1 text-[13px] text-[var(--ink-faint)]">$</span>
        <input
          id={id}
          value={value}
          disabled={disabled}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!valid}
          className="numeric min-w-0 flex-1 bg-transparent text-right text-xs font-semibold outline-none disabled:opacity-60"
        />
      </span>
    </label>
  );
}

function sourceStatus(status: CloseoutStatus) {
  if (status === "approved") return { tone: "positive" as const, label: "Approved & locked" };
  if (status === "submitted") return { tone: "warning" as const, label: "Awaiting owner" };
  return { tone: "accent" as const, label: "Working draft" };
}

export function CloseoutWorkspace() {
  const workspace = useWorkspaceContext();
  const currentUserId = workspace.identity.userId;
  const currentDisplayName = workspace.identity.displayName;
  const initialScenario = useMemo(() => scenarioForLocation(demoIds.locations.garden), []);
  const [scenario, setScenario] = useState(initialScenario);
  const [draft, setDraft] = useState(initialScenario.draft);
  const [weights, setWeights] = useState(initialScenario.weights);
  const [adjustments, setAdjustments] = useState<Record<string, string>>({});
  const [exclusions, setExclusions] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<CloseoutStatus>("draft");
  const [submittedBy, setSubmittedBy] = useState<{
    userId: string;
    displayName: string;
  } | null>(null);
  const [calculation, setCalculation] = useState<TipPoolCalculation | null>(null);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const attachmentRef = useRef<HTMLInputElement>(null);
  const rule = demoWorkspace.tipPoolRules[0];
  const location = demoWorkspace.locations.find((item) => item.id === scenario.locationId)!;
  const locked = status !== "draft";

  const financial = useMemo(() => {
    const parsed = Object.fromEntries(
      MONEY_KEYS.map((key) => [key, parseCents(draft[key])]),
    ) as Record<MoneyKey, number | null>;
    const allValid = MONEY_KEYS.every((key) => parsed[key] !== null);
    const gross = parsed.grossSales ?? 0;
    const comps = parsed.comps ?? 0;
    const voids = parsed.voids ?? 0;
    const netSales = gross - comps - voids;
    const paymentDifference = (parsed.cashSales ?? 0) + (parsed.cardSales ?? 0) - netSales;
    const cashVariance = (parsed.actualCash ?? 0) - (parsed.expectedCash ?? 0);
    const parsedCovers = /^\d+$/.test(draft.covers) ? Number(draft.covers) : null;
    const covers = parsedCovers !== null && Number.isSafeInteger(parsedCovers) ? parsedCovers : null;
    return { parsed, allValid: allValid && covers !== null, netSales, paymentDifference, cashVariance, covers };
  }, [draft]);

  const tipPoolCents = (financial.parsed.cashTips ?? 0) + (financial.parsed.cardTips ?? 0);
  const currentStatus = sourceStatus(status);

  function invalidateCalculation() {
    setCalculation(null);
    setMessage(null);
  }

  function updateDraft<Key extends keyof DraftValues>(key: Key, value: DraftValues[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    invalidateCalculation();
  }

  function selectLocation(locationId: string) {
    const next = scenarioForLocation(locationId);
    setScenario(next);
    setDraft(next.draft);
    setWeights(next.weights);
    setAdjustments({});
    setExclusions({});
    setStatus("draft");
    setSubmittedBy(null);
    setCalculation(null);
    setExpandedEmployee(null);
    setAttachmentName(null);
    setMessage("Loaded a new local working copy from the selected synthetic closeout.");
  }

  function buildCalculationInputs(): { policy: TipPoolPolicy; run: TipPoolRun } {
    const policy: TipPoolPolicy = {
      id: rule.id,
      organizationId: rule.organizationId,
      locationId: scenario.locationId,
      version: rule.version,
      name: rule.name,
      status: rule.status,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo ?? undefined,
      allocationMethod: rule.method,
      eligibility: { jobCodeIds: rule.eligibleJobRoleIds },
      weights: {
        defaultBasisPoints: 0,
        jobCodeBasisPoints: Object.fromEntries(
          Object.entries(rule.roleWeights).map(([roleId, weight]) => [roleId, Math.round(weight * 10_000)]),
        ),
        employeeBasisPoints: Object.fromEntries(
          scenario.participants.map((participant) => {
            const basisPoints = parseWeightBasisPoints(weights[participant.personId] ?? "");
            if (basisPoints === null) throw new Error(`Enter a valid weight for ${participant.displayName}.`);
            return [participant.personId, basisPoints];
          }),
        ),
      },
      rounding: { method: "largest_remainder", tieBreaker: "employee_id_ascending" },
    };

    const participants: TipParticipant[] = scenario.participants.map((participant) => ({
      employeeId: participant.personId,
      displayName: participant.displayName,
      organizationRole: participant.organizationRole,
      excluded: exclusions[participant.personId] || undefined,
      exclusionReason: exclusions[participant.personId] ? "Excluded by a manager in this draft." : undefined,
      segments: [
        {
          id: `segment-${participant.personId}`,
          jobCodeId: participant.jobRoleId,
          minutes: participant.minutes,
        },
      ],
    }));
    const manualAdjustments = scenario.participants.flatMap((participant) => {
      const amount = parseCents(adjustments[participant.personId] || "0", true);
      if (amount === null) throw new Error(`Enter a valid adjustment for ${participant.displayName}.`);
      return amount === 0
        ? []
        : [
            {
              id: `adjustment-${participant.personId}`,
              employeeId: participant.personId,
              amountCents: amount,
              reason: "Manual closeout adjustment entered by manager.",
              createdBy: currentUserId,
              createdAt: demoWorkspace.asOf,
            },
          ];
    });
    const cashTips = parseCents(draft.cashTips);
    const cardTips = parseCents(draft.cardTips);
    const serviceCharges = parseCents(draft.serviceCharges);
    if (cashTips === null || cardTips === null || serviceCharges === null) {
      throw new Error("Enter valid tip-source amounts before calculating.");
    }

    const run: TipPoolRun = {
      id: `working-${scenario.locationId}-${draft.businessDate}`,
      organizationId: rule.organizationId,
      locationId: scenario.locationId,
      businessDate: draft.businessDate,
      currency: demoWorkspace.organizations[0].currency,
      policyId: rule.id,
      policyVersion: rule.version,
      status: "draft",
      sources: [
        { id: "cash-tips", label: "Cash tips", kind: "cash_tip", amountCents: cashTips, disposition: "pool" },
        { id: "card-tips", label: "Card tips", kind: "card_tip", amountCents: cardTips, disposition: "pool" },
        { id: "service-charges", label: "Service charges", kind: "service_charge", amountCents: serviceCharges, disposition: "separate" },
      ],
      participants,
      adjustments: manualAdjustments,
    };
    return { policy, run };
  }

  function calculate() {
    try {
      const inputs = buildCalculationInputs();
      const result = calculateTipPool(inputs.policy, inputs.run);
      setCalculation(result);
      setMessage("Tip pool calculated and reconciled exactly. Review every explanation before submission.");
    } catch (error) {
      const detail =
        error instanceof TipPoolValidationError
          ? error.issues.map((issue) => issue.message).join(" ")
          : error instanceof Error
            ? error.message
            : "Unable to calculate the tip pool.";
      setMessage(detail);
    }
  }

  function submitCloseout() {
    if (!financial.allValid) {
      setMessage("Complete every closeout field with a valid cent amount and cover count.");
      return;
    }
    if (financial.paymentDifference !== 0) {
      setMessage("Cash and card sales must reconcile exactly to net sales before submission.");
      return;
    }
    if (financial.cashVariance !== 0 && draft.notes.trim().length < 8) {
      setMessage("Explain the cash variance or record the linked correction before submission.");
      return;
    }
    if (!calculation || !calculation.reconciliation.balanced) {
      setMessage("Calculate and review an exactly reconciled tip pool before submission.");
      return;
    }
    setStatus("submitted");
    setSubmittedBy({ userId: currentUserId, displayName: currentDisplayName });
    setMessage(
      "Submitted for owner approval. A different owner must review and approve this closeout.",
    );
  }

  function approveCloseout() {
    if (!calculation || status !== "submitted") return;
    if (workspace.role !== "owner") {
      setMessage("Only an owner can approve a submitted closeout.");
      return;
    }
    if (!submittedBy || submittedBy.userId === currentUserId) {
      setMessage(
        "Separation of duties blocked this approval. A different owner must review the submitted closeout.",
      );
      return;
    }
    try {
      const approved = approveTipPoolCalculation(calculation, {
        approvedBy: currentUserId,
        approvedAt: new Date().toISOString(),
        note: "Closeout and tip reconciliation reviewed in Le Yard OS.",
      });
      setCalculation(approved);
      setStatus("approved");
      setMessage("Owner approval recorded. The closeout and tip calculation are now locked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Approval failed.");
    }
  }

  function returnToDraft() {
    if (status !== "submitted") return;
    setStatus("draft");
    setSubmittedBy(null);
    setMessage("Returned to draft. Recalculate after any change before resubmitting.");
  }

  function downloadPayroll() {
    if (!calculation || calculation.status !== "approved") return;
    const csv = generateTipPayrollCsv(calculation, { includeZeroRows: true });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `le-yard-tips-${scenario.locationId}-${draft.businessDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function allocationFor(participant: ParticipantSource) {
    return calculation?.employees.find(
      (employee) => employee.employeeId === participant.personId,
    );
  }

  function allocationExplanation(
    participant: ParticipantSource,
    surface: "desktop" | "mobile",
  ) {
    const allocation = allocationFor(participant);
    if (!allocation || expandedEmployee !== participant.personId) return null;

    return (
      <div
        id={`explanation-${surface}-${participant.personId}`}
        className="grid gap-4 text-xs leading-4 text-[var(--ink-faint)] lg:grid-cols-[1fr_1fr_auto]"
      >
        <div>
          <strong className="block text-xs text-[var(--ink)]">Eligibility</strong>
          <span>{allocation.explanation.eligibilityNote}</span>
          <span className="mt-1 block">
            {allocation.explanation.segments.map((segment) => segment.note).join(" ")}
          </span>
        </div>
        <div>
          <strong className="block text-xs text-[var(--ink)]">Exact share</strong>
          <span className="font-mono">
            {allocation.explanation.exactShareNumerator} / {allocation.explanation.exactShareDenominator}
          </span>
          <span className="mt-1 block">
            Floor {allocation.explanation.floorShareCents}¢ + rounding {allocation.explanation.roundingAwardCents}¢
          </span>
        </div>
        <div className="lg:text-right">
          <strong className="block text-xs text-[var(--ink)]">Reconciled</strong>
          <span>{allocation.explanation.reconciliation}</span>
        </div>
      </div>
    );
  }

  const allocationColumns: readonly ResponsiveDataColumn<ParticipantSource>[] = [
    {
      key: "member",
      label: "Team member / job",
      render: (participant) => {
        const allocation = allocationFor(participant);
        const expanded = expandedEmployee === participant.personId;
        return (
          <button
            type="button"
            disabled={!allocation}
            aria-expanded={expanded}
            aria-controls={`explanation-desktop-${participant.personId}`}
            onClick={() => setExpandedEmployee(expanded ? null : participant.personId)}
            className="focus-ring flex min-h-11 items-center gap-3 rounded-xl text-left disabled:cursor-default"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--canvas-strong)] text-xs font-semibold">
              {participant.displayName.slice(0, 1)}
            </span>
            <span>
              <span className="block text-[13px] font-semibold text-[var(--ink)]">
                {participant.displayName}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-faint)]">
                {participant.jobName} · {participant.sourceLabel}
                {allocation ? (
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform motion-reduce:transition-none",
                      expanded && "rotate-180",
                    )}
                  />
                ) : null}
              </span>
            </span>
          </button>
        );
      },
    },
    {
      key: "eligible-time",
      label: "Eligible time",
      align: "right",
      render: (participant) => `${(participant.minutes / 60).toFixed(2)}h`,
    },
    {
      key: "points",
      label: "Points",
      align: "right",
      render: (participant) => (
        <input
          aria-label={`${participant.displayName} tip points`}
          value={weights[participant.personId] ?? ""}
          disabled={locked || !participant.policyEligible}
          onChange={(event) => {
            setWeights((current) => ({
              ...current,
              [participant.personId]: event.target.value,
            }));
            invalidateCalculation();
          }}
          className="numeric h-11 w-20 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2 text-right text-xs font-semibold outline-none disabled:opacity-45"
        />
      ),
    },
    {
      key: "adjustment",
      label: "Adjustment",
      align: "right",
      render: (participant) => (
        <span className="inline-flex h-11 w-24 items-center rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2">
          <span className="text-xs text-[var(--ink-faint)]">$</span>
          <input
            aria-label={`${participant.displayName} adjustment`}
            value={adjustments[participant.personId] ?? "0.00"}
            disabled={locked}
            onChange={(event) => {
              setAdjustments((current) => ({
                ...current,
                [participant.personId]: event.target.value,
              }));
              invalidateCalculation();
            }}
            className="numeric min-w-0 flex-1 bg-transparent text-right text-xs font-semibold outline-none disabled:opacity-45"
          />
        </span>
      ),
    },
    {
      key: "allocation",
      label: "Allocation",
      align: "right",
      render: (participant) => {
        const allocation = allocationFor(participant);
        return (
          <>
            {allocation ? formatMoney(allocation.totalTipCents) : "—"}
            <span className="mt-1 block text-xs font-normal text-[var(--ink-faint)]">
              {allocation?.explanation.eligibilityCode.replaceAll("_", " ") ??
                (participant.policyEligible ? "Pending" : "Policy excluded")}
            </span>
          </>
        );
      },
    },
    {
      key: "include",
      label: "Include",
      align: "right",
      render: (participant) => (
        <label className="inline-flex min-h-11 items-center gap-2 text-xs text-[var(--ink-faint)]">
          <input
            type="checkbox"
            checked={!exclusions[participant.personId]}
            disabled={locked}
            onChange={(event) => {
              setExclusions((current) => ({
                ...current,
                [participant.personId]: !event.target.checked,
              }));
              invalidateCalculation();
            }}
            className="size-5 accent-[var(--accent)]"
          />
          <span>{exclusions[participant.personId] ? "Excluded" : "Included"}</span>
        </label>
      ),
    },
  ];

  return (
    <PageFrame width="full" className="max-w-[1700px]">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={currentStatus.tone} dot>{currentStatus.label}</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">{rule.name} · Policy v{rule.version}</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Closeout & tips</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">Sales, cash, tip allocation, and owner approval in one audit path.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--ink-faint)]">Location</span>
            <select
              value={scenario.locationId}
              disabled={locked}
              onChange={(event) => selectLocation(event.target.value)}
              className="h-10 min-w-[190px] rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-[13px] font-semibold outline-none"
            >
              {demoWorkspace.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--ink-faint)]">Business date</span>
            <input
              type="date"
              value={draft.businessDate}
              disabled={locked}
              onChange={(event) => updateDraft("businessDate", event.target.value)}
              className="h-10 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-[13px] font-semibold outline-none"
            />
          </label>
        </div>
      </header>

      <section aria-label="Closeout metrics" className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Net sales" value={formatMoney(financial.netSales)} detail={`Gross less ${formatMoney((financial.parsed.comps ?? 0) + (financial.parsed.voids ?? 0))}`} />
        <Metric label="Covers" value={financial.covers === null ? "—" : String(financial.covers)} detail={financial.covers ? `${formatMoney(Math.round(financial.netSales / financial.covers))} per cover` : "Enter cover count"} />
        <Metric label="Cash variance" value={formatMoney(financial.cashVariance)} detail="Actual less expected" trend={{ label: financial.cashVariance === 0 ? "Exact" : "Review", tone: financial.cashVariance === 0 ? "positive" : "negative" }} />
        <Metric label="Tip pool" value={formatMoney(tipPoolCents)} detail={`${formatMoney(financial.parsed.serviceCharges ?? 0)} service charge separate`} />
      </section>

      <div className="mt-8 grid gap-10 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <section>
          <SectionHeading eyebrow="01 / Sales ledger" title="Service summary" detail="All money fields are parsed to integer cents before reconciliation." />
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            <label className="grid grid-cols-[minmax(0,1fr)_132px] items-center gap-4 py-3">
              <span><span className="block text-[13px] font-semibold">Covers</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">Completed guests for the close</span></span>
              <input value={draft.covers} disabled={locked} inputMode="numeric" onChange={(event) => updateDraft("covers", event.target.value)} className="numeric h-10 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-right text-xs font-semibold outline-none disabled:opacity-60" />
            </label>
            <MoneyField id="gross-sales" label="Gross sales" value={draft.grossSales} onChange={(value) => updateDraft("grossSales", value)} disabled={locked} />
            <MoneyField id="cash-sales" label="Cash sales" value={draft.cashSales} onChange={(value) => updateDraft("cashSales", value)} disabled={locked} />
            <MoneyField id="card-sales" label="Card sales" value={draft.cardSales} onChange={(value) => updateDraft("cardSales", value)} disabled={locked} />
            <MoneyField id="comps" label="Comps" value={draft.comps} onChange={(value) => updateDraft("comps", value)} disabled={locked} />
            <MoneyField id="voids" label="Voids" value={draft.voids} onChange={(value) => updateDraft("voids", value)} disabled={locked} />
          </div>
          <div className={cn("mt-3 flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-xs", financial.paymentDifference === 0 ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--danger-soft)] text-[var(--danger)]")}>
            <span className="flex items-center gap-2">{financial.paymentDifference === 0 ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />} Cash + card compared with calculated net sales</span>
            <strong className="numeric">{financial.paymentDifference === 0 ? "Exact" : formatMoney(financial.paymentDifference)}</strong>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="02 / Cash proof" title="Drawer reconciliation" detail="A variance is surfaced for human review; no policy threshold is assumed." />
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            <MoneyField id="expected-cash" label="Expected cash" value={draft.expectedCash} onChange={(value) => updateDraft("expectedCash", value)} disabled={locked} detail="Drawer expectation from the close" />
            <MoneyField id="actual-cash" label="Actual cash" value={draft.actualCash} onChange={(value) => updateDraft("actualCash", value)} disabled={locked} detail="Counted cash in drawer" />
            <div className="flex items-center justify-between py-4">
              <span><span className="block text-[13px] font-semibold">Cash variance</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">Actual less expected</span></span>
              <span className={cn("numeric text-lg font-medium tracking-[-0.04em]", financial.cashVariance === 0 ? "text-[var(--positive)]" : "text-[var(--danger)]")}>{formatMoney(financial.cashVariance)}</span>
            </div>
          </div>

          <label className="mt-5 block">
            <span className="mb-2 block text-xs font-semibold">End-of-shift notes</span>
            <textarea value={draft.notes} disabled={locked} onChange={(event) => updateDraft("notes", event.target.value)} rows={4} className="w-full resize-none rounded-[14px] border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-[13px] leading-5 outline-none disabled:opacity-60" />
          </label>

          <input ref={attachmentRef} aria-label="Attach closeout evidence" type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={(event) => setAttachmentName(event.target.files?.[0]?.name ?? null)} />
          <button disabled={locked} onClick={() => attachmentRef.current?.click()} className="focus-ring mt-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] px-3.5 py-3 text-left disabled:opacity-50">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><Paperclip className="size-3.5" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{attachmentName ?? "Attach closeout photo or document"}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">Production files use private storage and signed access.</span></span>
          </button>
        </section>
      </div>

      <section className="mt-11">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">03 / Tip sources</p>
            <h3 className="mt-2 text-base font-semibold tracking-[-0.03em]">Build the distributable pool</h3>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">Policy {rule.id} · version {rule.version} · effective {rule.effectiveFrom}</p>
            <p className="mt-2 text-xs font-semibold text-[var(--ink-soft)]">Point basis: servers 10 · bartenders 10 · support staff 6 · multiplied by eligible hours.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"><ShieldCheck className="size-3.5 text-[var(--positive)]" /> Largest remainder · employee ID tie-break</div>
        </div>

        <div className="mt-5 grid divide-y divide-[var(--line)] border-y border-[var(--line)] md:grid-cols-3 md:divide-x md:divide-y-0">
          {[
            { key: "cashTips" as const, label: "Cash tips", detail: "Included in pool", separate: false },
            { key: "cardTips" as const, label: "Card tips", detail: "Included in pool", separate: false },
            { key: "serviceCharges" as const, label: "Service charges", detail: "Reported outside pool", separate: true },
          ].map((source) => (
            <label key={source.key} className="px-4 py-4 md:px-5">
              <span className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">{source.label}</span><StatusPill tone={source.separate ? "warning" : "positive"}>{source.separate ? "Separate" : "Pooled"}</StatusPill></span>
              <span className="mt-4 flex items-baseline border-b border-[var(--line-strong)] pb-2"><span className="text-sm text-[var(--ink-faint)]">$</span><input value={draft[source.key]} disabled={locked} inputMode="decimal" onChange={(event) => updateDraft(source.key, event.target.value)} className="numeric min-w-0 flex-1 bg-transparent px-2 text-2xl font-medium tracking-[-0.05em] outline-none disabled:opacity-60" /></span>
              <span className="mt-2 block text-xs text-[var(--ink-faint)]">{source.detail}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <SectionHeading
          eyebrow="04 / Allocation"
          title="Eligible shifts, points & adjustments"
          detail="Tip points are multiplied by eligible hours. Expand a calculated row for exact arithmetic."
          action={<Button variant="secondary" size="sm" disabled={locked} onClick={calculate}><Calculator className="size-3.5" /> Calculate tips</Button>}
        />
        <ResponsiveDataView
          items={scenario.participants}
          columns={allocationColumns}
          getItemKey={(participant) => participant.personId}
          label="Tip allocation participants"
          minTableWidth={880}
          empty={
            <ReadState
              compact
              state="empty"
              title="No eligible shifts"
              description="Closed time entries will appear here when they are eligible for this policy."
            />
          }
          renderDetails={(participant) => allocationExplanation(participant, "desktop")}
          renderCard={(participant) => {
            const allocation = allocationFor(participant);
            const expanded = expandedEmployee === participant.personId;
            return (
              <div className="rounded-[16px] border border-[var(--line)] bg-[var(--paper-strong)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    disabled={!allocation}
                    aria-expanded={expanded}
                    aria-controls={`explanation-mobile-${participant.personId}`}
                    onClick={() => setExpandedEmployee(expanded ? null : participant.personId)}
                    className="focus-ring -m-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left disabled:cursor-default"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--canvas-strong)] text-xs font-semibold">
                      {participant.displayName.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold">
                        {participant.displayName}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-faint)]">
                        {participant.jobName} · {(participant.minutes / 60).toFixed(2)}h
                        {allocation ? (
                          <ChevronDown
                            className={cn(
                              "size-3 shrink-0 transition-transform motion-reduce:transition-none",
                              expanded && "rotate-180",
                            )}
                          />
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <label className="flex min-h-11 shrink-0 items-center gap-2 text-xs text-[var(--ink-faint)]">
                    <input
                      type="checkbox"
                      checked={!exclusions[participant.personId]}
                      disabled={locked}
                      onChange={(event) => {
                        setExclusions((current) => ({
                          ...current,
                          [participant.personId]: !event.target.checked,
                        }));
                        invalidateCalculation();
                      }}
                      className="size-5 accent-[var(--accent)]"
                    />
                    <span className="sr-only">
                      Include {participant.displayName} in the tip pool
                    </span>
                  </label>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-[var(--ink-faint)]">
                    Points
                    <input
                      aria-label={`${participant.displayName} mobile tip points`}
                      value={weights[participant.personId] ?? ""}
                      disabled={locked || !participant.policyEligible}
                      onChange={(event) => {
                        setWeights((current) => ({
                          ...current,
                          [participant.personId]: event.target.value,
                        }));
                        invalidateCalculation();
                      }}
                      className="numeric mt-1.5 h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-right text-base font-semibold text-[var(--ink)] outline-none disabled:opacity-45"
                    />
                  </label>
                  <label className="text-xs font-semibold text-[var(--ink-faint)]">
                    Adjustment
                    <span className="mt-1.5 flex h-11 items-center rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3">
                      <span className="text-xs">$</span>
                      <input
                        aria-label={`${participant.displayName} mobile adjustment`}
                        value={adjustments[participant.personId] ?? "0.00"}
                        disabled={locked}
                        onChange={(event) => {
                          setAdjustments((current) => ({
                            ...current,
                            [participant.personId]: event.target.value,
                          }));
                          invalidateCalculation();
                        }}
                        className="numeric min-w-0 flex-1 bg-transparent text-right text-base font-semibold text-[var(--ink)] outline-none disabled:opacity-45"
                      />
                    </span>
                  </label>
                </div>

                <div className="mt-4 flex items-end justify-between gap-3 border-t border-[var(--line)] pt-3">
                  <div>
                    <p className="text-xs font-semibold text-[var(--ink-faint)]">Allocation</p>
                    <p className="numeric mt-1 text-base font-semibold">
                      {allocation ? formatMoney(allocation.totalTipCents) : "—"}
                    </p>
                  </div>
                  <StatusPill tone={exclusions[participant.personId] ? "warning" : "positive"}>
                    {exclusions[participant.personId] ? "Excluded" : "Included"}
                  </StatusPill>
                </div>

                {allocationExplanation(participant, "mobile") ? (
                  <div className="mt-4 border-t border-[var(--line)] pt-4">
                    {allocationExplanation(participant, "mobile")}
                  </div>
                ) : null}
              </div>
            );
          }}
        />

        {calculation ? (
          <div className="mt-4 grid gap-3 rounded-[16px] bg-[var(--graphite)] px-5 py-4 text-white sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div><p className="text-xs font-semibold">Exact reconciliation</p><p className="mt-1 text-xs text-white/55">Pool {formatMoney(calculation.totals.pooledTipCents)} + adjustments {formatMoney(calculation.totals.adjustmentCents)} = payroll tips {formatMoney(calculation.totals.payrollTipCents)}</p></div>
            <div className="numeric text-sm font-semibold">Difference {formatMoney(calculation.reconciliation.payrollDifferenceCents)}</div>
            <StatusPill tone="positive"><Check className="size-3" /> Balanced</StatusPill>
          </div>
        ) : null}
      </section>

      <AnimatePresence mode="wait">
        {message ? <motion.div key={message} role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-6 flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/55 px-4 py-3 text-xs leading-4 text-[var(--ink-soft)]"><FileText className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-strong)]" />{message}</motion.div> : null}
      </AnimatePresence>

      <StickyActionBar
        label="Closeout workflow actions"
        title={`${location.name} · ${draft.businessDate}`}
        detail={
          status === "draft"
            ? "Manager draft · calculate before submitting"
            : status === "submitted"
              ? submittedBy
                ? `Submitted by ${submittedBy.displayName} · a different owner must approve`
                : "Awaiting a different owner approval"
              : `Locked by ${currentDisplayName}`
        }
        icon={
          status === "approved" ? (
            <LockKeyhole className="size-4 text-[var(--positive)]" />
          ) : (
            <WalletCards className="size-4 text-[var(--accent)]" />
          )
        }
        actions={
          <>
          {status === "draft" ? <><Button variant="secondary" size="sm" className="border-white/15 bg-white/10 text-white hover:bg-white/15" onClick={calculate}><Calculator className="size-3.5" /> Calculate</Button><Button variant="accent" size="sm" onClick={submitCloseout}><ShieldCheck className="size-3.5" /> Submit closeout</Button></> : null}
          {status === "submitted" ? <><Button variant="quiet" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={returnToDraft}><RotateCcw className="size-3.5" /> Return to draft</Button><Button variant="accent" size="sm" onClick={approveCloseout} disabled={workspace.role !== "owner" || !submittedBy || submittedBy.userId === currentUserId} aria-describedby="closeout-approval-separation-note"><Check className="size-3.5" /> Owner approve</Button><span id="closeout-approval-separation-note" className="sr-only">Only a different owner from the submitter can approve this closeout.</span></> : null}
          {status === "approved" ? <Button variant="accent" size="sm" onClick={downloadPayroll}><ArrowDownToLine className="size-3.5" /> Payroll CSV</Button> : null}
          </>
        }
      />
    </PageFrame>
  );
}
