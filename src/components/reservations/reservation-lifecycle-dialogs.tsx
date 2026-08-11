"use client";

import {
  ArrowLeft,
  CalendarClock,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  cancelReservationAction,
  loadReservationLifecycleHeadAction,
  modifyReservationAction,
} from "@/app/actions/workflows/reservations";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FormField } from "@/components/ui/form-field";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Modal } from "@/components/ui/modal";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import type {
  CancelReservationInput,
  ModifyReservationInput,
  ReservationLifecycleHead,
} from "@/data/reservation-schemas";
import {
  localDateTimeParts,
  zonedLocalToIso,
} from "@/data/read-models/local-time";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import type {
  ReservationHostModel,
  ReservationSummary,
} from "@/lib/reservations/model";
import { isReservationLifecycleOwnedByOs } from "@/lib/reservations/model";

type LifecycleFailure = {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

type EditDraft = {
  date: string;
  time: string;
  durationMinutes: string;
  partySize: string;
  specialRequests: string;
  reason: string;
};

function reservationWithLifecycleHead(
  current: ReservationSummary,
  head: ReservationLifecycleHead,
): ReservationSummary {
  const sameTables =
    current.tableIds.length === head.tableIds.length &&
    current.tableIds.every((tableId, index) => tableId === head.tableIds[index]);
  return {
    ...current,
    id: head.id,
    version: head.version,
    startsAt: head.reservedAt,
    durationMinutes: head.durationMinutes ?? current.durationMinutes,
    partySize: head.partySize,
    status: head.status,
    source: head.source,
    bookingChannel: head.bookingChannel,
    tableIds: head.tableIds,
    tableLabel: sameTables
      ? current.tableLabel
      : head.tableIds.length
        ? `${head.tableIds.length} assigned ${head.tableIds.length === 1 ? "table" : "tables"}`
        : null,
    specialRequests: head.specialRequests,
    policyEvidenceCaptured: head.policyEvidenceCaptured,
    lastRevision: head.lastRevision,
  };
}

function commitmentLabel(startsAt: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

function revisionLabel(kind: "staff_modified" | "staff_cancelled") {
  return kind === "staff_cancelled" ? "Cancellation" : "Edit";
}

function initialEditDraft(
  reservation: ReservationSummary,
  timeZone: string,
): EditDraft {
  const parts = localDateTimeParts(reservation.startsAt, timeZone);
  return {
    date: parts.date,
    time: parts.time,
    durationMinutes: String(reservation.durationMinutes),
    partySize: String(reservation.partySize),
    specialRequests: reservation.specialRequests ?? "",
    reason: "",
  };
}

function firstFieldError(
  error: LifecycleFailure | null,
  field: string,
): string | undefined {
  return error?.fieldErrors?.[field]?.[0];
}

function CurrentCommitment({
  reservation,
  model,
}: {
  reservation: ReservationSummary;
  model: ReservationHostModel;
}) {
  return (
    <div className="grid gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--canvas)] p-4 sm:grid-cols-2">
      <div>
        <p className="text-xs text-[var(--ink-faint)]">Current commitment</p>
        <p className="mt-1 text-sm font-semibold">
          {commitmentLabel(reservation.startsAt, model.timeZone)}
        </p>
      </div>
      <div>
        <p className="text-xs text-[var(--ink-faint)]">Party and table</p>
        <p className="mt-1 text-sm font-semibold">
          {reservation.partySize} guests · {reservation.tableLabel ?? "Unassigned"}
        </p>
      </div>
      <div className="sm:col-span-2">
        <p className="text-xs text-[var(--ink-faint)]">Record evidence</p>
        <p className="mt-1 text-sm font-semibold">
          Version {reservation.version}
          {reservation.lastRevision
            ? ` · ${revisionLabel(reservation.lastRevision.kind)} recorded ${commitmentLabel(reservation.lastRevision.changedAt, model.timeZone)}`
            : " · No prior staff revision"}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">
          {reservation.policyEvidenceCaptured
            ? "Materialized service and policy evidence was captured with the last staff revision."
            : "No prior staff revision contains policy evidence yet."}
        </p>
      </div>
    </div>
  );
}

export function ReservationEditDialog({
  workspace,
  model,
  reservation,
  onClose,
  onCompleted,
}: {
  workspace: WorkspaceContextValue;
  model: ReservationHostModel;
  reservation: ReservationSummary;
  onClose: () => void;
  onCompleted: (message: string) => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const discardTitleId = useId();
  const reviewBackRef = useRef<HTMLButtonElement>(null);
  const reviewSaveRef = useRef<HTMLButtonElement>(null);
  const editPrimaryRef = useRef<HTMLInputElement>(null);
  const pendingFocusRef = useRef<
    "edit-primary" | "review-back" | "review-save" | null
  >(null);
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
  const [loadedHead, setLoadedHead] = useState<ReservationLifecycleHead | null>(
    null,
  );
  const currentReservation =
    loadedHead?.id === reservation.id &&
    loadedHead.version > reservation.version
      ? reservationWithLifecycleHead(reservation, loadedHead)
      : reservation;
  const [initialDraft] = useState(() =>
    initialEditDraft(reservation, model.timeZone),
  );
  const [draft, setDraft] = useState(initialDraft);
  const [reviewPayload, setReviewPayload] = useState<
    Omit<ModifyReservationInput, "requestId"> | null
  >(null);
  const [error, setError] = useState<LifecycleFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  const [recoveringUnconfirmed, setRecoveringUnconfirmed] = useState(false);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  const staleUnresolved =
    staleVersion !== null && currentReservation.version === staleVersion;
  const reviewOutdated =
    reviewPayload !== null &&
    reviewPayload.expectedVersion !== currentReservation.version &&
    !recoveringUnconfirmed;
  const sourceOwned = isReservationLifecycleOwnedByOs(currentReservation);
  const lifecycleUnavailable =
    (!sourceOwned ||
      !["booked", "confirmed"].includes(currentReservation.status)) &&
    !recoveringUnconfirmed;

  function requestDialogFocus(
    target: "edit-primary" | "review-back" | "review-save",
  ) {
    pendingFocusRef.current = target;
    setFocusRequestVersion((current) => current + 1);
  }

  useEffect(() => {
    if (busy || !pendingFocusRef.current) return;
    const focusTarget =
      pendingFocusRef.current === "edit-primary"
        ? editPrimaryRef.current
        : pendingFocusRef.current === "review-back"
          ? reviewBackRef.current
          : reviewSaveRef.current;
    if (!focusTarget) return;
    pendingFocusRef.current = null;
    focusTarget.focus({ preventScroll: true });
  }, [busy, focusRequestVersion, reviewPayload]);

  async function loadLatestReservation() {
    try {
      const latest = await loadReservationLifecycleHeadAction({
        locationId: workspace.activeLocation.id,
        reservationId: currentReservation.id,
      });
      router.refresh();
      if (!latest.ok || latest.mode !== "live") {
        setError({
          code: "database",
          message: latest.ok
            ? "The latest reservation details could not be loaded in this preview."
            : latest.message,
        });
        return false;
      }
      setLoadedHead(latest.data);
      setError(null);
      return true;
    } catch {
      router.refresh();
      setError({
        code: "database",
        message:
          "The latest reservation details could not be confirmed. Your draft is preserved; try loading them again.",
      });
      return false;
    }
  }

  function requestClose() {
    if (busy) return;
    if (reviewPayload) {
      requestDialogFocus("edit-primary");
      setReviewPayload(null);
      setRecoveringUnconfirmed(false);
      return;
    }
    if (dirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  function reviewChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setRecoveringUnconfirmed(false);
    const reservedAt = zonedLocalToIso(
      draft.date,
      draft.time,
      model.timeZone,
    );
    if (!reservedAt) {
      setError({
        code: "validation",
        message:
          "That local reservation time does not exist. Choose another time.",
        fieldErrors: { reservedAt: ["Choose a valid local date and time."] },
      });
      return;
    }
    const durationMinutes = Number(draft.durationMinutes);
    const partySize = Number(draft.partySize);
    const reason = draft.reason.trim();
    const durationInvalid =
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 15 ||
      durationMinutes > 720;
    const partySizeInvalid =
      !Number.isInteger(partySize) || partySize < 1 || partySize > 100;
    if (durationInvalid || partySizeInvalid || reason.length < 4) {
      setError({
        code: "validation",
        message: "Check the highlighted fields before reviewing this change.",
        fieldErrors: {
          ...(durationInvalid
            ? { durationMinutes: ["Enter a whole-minute turn time from 15 to 720 minutes."] }
            : {}),
          ...(partySizeInvalid
            ? { partySize: ["Party size must be from 1 to 100."] }
            : {}),
          ...(reason.length < 4
            ? { reason: ["Enter at least 4 characters of staff evidence."] }
            : {}),
        },
      });
      return;
    }
    if (
      reservedAt === currentReservation.startsAt &&
      durationMinutes === currentReservation.durationMinutes &&
      partySize === currentReservation.partySize &&
      (draft.specialRequests.trim() || null) ===
        currentReservation.specialRequests
    ) {
      setError({
        code: "validation",
        message:
          "Change the date, time, party, turn time, or requests before reviewing a revision.",
      });
      return;
    }
    requestDialogFocus("review-back");
    setReviewPayload({
      locationId: workspace.activeLocation.id,
      reservationId: currentReservation.id,
      expectedVersion: currentReservation.version,
      reservedAt,
      durationMinutes,
      partySize,
      specialRequests: draft.specialRequests.trim() || null,
      tableIds: currentReservation.tableIds,
      reason,
    });
  }

  async function commitChanges() {
    if (
      !reviewPayload ||
      busy ||
      reviewOutdated ||
      staleUnresolved ||
      lifecycleUnavailable
    )
      return;
    if (workspace.mode === "demo") {
      onCompleted(
        "Demo preview only. The reservation was not changed and no guest message was sent.",
      );
      onClose();
      return;
    }
    const scope = `reservation-modify-${currentReservation.id}`;
    setBusy(true);
    setError(null);
    try {
      const response = await modifyReservationAction({
        ...reviewPayload,
        requestId: requestIdFor(scope, reviewPayload),
      });
      if (!response.ok) {
        setError(response);
        if (response.code === "stale") {
          requestDialogFocus("edit-primary");
          setRecoveringUnconfirmed(false);
          setStaleVersion(reviewPayload.expectedVersion);
          setReviewPayload(null);
          await loadLatestReservation();
        } else {
          requestDialogFocus("review-save");
          setRecoveringUnconfirmed(response.code === "database");
        }
        setBusy(false);
        return;
      }
      setBusy(false);
      rotateRequestId(scope);
      if (response.mode === "demo") {
        onCompleted(response.message);
        onClose();
        return;
      }
      const result = response.data;
      const notificationOutcome = result.guestNotificationQueued
        ? " A verified-channel guest update was queued."
        : " No guest update was queued; contact the guest manually through an approved channel.";
      onCompleted(
        `${result.replayed ? "Recovered" : "Recorded"} ${revisionLabel(result.revisionKind).toLowerCase()} revision ${result.version} for ${commitmentLabel(result.reservedAt, model.timeZone)} and ${result.partySize} guests.${result.policyEvidenceCaptured ? " Service and policy evidence captured." : ""}${notificationOutcome}`,
      );
      onClose();
    } catch {
      requestDialogFocus("review-save");
      setBusy(false);
      setRecoveringUnconfirmed(true);
      setError({
        code: "database",
        message:
          "The connection ended before a result was confirmed. Your draft is preserved; retrying it unchanged will safely reuse the same request.",
      });
    }
  }

  return (
    <>
      <Modal
        open={!discardOpen}
        onClose={requestClose}
        labelledBy={titleId}
        initialFocusSelector="[data-edit-primary]"
        position="responsive-sheet"
        className="max-h-[94svh] max-w-2xl overflow-y-auto rounded-b-none sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-5 sm:px-6">
          <div>
            <p className="eyebrow">Reservation lifecycle</p>
            <h2 id={titleId} className="mt-2 text-xl font-semibold tracking-tight">
              {reviewPayload ? "Review reservation changes" : "Edit / reschedule"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-faint)]">
              {currentReservation.guest.displayName} · current status remains {currentReservation.status.replaceAll("_", " ")}.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="quiet"
            aria-label={reviewPayload ? "Back to editing" : "Close edit reservation"}
            onClick={requestClose}
            disabled={busy}
          >
            {reviewPayload ? <ArrowLeft className="size-4" /> : <X className="size-4" />}
          </Button>
        </div>

        {reviewPayload ? (
          <div className="space-y-5 px-5 py-5 sm:px-6" aria-busy={busy}>
            <CurrentCommitment reservation={currentReservation} model={model} />
            <div className="grid gap-3 rounded-[16px] border border-[var(--accent)]/30 bg-[var(--accent-soft)]/45 p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-[var(--ink-faint)]">Proposed time</p>
                <p className="mt-1 text-sm font-semibold">
                  {commitmentLabel(reviewPayload.reservedAt, model.timeZone)}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--ink-faint)]">Proposed commitment</p>
                <p className="mt-1 text-sm font-semibold">
                  {reviewPayload.partySize} guests · {reviewPayload.durationMinutes} minutes
                </p>
              </div>
              <p className="text-xs leading-5 text-[var(--ink-faint)] sm:col-span-2">
                Reason: {reviewPayload.reason}. Existing table assignments move only if the database proves the exact new interval is available.
              </p>
            </div>
            <InlineNotice tone="warning" title="Atomic commitment change">
              Saving creates one immutable revision and revalidates pacing, service policy, and table overlap. A conflict leaves the current reservation unchanged. A guest update is queued only when a verified, approved channel is available; the saved result is authoritative.
            </InlineNotice>
            {reviewPayload.expectedVersion !== currentReservation.version ? (
              recoveringUnconfirmed ? (
                <InlineNotice tone="warning" title="Server result not confirmed">
                  The visible reservation has advanced, but this exact request can still be retried safely to recover its immutable result.
                </InlineNotice>
              ) : (
              <InlineNotice tone="danger" announce="assertive" title="Review is out of date">
                The reservation is now version {currentReservation.version}. Go back and review the preserved draft against the latest commitment.
              </InlineNotice>
              )
            ) : null}
            {lifecycleUnavailable ? (
              <InlineNotice
                tone="danger"
                announce="assertive"
                title={sourceOwned ? "Reservation is no longer editable" : "Reservation source is read-only"}
              >
                {sourceOwned
                  ? `Its current status is ${currentReservation.status.replaceAll("_", " ")}. Close this review and use the actions available for the latest state.`
                  : "Source writer ownership changed. Close this review and manage the reservation in its owning system."}
              </InlineNotice>
            ) : null}
            {error ? (
              <InlineNotice tone="danger" announce="assertive" title="Changes not recorded">
                {error.message}
              </InlineNotice>
            ) : null}
            <div className="flex flex-col-reverse gap-2 border-t border-[var(--line)] pt-4 sm:flex-row sm:justify-end">
              <Button
                ref={reviewBackRef}
                data-edit-review-back
                type="button"
                variant="secondary"
                onClick={() => {
                  requestDialogFocus("edit-primary");
                  setReviewPayload(null);
                  setRecoveringUnconfirmed(false);
                }}
                disabled={busy}
              >
                Back to edit
              </Button>
              <Button
                ref={reviewSaveRef}
                type="button"
                variant="accent"
                onClick={() => void commitChanges()}
                disabled={
                  busy ||
                  reviewOutdated ||
                  staleUnresolved ||
                  lifecycleUnavailable
                }
              >
                <ShieldCheck className="size-4" />
                {busy ? "Saving…" : "Save revision"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={reviewChanges} aria-busy={busy} className="px-5 py-5 sm:px-6">
            <div className="space-y-5">
              <CurrentCommitment reservation={currentReservation} model={model} />
              {staleVersion !== null ? (
                staleUnresolved ? (
                  <InlineNotice
                    tone="danger"
                    announce="assertive"
                    title="Reservation changed since you opened it"
                    action={
                      <Button
                        type="button"
                        variant="quiet"
                        size="sm"
                        onClick={() => {
                          requestDialogFocus("edit-primary");
                          void loadLatestReservation();
                        }}
                      >
                        <RefreshCw className="size-4" />
                        Review latest
                      </Button>
                    }
                  >
                    Your draft is preserved. Load version {staleVersion + 1} or later before reviewing it again.
                  </InlineNotice>
                ) : (
                  <InlineNotice tone="info" title="Latest commitment loaded">
                    Your draft was preserved. Review it now against version {currentReservation.version}.
                  </InlineNotice>
                )
              ) : null}
              {error && error.code !== "stale" ? (
                <InlineNotice tone="danger" announce="assertive" title="Changes not ready">
                  {error.message}
                </InlineNotice>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  id="reservation-edit-date"
                  label="Date"
                  required
                  error={firstFieldError(error, "reservedAt")}
                >
                  <input
                    ref={editPrimaryRef}
                    data-edit-primary
                    type="date"
                    value={draft.date}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, date: event.target.value }))
                    }
                  />
                </FormField>
                <FormField
                  id="reservation-edit-time"
                  label="Time"
                  required
                  error={firstFieldError(error, "reservedAt")}
                >
                  <input
                    type="time"
                    value={draft.time}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, time: event.target.value }))
                    }
                  />
                </FormField>
                <FormField
                  id="reservation-edit-party"
                  label="Party size"
                  required
                  error={firstFieldError(error, "partySize")}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={draft.partySize}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, partySize: event.target.value }))
                    }
                  />
                </FormField>
                <FormField
                  id="reservation-edit-duration"
                  label="Turn time"
                  description="Enter any whole-minute duration from 15 to 720. Service policy is revalidated when you save."
                  required
                  error={firstFieldError(error, "durationMinutes")}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={720}
                    step={1}
                    value={draft.durationMinutes}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, durationMinutes: event.target.value }))
                    }
                  />
                </FormField>
              </div>
              <FormField id="reservation-edit-requests" label="Requests and notes">
                <textarea
                  rows={3}
                  maxLength={2_000}
                  value={draft.specialRequests}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, specialRequests: event.target.value }))
                  }
                />
              </FormField>
              <FormField
                id="reservation-edit-reason"
                label="Reason for change"
                description="Stored as staff evidence with this immutable revision. Do not include payment data."
                required
                error={firstFieldError(error, "reason")}
              >
                <textarea
                  rows={3}
                  minLength={4}
                  maxLength={1_000}
                  value={draft.reason}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, reason: event.target.value }))
                  }
                  placeholder="Guest called to move dinner from 7:00 PM to 7:30 PM."
                />
              </FormField>
            </div>
            <StickyActionBar
              title={`Current record · version ${currentReservation.version}`}
              detail="Review is required before the database changes the commitment."
              icon={<CalendarClock className="size-5" />}
              className="bottom-0 lg:bottom-0"
              actions={
                <>
                  <Button type="button" variant="secondary" onClick={requestClose} disabled={busy}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="accent"
                    disabled={busy || staleUnresolved || lifecycleUnavailable}
                  >
                    Review changes
                  </Button>
                </>
              }
            />
          </form>
        )}
      </Modal>
      <ConfirmActionDialog
        open={discardOpen}
        labelledBy={discardTitleId}
        title="Discard reservation changes?"
        description="The reservation has not changed. Your unsaved date, time, party, notes, and reason will be discarded."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onClose={() => setDiscardOpen(false)}
        onConfirm={onClose}
      />
    </>
  );
}

