"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Gauge,
  LayoutTemplate,
  LockKeyhole,
  MessageSquareText,
  RadioTower,
  ShieldCheck,
  TimerReset,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useMemo, useState } from "react";
import {
  approveReservationDraftAction,
  configureServiceShiftExceptionAction,
  installReservationDraftAction,
  revokeServiceShiftExceptionAction,
} from "@/app/actions/workflows/reservations";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FormField } from "@/components/ui/form-field";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
  Metric,
  PageFrame,
  PageHeader,
  SectionHeading,
} from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import type { ReservationHostModel } from "@/lib/reservations/model";
import {
  buildServiceShiftBoundaryOptions,
  formatServiceShiftBoundary,
  serviceShiftExceptionLabel,
  type ServiceShiftExceptionKind,
  type ServiceShiftExceptionSummary,
  type ServiceShiftManagementModel,
} from "@/lib/reservations/service-shift-management";
import { cn } from "@/lib/utils";

function integerField(form: FormData, name: string): number | null {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) ? value : null;
}

export function ReservationSetupWorkspace({
  workspace,
  model,
  serviceShifts,
  serviceShiftError,
}: {
  workspace: WorkspaceContextValue;
  model: ReservationHostModel;
  serviceShifts: ServiceShiftManagementModel;
  serviceShiftError?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [exceptionKind, setExceptionKind] =
    useState<ServiceShiftExceptionKind>("closure");
  const [selectedShiftId, setSelectedShiftId] = useState(
    serviceShifts.shifts[0]?.id ?? "",
  );
  const [revokeTarget, setRevokeTarget] =
    useState<ServiceShiftExceptionSummary | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const configurePermissionId = useId();
  const overridePermissionId = useId();
  const revokeDialogTitleId = useId();
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const canConfigure = model.permissions.configure;
  const canOverride = model.permissions.override;
  const selectedShift =
    serviceShifts.shifts.find((shift) => shift.id === selectedShiftId) ??
    serviceShifts.shifts[0] ??
    null;
  const boundaryOptions = useMemo(
    () =>
      selectedShift
        ? buildServiceShiftBoundaryOptions(
            selectedShift,
            serviceShifts.timeZone,
          )
        : [],
    [selectedShift, serviceShifts.timeZone],
  );

  async function installDraft() {
    if (!canConfigure) {
      setMessage(
        "Reservation configuration is read only for your current assignment.",
      );
      return;
    }
    const payload = { locationId: workspace.activeLocation.id };
    setBusy(true);
    setMessage("");
    const result = await installReservationDraftAction({
      ...payload,
      requestId: requestIdFor("reservation-install-draft", payload),
    });
    setBusy(false);
    setMessage(
      result.ok
        ? "Draft installed. Inspect every table on site before approval."
        : result.message,
    );
    if (result.ok) {
      rotateRequestId("reservation-install-draft");
      router.refresh();
    }
  }

  async function approveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canConfigure) {
      setMessage(
        "Reservation configuration is read only for your current assignment.",
      );
      return;
    }
    const form = new FormData(event.currentTarget);
    const payload = {
      locationId: workspace.activeLocation.id,
      enableOnline: form.get("enableOnline") === "on",
      enableMessaging: form.get("enableMessaging") === "on",
      enableStaffPush: form.get("enableStaffPush") === "on",
      verificationNote: String(form.get("verificationNote") || ""),
      verifiedOnSite: form.get("verifiedOnSite") === "on",
    };
    setBusy(true);
    setMessage("");
    const result = await approveReservationDraftAction({
      ...payload,
      requestId: requestIdFor("reservation-approve-draft", payload),
    });
    setBusy(false);
    setMessage(
      result.ok
        ? "Reservation floor and service rules approved."
        : result.message,
    );
    if (result.ok) {
      rotateRequestId("reservation-approve-draft");
      router.refresh();
    }
  }

  async function configureException(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!canOverride || !selectedShift) {
      setMessage(
        "Service exceptions require the exact reservations.override capability for this location.",
      );
      return;
    }
    const form = new FormData(formElement);
    const payload = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      serviceShiftId: selectedShift.id,
      exceptionKind,
      effectiveStartsAt:
        exceptionKind === "buffer_override"
          ? selectedShift.startsAt
          : String(form.get("effectiveStartsAt") ?? ""),
      effectiveEndsAt:
        exceptionKind === "buffer_override"
          ? selectedShift.endsAt
          : String(form.get("effectiveEndsAt") ?? ""),
      pacingIntervalMinutes:
        exceptionKind === "pacing_override"
          ? integerField(form, "pacingIntervalMinutes")
          : null,
      pacingCoverLimit:
        exceptionKind === "pacing_override"
          ? integerField(form, "pacingCoverLimit")
          : null,
      openingBufferMinutes:
        exceptionKind === "buffer_override"
          ? integerField(form, "openingBufferMinutes")
          : null,
      closingBufferMinutes:
        exceptionKind === "buffer_override"
          ? integerField(form, "closingBufferMinutes")
          : null,
      reason: String(form.get("reason") ?? ""),
      active: true as const,
    };
    const scope = `service-shift-exception-${selectedShift.id}`;
    setBusy(true);
    setMessage("");
    const result = await configureServiceShiftExceptionAction({
      ...payload,
      requestId: requestIdFor(scope, payload),
    });
    setBusy(false);
    setMessage(
      result.ok
        ? `${serviceShiftExceptionLabel(exceptionKind)} recorded for ${selectedShift.name}.`
        : result.message,
    );
    if (result.ok) {
      rotateRequestId(scope);
      formElement.reset();
      router.refresh();
    }
  }

  async function revokeException() {
    if (!canOverride || !revokeTarget) return;
    const payload = {
      exceptionId: revokeTarget.id,
      reason: revokeReason,
    };
    const scope = `service-shift-exception-revoke-${revokeTarget.id}`;
    setBusy(true);
    setMessage("");
    const result = await revokeServiceShiftExceptionAction({
      ...payload,
      requestId: requestIdFor(scope, payload),
    });
    setBusy(false);
    setMessage(
      result.ok
        ? `${serviceShiftExceptionLabel(revokeTarget.kind)} revoked.`
        : result.message,
    );
    if (result.ok) {
      rotateRequestId(scope);
      setRevokeTarget(null);
      setRevokeReason("");
      router.refresh();
    }
  }

  function selectBusinessDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      router.push(`/reservations/setup?date=${encodeURIComponent(value)}`);
    }
  }

  return (
    <PageFrame width="standard">
      <PageHeader
        eyebrow={`${workspace.activeLocation.name} · Owner-controlled`}
        title="Reservation setup"
        detail="Install the measured-plan draft, verify the physical room, then explicitly approve staff and public booking controls."
        status={
          <StatusPill
            tone={model.configuration.ready ? "positive" : "warning"}
            dot
          >
            {model.configuration.ready ? "Approved" : "Fail-closed"}
          </StatusPill>
        }
        actions={
          <Link
            href="/reservations"
            className={cn(buttonVariants({ variant: "secondary" }))}
          >
            <ArrowLeft className="size-4" />
            Host stand
          </Link>
        }
      />
      {message ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-sm"
        >
          {message}
        </p>
      ) : null}
      {!canConfigure ? (
        <InlineNotice
          id={configurePermissionId}
          className="mt-4"
          title="Read-only reservation configuration"
        >
          Installing, resetting, or approving reservation rules requires the
          exact reservations.configure capability for this location.
        </InlineNotice>
      ) : null}
      <div className="mt-6 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric
          label="Tables"
          value={String(model.configuration.tableCount)}
          detail="Expected 17"
        />
        <Metric
          label="Seats"
          value={String(model.configuration.seatCount)}
          detail="Expected 68"
        />
        <Metric
          label="Public booking"
          value={model.configuration.onlineBookingEnabled ? "Live" : "Off"}
          detail="Owner-approved only"
        />
        <Metric
          label="Messaging"
          value={model.configuration.messagingEnabled ? "On" : "Off"}
          detail="Resend + Twilio"
        />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[.85fr_1.15fr]">
        <div className="space-y-6">
          <Surface variant="outlined" padding="lg">
            <SectionHeading
              eyebrow="Step 1"
              title="Install the draft"
              detail="Seeds a disabled 17-table, 68-seat room from the measured floor-plan project plus a conservative dinner service. It does not enable online booking."
            />
            <div className="rounded-2xl bg-[var(--canvas)] p-4 text-xs leading-5 text-[var(--ink-faint)]">
              <LayoutTemplate className="mb-3 size-5 text-[var(--accent-strong)]" />
              The source drawing is authoritative for the shell dimensions.
              Exact table positions and operating aisles remain assumptions
              until physically checked.
            </div>
            <Button
              className="mt-5 w-full"
              variant="secondary"
              onClick={installDraft}
              disabled={busy || !canConfigure}
              aria-describedby={canConfigure ? undefined : configurePermissionId}
            >
              {busy ? "Installing…" : "Install or reset draft"}
            </Button>
          </Surface>
          <Surface variant="inset" padding="lg">
            <div className="flex gap-3">
              <LockKeyhole className="mt-0.5 size-5 shrink-0 text-[var(--warning)]" />
              <div>
                <p className="text-sm font-semibold">Safe by default</p>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
                  Draft tables are not bookable, service periods are offline,
                  and public availability returns unavailable until the approval
                  command succeeds.
                </p>
              </div>
            </div>
          </Surface>
        </div>
        <Surface variant="raised" padding="lg">
          <SectionHeading
            eyebrow="Step 2"
            title="Verify and approve"
            detail="Complete this only while standing in the room with the service team. Approval and the verification note are written to the audit trail."
          />
          <form
            onSubmit={approveDraft}
            className="space-y-5"
            aria-describedby={canConfigure ? undefined : configurePermissionId}
          >
            <label className="flex items-start gap-3 rounded-2xl border border-[var(--line)] p-4">
              <input
                name="verifiedOnSite"
                type="checkbox"
                required
                disabled={!canConfigure}
                className="mt-1 size-4 accent-[var(--accent-strong)]"
              />
              <span>
                <strong className="block text-sm">
                  I verified the floor on site
                </strong>
                <small className="mt-1 block text-xs leading-5 text-[var(--ink-faint)]">
                  17 tables, 68 seats, labels, safe aisle clearances, exits, and
                  non-bookable service areas match the operating room.
                </small>
              </span>
            </label>
            <label>
              <span className="mb-2 block text-xs font-semibold">
                Verification note
              </span>
              <textarea
                name="verificationNote"
                required
                minLength={12}
                maxLength={1000}
                disabled={!canConfigure}
                placeholder="Verified with the FOH lead on site; note any adjusted table labels or clearances."
                className="min-h-28 w-full rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-4 text-sm leading-6 outline-none focus:border-[var(--accent)]"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="rounded-2xl border border-[var(--line)] p-4">
                <RadioTower className="size-4 text-[var(--accent-strong)]" />
                <span className="mt-3 block text-xs font-semibold">
                  Public booking
                </span>
                <input
                  className="mt-3 size-4 accent-[var(--accent-strong)]"
                  type="checkbox"
                  name="enableOnline"
                  disabled={!canConfigure}
                />
              </label>
              <label className="rounded-2xl border border-[var(--line)] p-4">
                <MessageSquareText className="size-4 text-[var(--accent-strong)]" />
                <span className="mt-3 block text-xs font-semibold">
                  Email + SMS
                </span>
                <input
                  className="mt-3 size-4 accent-[var(--accent-strong)]"
                  type="checkbox"
                  name="enableMessaging"
                  disabled={!canConfigure}
                />
              </label>
              <label className="rounded-2xl border border-[var(--line)] p-4">
                <ShieldCheck className="size-4 text-[var(--accent-strong)]" />
                <span className="mt-3 block text-xs font-semibold">
                  Staff push
                </span>
                <input
                  className="mt-3 size-4 accent-[var(--accent-strong)]"
                  type="checkbox"
                  name="enableStaffPush"
                  disabled={!canConfigure}
                />
              </label>
            </div>
            {model.configuration.tableCount !== 17 ||
            model.configuration.seatCount !== 68 ? (
              <div className="flex gap-3 rounded-2xl bg-[var(--warning-soft)] p-4 text-xs leading-5">
                <AlertTriangle className="size-4 shrink-0 text-[var(--warning)]" />
                Install the complete draft before approval. The database also
                enforces the expected table and seat totals.
              </div>
            ) : (
              <div className="flex gap-3 rounded-2xl bg-[var(--positive-soft)] p-4 text-xs leading-5">
                <CheckCircle2 className="size-4 shrink-0 text-[var(--positive)]" />
                The draft totals match. Physical verification is still required.
              </div>
            )}
            <Button
              type="submit"
              variant="accent"
              className="w-full"
              disabled={
                busy ||
                !canConfigure ||
                model.configuration.tableCount !== 17 ||
                model.configuration.seatCount !== 68
              }
            >
              {busy ? "Saving approval…" : "Approve reservation system"}
            </Button>
          </form>
        </Surface>
      </div>
      <section className="mt-12 border-t border-[var(--line)] pt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            eyebrow="Service-day controls"
            title="Closures, pacing, and buffers"
            detail="Record dated exceptions against the materialized service. Availability and database writes enforce the same evidence."
          />
          <FormField
            id="service-control-date"
            label="Operating date"
            description={serviceShifts.timeZone}
            className="w-full sm:w-56"
          >
            <input
              type="date"
              value={serviceShifts.businessDate}
              onChange={(event) => selectBusinessDate(event.target.value)}
            />
          </FormField>
        </div>
        {!canOverride ? (
          <InlineNotice
            id={overridePermissionId}
            className="mt-5"
            tone="warning"
            title="Service exceptions are read only"
          >
            Creating or revoking a closure, pacing override, or booking buffer
            requires the exact reservations.override capability for this
            location and operating date.
          </InlineNotice>
        ) : null}
        {serviceShiftError ? (
          <InlineNotice
            className="mt-5"
            tone="danger"
            announce="polite"
            title="Service controls unavailable"
          >
            {serviceShiftError}
          </InlineNotice>
        ) : !serviceShifts.shifts.length ? (
          <InlineNotice
            className="mt-5"
            title="No materialized service"
          >
            No approved recurring service applies to this operating date.
            Configure and approve a service period before recording an
            exception.
          </InlineNotice>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
            <div className="space-y-4">
              {serviceShifts.shifts.map((shift) => {
                const closed = shift.exceptions.some(
                  (exception) => exception.kind === "closure",
                );
                return (
                  <Surface key={shift.id} variant="outlined" padding="lg">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold">{shift.name}</p>
                        <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">
                          {formatServiceShiftBoundary(
                            shift.startsAt,
                            serviceShifts.timeZone,
                          )}{" "}
                          →{" "}
                          {formatServiceShiftBoundary(
                            shift.endsAt,
                            serviceShifts.timeZone,
                          )}
                        </p>
                      </div>
                      <StatusPill tone={closed ? "danger" : "positive"} dot>
                        {closed ? "Closure active" : shift.configurationState}
                      </StatusPill>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      <div className="rounded-xl bg-[var(--canvas)] p-3">
                        <span className="block text-[var(--ink-faint)]">
                          Turn
                        </span>
                        <strong className="mt-1 block">
                          {shift.defaultDurationMinutes} min
                        </strong>
                      </div>
                      <div className="rounded-xl bg-[var(--canvas)] p-3">
                        <span className="block text-[var(--ink-faint)]">
                          Pacing
                        </span>
                        <strong className="mt-1 block">
                          {shift.pacingCoverLimit} / {shift.pacingIntervalMinutes}m
                        </strong>
                      </div>
                      <div className="rounded-xl bg-[var(--canvas)] p-3">
                        <span className="block text-[var(--ink-faint)]">
                          Party
                        </span>
                        <strong className="mt-1 block">
                          {shift.minPartySize}–{shift.maxPartySize}
                        </strong>
                      </div>
                      <div className="rounded-xl bg-[var(--canvas)] p-3">
                        <span className="block text-[var(--ink-faint)]">
                          Public
                        </span>
                        <strong className="mt-1 block">
                          {shift.onlineEnabled ? "Approved" : "Off"}
                        </strong>
                      </div>
                    </div>
                    <div className="mt-5 border-t border-[var(--line)] pt-4">
                      <p className="text-xs font-semibold tracking-wide text-[var(--ink-faint)] uppercase">
                        Active evidence
                      </p>
                      {shift.exceptions.length ? (
                        <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">
                          {shift.exceptions.map((exception) => (
                            <div
                              key={exception.id}
                              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"
                            >
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning)]">
                                {exception.kind === "closure" ? (
                                  <XCircle className="size-4" />
                                ) : exception.kind === "pacing_override" ? (
                                  <Gauge className="size-4" />
                                ) : (
                                  <TimerReset className="size-4" />
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold">
                                  {serviceShiftExceptionLabel(exception.kind)}
                                </p>
                                <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">
                                  {formatServiceShiftBoundary(
                                    exception.startsAt,
                                    serviceShifts.timeZone,
                                  )}{" "}
                                  →{" "}
                                  {formatServiceShiftBoundary(
                                    exception.endsAt,
                                    serviceShifts.timeZone,
                                  )}
                                  {exception.pacingCoverLimit !== null
                                    ? ` · ${exception.pacingCoverLimit} covers / ${exception.pacingIntervalMinutes}m`
                                    : ""}
                                  {exception.openingBufferMinutes !== null
                                    ? ` · ${exception.openingBufferMinutes}m opening / ${exception.closingBufferMinutes}m closing`
                                    : ""}
                                </p>
                                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                                  {exception.reason}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy || !canOverride}
                                aria-describedby={
                                  canOverride ? undefined : overridePermissionId
                                }
                                onClick={() => {
                                  setRevokeTarget(exception);
                                  setRevokeReason("");
                                }}
                              >
                                Revoke
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-[var(--ink-faint)]">
                          No active exceptions. The approved service policy is
                          in force.
                        </p>
                      )}
                    </div>
                  </Surface>
                );
              })}
            </div>
            <Surface variant="raised" padding="lg">
              <SectionHeading
                eyebrow="Audited override"
                title="Record an exception"
                detail="Choose exact boundaries from the materialized service. Existing reservations are not cancelled automatically."
              />
              <form
                key={`${selectedShift?.id ?? "none"}-${exceptionKind}`}
                onSubmit={configureException}
                className="space-y-4"
                aria-describedby={
                  canOverride ? undefined : overridePermissionId
                }
              >
                <FormField id="service-shift-id" label="Service">
                  <select
                    name="serviceShiftId"
                    value={selectedShift?.id ?? ""}
                    onChange={(event) => setSelectedShiftId(event.target.value)}
                    disabled={busy || !canOverride}
                  >
                    {serviceShifts.shifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {shift.name} ·{" "}
                        {formatServiceShiftBoundary(
                          shift.startsAt,
                          serviceShifts.timeZone,
                        )}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  id="service-exception-kind"
                  label="Exception type"
                  required
                >
                  <select
                    name="exceptionKind"
                    value={exceptionKind}
                    onChange={(event) =>
                      setExceptionKind(
                        event.target.value as ServiceShiftExceptionKind,
                      )
                    }
                    disabled={busy || !canOverride}
                  >
                    <option value="closure">Closure</option>
                    <option value="pacing_override">Pacing override</option>
                    <option value="buffer_override">
                      Booking buffer override
                    </option>
                  </select>
                </FormField>
                {exceptionKind !== "buffer_override" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      id="service-exception-start"
                      label="Starts"
                      required
                    >
                      <select
                        name="effectiveStartsAt"
                        defaultValue={boundaryOptions[0]?.value}
                        disabled={busy || !canOverride}
                      >
                        {boundaryOptions.slice(0, -1).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      id="service-exception-end"
                      label="Ends"
                      required
                    >
                      <select
                        name="effectiveEndsAt"
                        defaultValue={boundaryOptions.at(-1)?.value}
                        disabled={busy || !canOverride}
                      >
                        {boundaryOptions.slice(1).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                  </div>
                ) : (
                  <InlineNotice tone="info" title="Whole-service policy">
                    Booking buffers apply to the full {selectedShift?.name ?? "service"}
                    {" "}shift. They change the first and last bookable start;
                    they do not change the physical opening time.
                  </InlineNotice>
                )}
                {exceptionKind === "pacing_override" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      id="service-pacing-interval"
                      label="Pacing interval"
                      required
                    >
                      <select
                        name="pacingIntervalMinutes"
                        defaultValue={String(
                          selectedShift?.pacingIntervalMinutes ?? 15,
                        )}
                        disabled={busy || !canOverride}
                      >
                        {[5, 10, 15, 20, 30, 60].map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} minutes
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      id="service-pacing-limit"
                      label="Cover limit"
                      required
                    >
                      <input
                        name="pacingCoverLimit"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={10_000}
                        defaultValue={selectedShift?.pacingCoverLimit ?? 14}
                        disabled={busy || !canOverride}
                      />
                    </FormField>
                  </div>
                ) : null}
                {exceptionKind === "buffer_override" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      id="service-opening-buffer"
                      label="Opening buffer"
                      description="Minutes after service start before the first bookable slot."
                      required
                    >
                      <input
                        name="openingBufferMinutes"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={360}
                        defaultValue={0}
                        disabled={busy || !canOverride}
                      />
                    </FormField>
                    <FormField
                      id="service-closing-buffer"
                      label="Closing buffer"
                      description="Minutes before service end by which a full turn must finish."
                      required
                    >
                      <input
                        name="closingBufferMinutes"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={360}
                        defaultValue={0}
                        disabled={busy || !canOverride}
                      />
                    </FormField>
                  </div>
                ) : null}
                <FormField
                  id="service-exception-reason"
                  label="Operational reason"
                  description="Stored with the actor and request evidence in the audit trail."
                  required
                >
                  <textarea
                    name="reason"
                    rows={4}
                    minLength={4}
                    maxLength={1_000}
                    disabled={busy || !canOverride}
                    placeholder="Private event from 7–9 PM; approved by the service manager."
                  />
                </FormField>
                <InlineNotice tone="warning" title="Commitment check">
                  A closure blocks new inventory but does not cancel or move
                  existing reservations. Review the day book and contact every
                  affected guest before service.
                </InlineNotice>
                <Button
                  type="submit"
                  variant="accent"
                  className="w-full"
                  disabled={
                    busy || !canOverride || !selectedShift || !boundaryOptions.length
                  }
                >
                  <CalendarClock className="size-4" />
                  {busy ? "Recording…" : "Record service exception"}
                </Button>
              </form>
            </Surface>
          </div>
        )}
      </section>
      <ConfirmActionDialog
        open={Boolean(revokeTarget)}
        labelledBy={revokeDialogTitleId}
        title={`Revoke ${revokeTarget ? serviceShiftExceptionLabel(revokeTarget.kind).toLowerCase() : "exception"}?`}
        description="The approved service policy will apply again wherever no other active exception covers the interval. The original evidence remains in the audit trail."
        confirmLabel="Revoke exception"
        onClose={() => {
          setRevokeTarget(null);
          setRevokeReason("");
        }}
        onConfirm={revokeException}
        busy={busy}
      >
        <FormField
          id="service-exception-revoke-reason"
          label="Revocation reason"
          required
        >
          <textarea
            rows={4}
            minLength={4}
            maxLength={1_000}
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
            placeholder="Event was cancelled; restore the approved dinner policy."
          />
        </FormField>
      </ConfirmActionDialog>
    </PageFrame>
  );
}
