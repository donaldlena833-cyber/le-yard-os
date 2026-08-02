"use client";

import {
  BadgeCheck,
  Check,
  Download,
  FileCheck2,
  LoaderCircle,
  Mail,
  PencilLine,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createPrivateFileDownloadUrlAction } from "@/app/actions/workflows/files";
import {
  cancelTimeOffAction,
  createEmployeeDocumentUploadUrlAction,
  decideTimeOffAction,
  deleteAvailabilityAction,
  finalizeEmployeeDocumentAction,
  saveAvailabilityAction,
  saveCertificationAction,
  saveEmergencyContactAction,
  saveTimeOffAction,
  updateEmployeeDocumentAction,
} from "@/app/actions/workflows/people-operations";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveAvailabilityRule,
  LiveCertification,
  LiveEmergencyContact,
  LiveEmployeeDocument,
  LiveTeamMember,
  LiveTimeOffRequest,
} from "@/data/read-models/team";
import { createClient } from "@/lib/supabase/client";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { cn } from "@/lib/utils";

type DialogState =
  | { kind: "availability"; rule: LiveAvailabilityRule | null }
  | { kind: "availability-delete"; rule: LiveAvailabilityRule }
  | { kind: "time-off"; request: LiveTimeOffRequest | null }
  | { kind: "time-off-cancel"; request: LiveTimeOffRequest }
  | { kind: "time-off-decision"; request: LiveTimeOffRequest; approve: boolean }
  | { kind: "certification"; certification: LiveCertification | null }
  | { kind: "emergency-contact"; contact: LiveEmergencyContact | null }
  | { kind: "document-upload" }
  | { kind: "document-edit"; document: LiveEmployeeDocument };

type Notice = { tone: "success" | "error"; message: string };

const weekdayLabels = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const requestTone: Record<
  LiveTimeOffRequest["status"],
  "neutral" | "positive" | "warning" | "danger"
> = {
  draft: "neutral",
  pending: "warning",
  approved: "positive",
  denied: "danger",
  cancelled: "neutral",
};

const fieldClass =
  "focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[10px] placeholder:text-[var(--ink-faint)]";
const areaClass =
  "focus-ring min-h-24 w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-[10px] leading-4 placeholder:text-[var(--ink-faint)]";