export function ReservationCancelDialog({
  workspace,
  model,
  reservation,
  onClose,
  onCompleted,
}: {
  workspace: WorkspaceContextValue;
  model: ReservationHostModel;
  reservation: ReservationSummary;
  onClose: () => void;
  onCompleted: (message: string) => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const [loadedHead, setLoadedHead] = useState<ReservationLifecycleHead | null>(
    null,
  );
  const currentReservation =
    loadedHead?.id === reservation.id &&
    loadedHead.version > reservation.version
      ? reservationWithLifecycleHead(reservation, loadedHead)
      : reservation;
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const pendingReasonFocusRef = useRef(false);
  const [reasonFocusRequestVersion, setReasonFocusRequestVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<LifecycleFailure | null>(null);
  const [staleVersion, setStaleVersion] = useState<number | null>(null);
  const [recoveryPayload, setRecoveryPayload] = useState<Omit<
    CancelReservationInput,
    "requestId"
  > | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const staleUnresolved =
    staleVersion !== null && currentReservation.version === staleVersion;
  const sourceOwned = isReservationLifecycleOwnedByOs(currentReservation);
  const lifecycleUnavailable =
    (!sourceOwned ||
      !["booked", "confirmed", "arrived"].includes(
        currentReservation.status,
      )) &&
    recoveryPayload === null;

  function requestReasonFocus() {
    pendingReasonFocusRef.current = true;
    setReasonFocusRequestVersion((current) => current + 1);
  }

  useEffect(() => {
    if (busy || !pendingReasonFocusRef.current || !reasonRef.current) return;
    pendingReasonFocusRef.current = false;
    reasonRef.current.focus({ preventScroll: true });
  }, [busy, reasonFocusRequestVersion, currentReservation.version]);

  async function loadLatestReservation() {
    try {
      const latest = await loadReservationLifecycleHeadAction({
        locationId: workspace.activeLocation.id,
        reservationId: currentReservation.id,
      });
      router.refresh();
      if (!latest.ok || latest.mode !== "live") {
        setError({
          code: "database",
          message: latest.ok
            ? "The latest reservation details could not be loaded in this preview."
            : latest.message,
        });
        return false;
      }
      setLoadedHead(latest.data);
      setError(null);
      return true;
    } catch {
      router.refresh();
      setError({
        code: "database",
        message:
          "The latest reservation details could not be confirmed. Your reason is preserved; try loading them again.",
      });
      return false;
    }
  }

  async function cancelReservation() {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 4) {
      setError({
        code: "validation",
        message: "Enter a cancellation reason before continuing.",
        fieldErrors: {
          reason: ["Enter at least 4 characters of staff evidence."],
        },
      });
      return;
    }
    const latestPayload: Omit<CancelReservationInput, "requestId"> = {
      locationId: workspace.activeLocation.id,
      reservationId: currentReservation.id,
      expectedVersion: currentReservation.version,
      reason: normalizedReason,
    };
    const payload =
      recoveryPayload?.reason === normalizedReason
        ? recoveryPayload
        : latestPayload;
    if (payload === latestPayload) setRecoveryPayload(null);
    if (workspace.mode === "demo") {
      onCompleted("Demo preview only. The reservation was not cancelled and the guest was not notified.");
      onClose();
      return;
    }
    const scope = `reservation-cancel-${currentReservation.id}`;
    setBusy(true);
    setError(null);
    try {
      const response = await cancelReservationAction({
        ...payload,
        requestId: requestIdFor(scope, payload),
      });
      if (!response.ok) {
        setError(response);
        requestReasonFocus();
        if (response.code === "stale") {
          setRecoveryPayload(null);
          setStaleVersion(payload.expectedVersion);
          await loadLatestReservation();
        } else {
          setRecoveryPayload(response.code === "database" ? payload : null);
        }
        setBusy(false);
        return;
      }
      setBusy(false);
      rotateRequestId(scope);
      if (response.mode === "demo") {
        onCompleted(response.message);
        onClose();
        return;
      }
      const result = response.data;
      const notificationOutcome = result.guestNotificationQueued
        ? " A verified-channel guest cancellation message was queued."
        : " No guest message was queued; contact the guest manually through an approved channel.";
      onCompleted(
        `${result.replayed ? "Recovered" : "Recorded"} cancellation revision ${result.version} for ${commitmentLabel(result.reservedAt, model.timeZone)} and ${result.partySize} guests. Inventory was released.${notificationOutcome}`,
      );
      onClose();
    } catch {
      requestReasonFocus();
      setBusy(false);
      setRecoveryPayload(payload);
      setError({
        code: "database",
        message:
          "The connection ended before a result was confirmed. Your reason is preserved; retrying it unchanged will safely reuse the same request.",
      });
    }
  }

  return (
    <ConfirmActionDialog
      open
      labelledBy={titleId}
      title="Cancel this reservation?"
      description={`${currentReservation.guest.displayName} · ${commitmentLabel(currentReservation.startsAt, model.timeZone)} · ${currentReservation.partySize} guests · ${currentReservation.tableLabel ?? "unassigned"}. Cancellation releases future inventory and records immutable evidence.`}
      confirmLabel="Cancel reservation"
      cancelLabel="Keep reservation"
      busy={busy}
      confirmDisabled={staleUnresolved || lifecycleUnavailable}
      noValidate
      onClose={onClose}
      onConfirm={cancelReservation}
    >
      <div className="space-y-4">
        <InlineNotice tone="warning" title="Guest delivery depends on channel readiness">
          A cancellation message is queued only when a verified, approved channel is available. The saved result is authoritative; otherwise contact the guest manually.
        </InlineNotice>
        <CurrentCommitment reservation={currentReservation} model={model} />
        {staleVersion !== null ? (
          staleUnresolved ? (
            <InlineNotice
              tone="danger"
              announce="assertive"
              title="Reservation changed since you opened it"
              action={
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    requestReasonFocus();
                    void loadLatestReservation();
                  }}
                >
                  <RefreshCw className="size-4" />
                  Review latest
                </Button>
              }
            >
              Your reason is preserved. Load the latest version before deciding whether to cancel it.
            </InlineNotice>
          ) : (
            <InlineNotice tone="info" title="Latest commitment loaded">
              Review version {currentReservation.version} above, then confirm again if cancellation is still appropriate.
            </InlineNotice>
          )
        ) : null}
        {lifecycleUnavailable ? (
          <InlineNotice
            tone="danger"
            announce="assertive"
            title={sourceOwned ? "Reservation is no longer cancellable" : "Reservation source is read-only"}
          >
            {sourceOwned
              ? `Its current status is ${currentReservation.status.replaceAll("_", " ")}. Keep the reservation record and use the actions available for the latest state.`
              : "Source writer ownership changed. Keep this record and manage the cancellation in its owning system."}
          </InlineNotice>
        ) : null}
        {error && error.code !== "stale" ? (
          <InlineNotice tone="danger" announce="assertive" title="Reservation not cancelled">
            {error.message}
          </InlineNotice>
        ) : null}
        <FormField
          id="reservation-cancel-reason"
          label="Cancellation reason"
          description="Stored with the staff revision. Do not include payment data."
          required
          error={firstFieldError(error, "reason")}
        >
          <textarea
            ref={reasonRef}
            rows={4}
            minLength={4}
            maxLength={1_000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Guest called to cancel because their plans changed."
          />
        </FormField>
      </div>
    </ConfirmActionDialog>
  );
}