function formatDateOnly(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatClockTime(value: string | null) {
  if (!value) return null;
  const [hoursValue, minutesValue] = value.split(":");
  const hours = Number(hoursValue);
  const minutes = Number(minutesValue);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value;
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function availabilityWindow(rule: LiveAvailabilityRule) {
  if (!rule.isAvailable) return "Unavailable";
  const from = formatClockTime(rule.availableFrom);
  const until = formatClockTime(rule.availableUntil);
  return from && until ? `${from}–${until}` : "Available · hours not recorded";
}

function formatTimeOffRange(request: LiveTimeOffRequest) {
  const start = new Date(request.startsAt);
  const end = new Date(request.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${request.startsAt} – ${request.endsAt}`;
  }
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: request.timeZone,
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: request.timeZone,
  });
  const sameDay = dateFormatter.format(start) === dateFormatter.format(end);
  return sameDay
    ? `${dateFormatter.format(start)} · ${timeFormatter.format(start)}–${timeFormatter.format(end)}`
    : `${dateFormatter.format(start)}, ${timeFormatter.format(start)} – ${dateFormatter.format(end)}, ${timeFormatter.format(end)}`;
}

function localInputValue(value: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function formatFileSize(value: number | null) {
  if (value === null) return "Size not recorded";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function EmptyRecord({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-[10px] leading-4 text-[var(--ink-faint)]">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="mb-1.5 block text-[10px] font-semibold">{label}</span>
      {children}
    </label>
  );
}

function ModalFrame({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const body = document.body;
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = body.style.overflow;
    const background = Array.from(body.children)
      .filter((element) => element !== overlay)
      .map((element) => ({
        element,
        wasInert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    body.style.overflow = "hidden";
    for (const item of background) {
      item.element.setAttribute("inert", "");
      item.element.setAttribute("aria-hidden", "true");
    }
    dialog?.focus({ preventScroll: true });

    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.hasAttribute("hidden") &&
          element.getAttribute("aria-hidden") !== "true",
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || active === dialog)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", keepFocusInDialog);
    return () => {
      document.removeEventListener("keydown", keepFocusInDialog);
      body.style.overflow = previousOverflow;
      for (const item of background) {
        if (!item.wasInert) item.element.removeAttribute("inert");
        if (item.ariaHidden === null) item.element.removeAttribute("aria-hidden");
        else item.element.setAttribute("aria-hidden", item.ariaHidden);
      }
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-5"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
      />
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative max-h-[92svh] w-full overflow-y-auto rounded-t-[24px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-2xl sm:max-w-xl sm:rounded-[24px]"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-[var(--paper-strong)] px-5 py-4 sm:px-6">
          <div>
            <h3 id={titleId} className="text-base font-semibold tracking-[-0.025em]">
              {title}
            </h3>
            <p id={descriptionId} className="mt-1 max-w-md text-[10px] leading-4 text-[var(--ink-faint)]">
              {description}
            </p>
          </div>
          <Button type="button" variant="quiet" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function DialogFooter({
  busy,
  action,
  onClose,
  danger = false,
}: {
  busy: boolean;
  action: string;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-4 sm:px-6">
      <Button type="button" variant="quiet" onClick={onClose} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant={danger ? "danger" : "accent"} disabled={busy}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {busy ? "Saving…" : action}
      </Button>
    </footer>
  );
}

function actionMessage(result: { ok: boolean; message?: string }, fallback: string) {
  return result.ok ? fallback : result.message ?? "The request could not be completed.";
}

export function PeopleOperationsPanel({
  workspace,
  member,
}: {
  workspace: WorkspaceContextValue;
  member: LiveTeamMember;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const isSelf = member.userId === workspace.identity.userId;
  const canManage =
    workspace.role === "admin" ||
    workspace.role === "manager" ||
    (workspace.role === "owner" && workspace.identity.aal === "aal2");
  const canEditAvailability = Boolean(member.employeeId && (isSelf || canManage));
  const canSubmitTimeOff = Boolean(member.employeeId && isSelf && member.locationIds.length);
  const canDecideTimeOff = Boolean(member.employeeId && canManage && !isSelf);
  const canManageReadiness = Boolean(member.employeeId && canManage);
  const canEditEmergency = Boolean(member.employeeId && (isSelf || canManage));
  const availableLocations = workspace.locations.filter((location) =>
    member.locationIds.includes(location.id),
  );

  function runAction(
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setNotice({ tone: "error", message: actionMessage(result, successMessage) });
          return;
        }
        setDialog(null);
        setNotice({ tone: "success", message: successMessage });
        router.refresh();
      } catch {
        setNotice({
          tone: "error",
          message:
            "We could not confirm whether the request completed. Retry without changing the form to safely check the same request.",
        });
      }
    });
  }

  function openDocument(document: LiveEmployeeDocument) {
    setDownloadingId(document.id);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await createPrivateFileDownloadUrlAction({
          bucket: "employee-documents",
          objectPath: document.storagePath,
          downloadFileName: document.title,
        });
        if (!result.ok || !("data" in result)) {
          setNotice({
            tone: "error",
            message: result.ok ? "The private document is unavailable." : result.message,
          });
          return;
        }
        window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
        setNotice({
          tone: "success",
          message: "A short-lived private download was opened.",
        });
      } finally {
        setDownloadingId(null);
      }
    });
  }

  async function uploadDocument(form: HTMLFormElement, requestId: string) {
    if (!member.employeeId) return;
    const data = new FormData(form);
    const fileValue = data.get("file");
    if (!(fileValue instanceof File) || !fileValue.size) {
      setNotice({ tone: "error", message: "Choose a PDF or image to upload." });
      return;
    }
    const input = {
      uploadId: requestId,
      employeeId: member.employeeId,
      locationId: String(data.get("locationId")),
      documentType: String(data.get("documentType")),
      title: String(data.get("title")),
      mimeType: fileValue.type,
      sizeBytes: fileValue.size,
      employeeVisible: data.get("employeeVisible") === "on",
      fileName: fileValue.name,
    };
    const prepared = await createEmployeeDocumentUploadUrlAction(input);
    if (!prepared.ok || !("data" in prepared)) {
      setNotice({
        tone: "error",
        message: prepared.ok ? "The private upload could not start." : prepared.message,
      });
      return;
    }
    const supabase = createClient();
    const uploaded = await supabase.storage
      .from("employee-documents")
      .uploadToSignedUrl(
        prepared.data.objectPath,
        prepared.data.token,
        fileValue,
        { contentType: fileValue.type },
      );
    if (uploaded.error) {
      setNotice({
        tone: "error",
        message: "The encrypted file transfer did not finish. Retry the upload.",
      });
      return;
    }
    const finalized = await finalizeEmployeeDocumentAction({
      requestId,
      employeeId: member.employeeId,
      locationId: input.locationId,
      objectPath: prepared.data.objectPath,
      documentType: input.documentType,
      title: input.title,
      mimeType: fileValue.type,
      sizeBytes: fileValue.size,
      employeeVisible: input.employeeVisible,
    });
    if (!finalized.ok) {
      setNotice({ tone: "error", message: finalized.message });
      return;
    }
    setDialog(null);
    setNotice({ tone: "success", message: "The private employee document was uploaded." });
    router.refresh();
  }

  return (
    <>
      {notice ? (
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "lg:col-span-2 rounded-xl px-3 py-2.5 text-[10px]",
            notice.tone === "success"
              ? "bg-[var(--positive-soft)] text-[var(--positive)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)]",
          )}
        >
          {notice.message}
        </p>
      ) : null}

      <section>
        <SectionHeading
          eyebrow="Work pattern"
          title="Availability rules"
          detail={`${member.availability.length} visible rule${member.availability.length === 1 ? "" : "s"}`}
          action={
            canEditAvailability ? (
              <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "availability", rule: null })}>
                <Plus className="size-3.5" /> Add rule
              </Button>
            ) : null
          }
        />
        {member.availability.length ? (
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {member.availability.map((rule) => (
              <div key={rule.id} className="grid gap-2 py-3 sm:grid-cols-[100px_minmax(0,1fr)_auto] sm:gap-4">
                <div>
                  <p className="text-[10px] font-semibold">{weekdayLabels[rule.weekday] ?? `Day ${rule.weekday}`}</p>
                  <p className={cn("mt-1 text-[9px]", rule.isAvailable ? "text-[var(--positive)]" : "text-[var(--ink-faint)]")}>
                    {availabilityWindow(rule)}
                  </p>
                </div>
                <div className="text-[9px] leading-4 text-[var(--ink-faint)]">
                  <p>{rule.locationName ?? "All assigned locations"}</p>
                  <p>
                    Effective {formatDateOnly(rule.effectiveFrom)}
                    {rule.effectiveTo ? `–${formatDateOnly(rule.effectiveTo)}` : " · no end date"}
                  </p>
                  {rule.notes ? <p className="mt-1 text-[var(--ink-soft)]">{rule.notes}</p> : null}
                </div>
                {canEditAvailability ? (
                  <div className="flex items-center gap-1 sm:justify-end">
                    <Button type="button" variant="quiet" size="icon" disabled={busy} onClick={() => setDialog({ kind: "availability", rule })} aria-label={`Edit ${weekdayLabels[rule.weekday]} availability`}>
                      <PencilLine className="size-3.5" />
                    </Button>
                    <Button type="button" variant="quiet" size="icon" disabled={busy} onClick={() => setDialog({ kind: "availability-delete", rule })} aria-label={`Delete ${weekdayLabels[rule.weekday]} availability`}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyRecord>No availability rules are on file for this profile.</EmptyRecord>
        )}
      </section>

      <section>
        <SectionHeading
          eyebrow="History"
          title="Time off"
          detail="Requests visible to this session"
          action={
            canSubmitTimeOff ? (
              <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "time-off", request: null })}>
                <Plus className="size-3.5" /> Request
              </Button>
            ) : null
          }
        />
        {member.timeOff.length ? (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {member.timeOff.map((request) => (
              <article key={request.id} className="rounded-xl border border-[var(--line)] px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="numeric text-[10px] font-semibold">{formatTimeOffRange(request)}</p>
                    <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                      {request.locationName ?? "Organization-wide request"}
                    </p>
                  </div>
                  <StatusPill tone={requestTone[request.status]}>{request.status}</StatusPill>
                </div>
                {request.reason ? <p className="mt-2 text-[10px] leading-4 text-[var(--ink-soft)]">{request.reason}</p> : null}
                {request.decisionNote ? (
                  <p className="mt-2 border-t border-[var(--line)] pt-2 text-[9px] leading-4 text-[var(--ink-faint)]">
                    Decision note · {request.decisionNote}
                  </p>
                ) : null}
                {request.status === "pending" && (canSubmitTimeOff || canDecideTimeOff) ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
                    {canSubmitTimeOff ? (
                      <>
                        <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "time-off", request })}>
                          <PencilLine className="size-3.5" /> Edit
                        </Button>
                        <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "time-off-cancel", request })}>
                          <X className="size-3.5" /> Cancel request
                        </Button>
                      </>
                    ) : null}
                    {canDecideTimeOff ? (
                      <>
                        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => setDialog({ kind: "time-off-decision", request, approve: true })}>
                          <Check className="size-3.5" /> Approve
                        </Button>
                        <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "time-off-decision", request, approve: false })}>
                          <X className="size-3.5" /> Decline
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyRecord>No time-off requests are on file.</EmptyRecord>
        )}
      </section>

      <section className="lg:col-span-2">
        <SectionHeading
          eyebrow="Readiness"
          title="Certifications & documents"
          detail={member.detailAccess === "self" && member.role === "employee" ? "Only records released to you are listed" : "Private files use short-lived signed downloads"}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[9px] font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase">Certifications</p>
              {canManageReadiness ? (
                <Button type="button" variant="quiet" size="sm" disabled={busy} aria-label="Add certification" onClick={() => setDialog({ kind: "certification", certification: null })}>
                  <Plus className="size-3.5" /> Add
                </Button>
              ) : null}
            </div>
            {member.certifications.length ? (
              <div className="space-y-2">
                {member.certifications.map((certification) => (
                  <article key={certification.id} className="flex items-start gap-3 rounded-xl border border-[var(--line)] px-3.5 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--positive-soft)] text-[var(--positive)]">
                      <BadgeCheck className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold">{certification.certificationType}</p>
                      <p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">
                        {certification.issuer ?? "Issuer not recorded"}
                        {certification.credentialNumber ? ` · ${certification.credentialNumber}` : ""}
                      </p>
                      <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                        {certification.issuedOn ? `Issued ${formatDateOnly(certification.issuedOn)}` : "Issue date not recorded"}
                        {certification.expiresOn ? ` · Expires ${formatDateOnly(certification.expiresOn)}` : " · No expiry recorded"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusPill tone={certification.verifiedAt ? "positive" : "neutral"}>
                        {certification.verifiedAt ? "Verified" : "Not verified"}
                      </StatusPill>
                      {canManageReadiness ? (
                        <Button type="button" variant="quiet" size="icon" disabled={busy} onClick={() => setDialog({ kind: "certification", certification })} aria-label={`Edit ${certification.certificationType}`}>
                          <PencilLine className="size-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyRecord>No certifications are on file.</EmptyRecord>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[9px] font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase">Employee documents</p>
              {canManageReadiness && availableLocations.length ? (
                <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "document-upload" })}>
                  <Upload className="size-3.5" /> Upload
                </Button>
              ) : null}
            </div>
            {member.documents.length ? (
              <div className="space-y-2">
                {member.documents.map((document) => (
                  <article key={document.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] px-3.5 py-3">
                    <FileCheck2 className="size-4 shrink-0 text-[var(--accent-strong)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] font-semibold">{document.title}</p>
                      <p className="mt-1 truncate text-[9px] text-[var(--ink-faint)]">
                        {document.documentType} · {formatFileSize(document.sizeBytes)} · {document.employeeVisible ? "Employee visible" : "Management only"}
                      </p>
                    </div>
                    {canManageReadiness ? (
                      <Button type="button" variant="quiet" size="icon" disabled={busy} onClick={() => setDialog({ kind: "document-edit", document })} aria-label={`Edit ${document.title} metadata`}>
                        <PencilLine className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button type="button" variant="quiet" size="icon" onClick={() => openDocument(document)} disabled={busy} aria-label={`Download ${document.title}`} title="Open private document">
                      {busy && downloadingId === document.id ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyRecord>
                {member.detailAccess === "self" && member.role === "employee"
                  ? "No employee-visible documents are on file."
                  : "No employee documents are on file."}
              </EmptyRecord>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionHeading
          eyebrow="Private"
          title="Emergency contacts"
          detail={member.detailAccess === "self" ? "Your contact record" : "Authorized management view"}
          action={
            canEditEmergency ? (
              <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => setDialog({ kind: "emergency-contact", contact: null })}>
                <Plus className="size-3.5" /> Add contact
              </Button>
            ) : null
          }
        />
        {member.emergencyContacts.length ? (
          <div className="space-y-2">
            {member.emergencyContacts.map((contact) => (
              <article key={contact.id} className="rounded-xl bg-[var(--canvas)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold">{contact.name}</p>
                    <p className="mt-1 text-[10px] text-[var(--ink-faint)]">{contact.relationship ?? "Relationship not recorded"}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {contact.isPrimary ? <StatusPill tone="accent">Primary</StatusPill> : null}
                    {canEditEmergency ? (
                      <Button type="button" variant="quiet" size="icon" disabled={busy} onClick={() => setDialog({ kind: "emergency-contact", contact })} aria-label={`Edit emergency contact ${contact.name}`}>
                        <PencilLine className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <a href={`tel:${contact.phone}`} className="focus-ring mt-3 flex w-fit items-center gap-2 rounded-md text-[10px] font-medium">
                  <Phone className="size-3.5 text-[var(--ink-faint)]" />
                  {contact.phone}
                </a>
                {contact.email ? (
                  <a href={`mailto:${contact.email}`} className="focus-ring mt-2 flex w-fit items-center gap-2 rounded-md text-[10px] text-[var(--ink-soft)]">
                    <Mail className="size-3.5 text-[var(--ink-faint)]" />
                    {contact.email}
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyRecord>No emergency contact has been provided.</EmptyRecord>
        )}
      </section>

      {dialog && member.employeeId ? (
        <PeopleDialog
          dialog={dialog}
          member={member}
          workspace={workspace}
          locations={availableLocations}
          busy={busy}
          onClose={() => setDialog(null)}
          onRun={runAction}
          onUpload={(form) => {
            setNotice(null);
            startTransition(async () => {
              try {
                await uploadDocument(form.form, form.requestId);
              } catch {
                setNotice({
                  tone: "error",
                  message:
                    "We could not confirm whether the upload completed. Retry without changing the form to safely continue the same upload.",
                });
              }
            });
          }}
        />
      ) : null}
    </>
  );
}

function PeopleDialog({
  dialog,
  member,
  workspace,
  locations,
  busy,
  onClose,
  onRun,
  onUpload,
}: {
  dialog: DialogState;
  member: LiveTeamMember;
  workspace: WorkspaceContextValue;
  locations: WorkspaceContextValue["locations"];
  busy: boolean;
  onClose: () => void;
  onRun: (
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) => void;
  onUpload: (attempt: { form: HTMLFormElement; requestId: string }) => void;
}) {
  const requestAttemptRef = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);

  function requestIdFor(operation: string, payload: unknown) {
    const fingerprint = `${operation}:${JSON.stringify(payload)}`;
    if (requestAttemptRef.current?.fingerprint === fingerprint) {
      return requestAttemptRef.current.requestId;
    }
    const requestId = crypto.randomUUID();
    requestAttemptRef.current = { fingerprint, requestId };
    return requestId;
  }

  const employeeId = member.employeeId;
  if (!employeeId) return null;
  const today = new Date().toISOString().slice(0, 10);

  if (dialog.kind === "availability") {
    const rule = dialog.rule;
    const mayUseOrganizationScope =
      member.userId === workspace.identity.userId || workspace.role !== "manager";
    return (
      <ModalFrame title={rule ? "Edit availability" : "Add availability"} description="Working hours are preferences for schedule planning, not a guaranteed shift assignment." onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const available = form.get("isAvailable") === "available";
          const payload = {
            employeeId,
            ruleId: rule?.id ?? null,
            locationId: String(form.get("locationId") || "") || null,
            weekday: Number(form.get("weekday")),
            availableFrom: available ? String(form.get("availableFrom") || "") || null : null,
            availableUntil: available ? String(form.get("availableUntil") || "") || null : null,
            isAvailable: available,
            effectiveFrom: String(form.get("effectiveFrom")),
            effectiveTo: String(form.get("effectiveTo") || "") || null,
            notes: String(form.get("notes") || "") || null,
          };
          const requestId = requestIdFor("people.availability.save", payload);
          onRun(rule ? "Availability updated." : "Availability added.", () =>
            saveAvailabilityAction({ requestId, ...payload }),
          );
        }}>
          <div className="grid gap-4 px-5 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Day"><select name="weekday" defaultValue={rule?.weekday ?? 1} className={fieldClass}>{weekdayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></Field>
              <Field label="Location"><select name="locationId" defaultValue={rule?.locationId ?? (mayUseOrganizationScope ? "" : locations[0]?.id)} required={!mayUseOrganizationScope} className={fieldClass}>{mayUseOrganizationScope ? <option value="">All assigned locations</option> : null}{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            </div>
            <Field label="Availability"><select name="isAvailable" defaultValue={rule?.isAvailable === false ? "unavailable" : "available"} className={fieldClass}><option value="available">Available</option><option value="unavailable">Unavailable</option></select></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Available from"><input name="availableFrom" type="time" defaultValue={rule?.availableFrom?.slice(0, 5) ?? "09:00"} className={fieldClass} /></Field>
              <Field label="Available until"><input name="availableUntil" type="time" defaultValue={rule?.availableUntil?.slice(0, 5) ?? "17:00"} className={fieldClass} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Effective from"><input name="effectiveFrom" type="date" required defaultValue={rule?.effectiveFrom ?? today} className={fieldClass} /></Field>
              <Field label="Effective until"><input name="effectiveTo" type="date" defaultValue={rule?.effectiveTo ?? ""} className={fieldClass} /></Field>
            </div>
            <Field label="Notes"><textarea name="notes" maxLength={2_000} defaultValue={rule?.notes ?? ""} className={areaClass} /></Field>
          </div>
          <DialogFooter busy={busy} action={rule ? "Save changes" : "Add rule"} onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "availability-delete") {
    return (
      <ModalFrame title="Delete availability rule?" description={`${weekdayLabels[dialog.rule.weekday]} · ${dialog.rule.locationName ?? "all assigned locations"}. This removes the rule from future schedule planning.`} onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const payload = { ruleId: dialog.rule.id };
          const requestId = requestIdFor("people.availability.delete", payload);
          onRun("Availability rule deleted.", () =>
            deleteAvailabilityAction({ requestId, ...payload }),
          );
        }}>
          <div className="px-5 py-6 text-[10px] leading-5 text-[var(--ink-soft)]">The immutable audit log will retain evidence of who removed this rule.</div>
          <DialogFooter busy={busy} action="Delete rule" danger onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "time-off") {
    const request = dialog.request;
    return (
      <ModalFrame title={request ? "Edit time-off request" : "Request time off"} description="Times are interpreted in the selected restaurant’s local time zone. Management must approve this request separately." onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const payload = {
            employeeId,
            timeOffId: request?.id ?? null,
            locationId: String(form.get("locationId")),
            startsAtLocal: String(form.get("startsAtLocal")),
            endsAtLocal: String(form.get("endsAtLocal")),
            reason: String(form.get("reason") || "") || null,
          };
          const requestId = requestIdFor("people.time_off.save", payload);
          onRun(request ? "Time-off request updated." : "Time-off request submitted.", () =>
            saveTimeOffAction({ requestId, ...payload }),
          );
        }}>
          <div className="grid gap-4 px-5 py-5 sm:px-6">
            <Field label="Restaurant"><select name="locationId" required defaultValue={request?.locationId ?? locations[0]?.id} className={fieldClass}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts"><input name="startsAtLocal" type="datetime-local" required defaultValue={request ? localInputValue(request.startsAt, request.timeZone) : ""} className={fieldClass} /></Field>
              <Field label="Ends"><input name="endsAtLocal" type="datetime-local" required defaultValue={request ? localInputValue(request.endsAt, request.timeZone) : ""} className={fieldClass} /></Field>
            </div>
            <Field label="Reason (optional)"><textarea name="reason" maxLength={2_000} defaultValue={request?.reason ?? ""} className={areaClass} /></Field>
          </div>
          <DialogFooter busy={busy} action={request ? "Save request" : "Submit request"} onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "time-off-cancel") {
    return (
      <ModalFrame title="Cancel time-off request?" description={formatTimeOffRange(dialog.request)} onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const payload = { timeOffId: dialog.request.id };
          const requestId = requestIdFor("people.time_off.cancel", payload);
          onRun("Time-off request cancelled.", () =>
            cancelTimeOffAction({ requestId, ...payload }),
          );
        }}>
          <div className="px-5 py-6 text-[10px] leading-5 text-[var(--ink-soft)]">Only pending, undecided requests can be cancelled. An approved request requires a separate management conversation.</div>
          <DialogFooter busy={busy} action="Cancel request" danger onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "time-off-decision") {
    return (
      <ModalFrame title={dialog.approve ? "Approve time off" : "Decline time off"} description={`${member.displayName} · ${formatTimeOffRange(dialog.request)}`} onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const payload = {
            timeOffId: dialog.request.id,
            approve: dialog.approve,
            decisionNote: String(form.get("decisionNote") || "") || null,
          };
          const requestId = requestIdFor("people.time_off.decide", payload);
          onRun(dialog.approve ? "Time off approved." : "Time off declined.", () =>
            decideTimeOffAction({ requestId, ...payload }),
          );
        }}>
          <div className="grid gap-4 px-5 py-5 sm:px-6">
            <div className="flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3 text-[10px] leading-4 text-[var(--ink-soft)]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" />The database records you as the independent decision maker and notifies the employee.</div>
            <Field label={dialog.approve ? "Decision note (optional)" : "Decision note (required)"}><textarea name="decisionNote" required={!dialog.approve} maxLength={2_000} className={areaClass} /></Field>
          </div>
          <DialogFooter busy={busy} action={dialog.approve ? "Approve" : "Decline"} danger={!dialog.approve} onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "certification") {
    const certification = dialog.certification;
    return (
      <ModalFrame title={certification ? "Edit certification" : "Add certification"} description="Verification is actor-stamped. Only mark a credential verified after reviewing its evidence." onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const payload = {
            employeeId,
            certificationId: certification?.id ?? null,
            certificationType: String(form.get("certificationType")),
            issuer: String(form.get("issuer") || "") || null,
            credentialNumber: String(form.get("credentialNumber") || "") || null,
            issuedOn: String(form.get("issuedOn") || "") || null,
            expiresOn: String(form.get("expiresOn") || "") || null,
            verified: form.get("verified") === "on",
          };
          const requestId = requestIdFor("people.certification.save", payload);
          onRun(certification ? "Certification updated." : "Certification added.", () =>
            saveCertificationAction({ requestId, ...payload }),
          );
        }}>
          <div className="grid gap-4 px-5 py-5 sm:px-6">
            <Field label="Certification"><input name="certificationType" required maxLength={240} defaultValue={certification?.certificationType ?? ""} className={fieldClass} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issuer"><input name="issuer" maxLength={240} defaultValue={certification?.issuer ?? ""} className={fieldClass} /></Field>
              <Field label="Credential number"><input name="credentialNumber" maxLength={240} defaultValue={certification?.credentialNumber ?? ""} className={fieldClass} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issued on"><input name="issuedOn" type="date" defaultValue={certification?.issuedOn ?? ""} className={fieldClass} /></Field>
              <Field label="Expires on"><input name="expiresOn" type="date" defaultValue={certification?.expiresOn ?? ""} className={fieldClass} /></Field>
            </div>
            <label className="flex items-center gap-3 rounded-xl bg-[var(--canvas)] p-3 text-[10px]"><input name="verified" type="checkbox" defaultChecked={Boolean(certification?.verifiedAt)} className="size-4 accent-[var(--accent)]" /><span><span className="font-semibold">Credential evidence verified</span><span className="mt-0.5 block text-[9px] text-[var(--ink-faint)]">Saving records the current manager as verifier.</span></span></label>
          </div>
          <DialogFooter busy={busy} action={certification ? "Save certification" : "Add certification"} onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "emergency-contact") {
    const contact = dialog.contact;
    return (
      <ModalFrame title={contact ? "Edit emergency contact" : "Add emergency contact"} description="This record is visible only to the employee and authorized management." onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const payload = {
            employeeId,
            contactId: contact?.id ?? null,
            name: String(form.get("name")),
            relationship: String(form.get("relationship") || "") || null,
            phone: String(form.get("phone")),
            email: String(form.get("email") || "") || null,
            isPrimary: form.get("isPrimary") === "on",
          };
          const requestId = requestIdFor("people.emergency_contact.save", payload);
          onRun(contact ? "Emergency contact updated." : "Emergency contact added.", () =>
            saveEmergencyContactAction({ requestId, ...payload }),
          );
        }}>
          <div className="grid gap-4 px-5 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><input name="name" required maxLength={240} defaultValue={contact?.name ?? ""} className={fieldClass} /></Field><Field label="Relationship"><input name="relationship" maxLength={120} defaultValue={contact?.relationship ?? ""} className={fieldClass} /></Field></div>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Phone"><input name="phone" type="tel" required maxLength={80} defaultValue={contact?.phone ?? ""} className={fieldClass} /></Field><Field label="Email"><input name="email" type="email" maxLength={320} defaultValue={contact?.email ?? ""} className={fieldClass} /></Field></div>
            <label className="flex items-center gap-3 rounded-xl bg-[var(--canvas)] p-3 text-[10px]"><input name="isPrimary" type="checkbox" defaultChecked={contact?.isPrimary ?? member.emergencyContacts.length === 0} className="size-4 accent-[var(--accent)]" /><span className="font-semibold">Primary emergency contact</span></label>
          </div>
          <DialogFooter busy={busy} action={contact ? "Save contact" : "Add contact"} onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "document-upload") {
    return (
      <ModalFrame title="Upload employee document" description="PDF, JPEG, PNG, or WebP up to 25 MB. The file stays private and is checked before its metadata is bound." onClose={onClose}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const file = form.get("file");
          const fingerprintPayload = {
            employeeId,
            locationId: String(form.get("locationId")),
            documentType: String(form.get("documentType")),
            title: String(form.get("title")),
            employeeVisible: form.get("employeeVisible") === "on",
            file:
              file instanceof File
                ? {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    lastModified: file.lastModified,
                  }
                : null,
          };
          onUpload({
            form: event.currentTarget,
            requestId: requestIdFor(
              "people.employee_document.finalize",
              fingerprintPayload,
            ),
          });
        }}>
          <div className="grid gap-4 px-5 py-5 sm:px-6">
            <Field label="Restaurant scope"><select name="locationId" required defaultValue={locations[0]?.id} className={fieldClass}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Document title"><input name="title" required maxLength={240} className={fieldClass} /></Field><Field label="Document type"><input name="documentType" required maxLength={120} placeholder="Handbook, permit…" className={fieldClass} /></Field></div>
            <Field label="Private file"><input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="focus-ring block w-full rounded-xl border border-dashed border-[var(--line)] bg-[var(--canvas)] px-3 py-4 text-[10px] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--paper-strong)] file:px-3 file:py-2 file:text-[10px] file:font-semibold" /></Field>
            <label className="flex items-center gap-3 rounded-xl bg-[var(--canvas)] p-3 text-[10px]"><input name="employeeVisible" type="checkbox" defaultChecked className="size-4 accent-[var(--accent)]" /><span><span className="font-semibold">Visible to employee</span><span className="mt-0.5 block text-[9px] text-[var(--ink-faint)]">Turn off only for legitimate management-only records.</span></span></label>
          </div>
          <DialogFooter busy={busy} action="Upload document" onClose={onClose} />
        </form>
      </ModalFrame>
    );
  }

  const document = dialog.document;
  return (
    <ModalFrame title="Edit document metadata" description="The private object and uploader evidence stay immutable; only title, type, and employee visibility can change." onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const payload = {
          documentId: document.id,
          documentType: String(form.get("documentType")),
          title: String(form.get("title")),
          employeeVisible: form.get("employeeVisible") === "on",
        };
        const requestId = requestIdFor("people.employee_document.metadata", payload);
        onRun("Employee document metadata updated.", () =>
          updateEmployeeDocumentAction({ requestId, ...payload }),
        );
      }}>
        <div className="grid gap-4 px-5 py-5 sm:px-6">
          <Field label="Document title"><input name="title" required maxLength={240} defaultValue={document.title} className={fieldClass} /></Field>
          <Field label="Document type"><input name="documentType" required maxLength={120} defaultValue={document.documentType} className={fieldClass} /></Field>
          <label className="flex items-center gap-3 rounded-xl bg-[var(--canvas)] p-3 text-[10px]"><input name="employeeVisible" type="checkbox" defaultChecked={document.employeeVisible} className="size-4 accent-[var(--accent)]" /><span className="font-semibold">Visible to employee</span></label>
        </div>
        <DialogFooter busy={busy} action="Save metadata" onClose={onClose} />
      </form>
    </ModalFrame>
  );
}
