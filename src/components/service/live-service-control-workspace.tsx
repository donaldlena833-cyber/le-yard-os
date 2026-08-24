"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ClipboardPenLine,
  LoaderCircle,
  Plus,
  Radio,
} from "lucide-react";
import {
  acknowledgePreshiftAction,
  recordServiceAvailabilityAction,
  saveManagerLogAction,
  savePreshiftAction,
} from "@/app/actions/workflows/service-control";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ConversationLog } from "@/components/ui/conversation-log";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveServiceControlModel,
  PreshiftRecord,
} from "@/data/read-models/service-control";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";

const field =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none focus:border-[var(--accent)]";
const area = `${field} min-h-24 py-3`;
const optional = (value: FormDataEntryValue | null) =>
  String(value ?? "").trim() || null;
const numberOrNull = (value: FormDataEntryValue | null) =>
  String(value ?? "").trim() ? Number(value) : null;
const sentence = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const stationAssignments = (items: unknown[]) =>
  items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return [
          record.station,
          record.employeeName ?? record.employee,
          record.note,
        ]
          .filter((value) => typeof value === "string" && value.trim())
          .join(" — ");
      }
      return "";
    })
    .filter(Boolean)
    .join(" · ");

type AvailabilityStatus =
  | "available"
  | "running_low"
  | "eighty_sixed"
  | "restored";

interface AvailabilityReview {
  requestId: string;
  locationId: string;
  subjectType: "menu_item" | "component";
  subjectId: string;
  subjectLabel: string;
  expectedEventId: string | null;
  status: AvailabilityStatus;
  estimatedPortions: number | null;
  reason: string | null;
  effectiveAt: string;
  expectedRestorationAt: null;
  notes: string | null;
  undoStatus: AvailabilityStatus;
}

function PreshiftBrief({
  preshift,
  canManage,
  busy,
  acknowledge,
}: {
  preshift: PreshiftRecord;
  canManage: boolean;
  busy: boolean;
  acknowledge: () => void;
}) {
  const fields = [
    ["Allergies", preshift.allergyNotes || "No allergy notes recorded"],
    ["VIPs", preshift.vipNotes || "No VIP notes recorded"],
    [
      "Large parties",
      preshift.largePartyNotes || "No large-party notes recorded",
    ],
    [
      "Specials and 86 context",
      preshift.specials || "No specials or 86 context recorded",
    ],
    ["Staffing", preshift.staffingNotes || "No staffing notes recorded"],
    [
      "Stations",
      stationAssignments(preshift.stationAssignments) ||
        "No station assignments recorded",
    ],
    [
      "Previous handoff",
      preshift.previousHandoff || "No previous handoff recorded",
    ],
    ["Service goal", preshift.serviceGoal || "No service goal recorded"],
    ["Training point", preshift.trainingPoint || "No training point recorded"],
  ] as const;
  return (
    <article className="rounded-2xl border border-[var(--line)] p-4">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold">
            {sentence(preshift.servicePeriod)} · {preshift.businessDate}
          </span>
          <span className="mt-1 block text-xs text-[var(--ink-faint)]">
            {preshift.bookedCovers == null
              ? "No reservation total connected"
              : `${preshift.bookedCovers} booked covers`}
            {preshift.projectedCovers == null
              ? ""
              : ` · ${preshift.projectedCovers} projected`}{" "}
            · {preshift.acknowledgementCount} acknowledged
          </span>
        </span>
        <StatusPill
          tone={preshift.status === "published" ? "positive" : "neutral"}
        >
          {sentence(preshift.status)}
        </StatusPill>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-[var(--canvas)] p-3">
            <dt className="text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--ink-faint)]">
              {label}
            </dt>
            <dd className="mt-1 text-xs leading-5">{value}</dd>
          </div>
        ))}
        {canManage ? (
          <div className="rounded-xl bg-[var(--warning-soft)] p-3 sm:col-span-2">
            <dt className="text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--warning)]">
              Private manager notes
            </dt>
            <dd className="mt-1 text-xs leading-5">
              {preshift.managerNotes || "No private manager notes recorded"}
            </dd>
          </div>
        ) : null}
      </dl>
      {preshift.status === "published" &&
      !preshift.acknowledgedByCurrentEmployee ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          className="mt-4"
          onClick={acknowledge}
        >
          <Check className="size-4" />I read this brief · Acknowledge
        </Button>
      ) : null}
      {preshift.acknowledgedByCurrentEmployee ? (
        <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[var(--positive)]">
          <Check className="size-4" />
          You acknowledged this exact brief version.
        </p>
      ) : null}
    </article>
  );
}
const serviceControlRealtimeBindings = [
  { table: "service_availability_events", scope: "location" },
  { table: "manager_log_entries", scope: "location" },
  { table: "preshifts", scope: "location" },
  { table: "preshift_acknowledgements", scope: "location" },
] satisfies readonly RealtimeInvalidationBinding[];

export function LiveServiceControlWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveServiceControlModel>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [availabilityReview, setAvailabilityReview] =
    useState<AvailabilityReview | null>(null);
  const [availabilityUndo, setAvailabilityUndo] =
    useState<AvailabilityReview | null>(null);

  const realtime = useRealtimeInvalidation({
    enabled: workspace.mode === "live" && result.ok,
    channelName: `service-control:${workspace.activeLocation.id}`,
    bindings: serviceControlRealtimeBindings,
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
  });

  if (!result.ok)
    return (
      <PageFrame>
        <p
          role="alert"
          className="rounded-2xl bg-[var(--danger-soft)] p-5 text-sm text-[var(--danger)]"
        >
          {result.message}
        </p>
      </PageFrame>
    );
  const model = result.data;
  async function perform(
    action: Promise<{ ok: boolean; message?: string }>,
    success: string,
  ) {
    setBusy(true);
    setNotice("");
    try {
      const response = await action;
      if (!response.ok) {
        setNotice(response.message ?? "The change could not be saved.");
        return false;
      } else {
        setNotice(success);
        router.refresh();
        return true;
      }
    } finally {
      setBusy(false);
    }
  }
  function availabilitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subjectKey = String(form.get("subject") ?? "");
    const [subjectType, subjectId] = subjectKey.split(":");
    const subject = model.availabilitySubjects.find(
      (candidate) =>
        candidate.subjectType === subjectType && candidate.id === subjectId,
    );
    const status = String(form.get("status")) as AvailabilityStatus;
    if (!subject || !["running_low", "eighty_sixed", "restored"].includes(status)) {
      setNotice("Choose a current menu item or component and a valid status.");
      return;
    }
    const current = model.availability.find(
      (item) =>
        item.subjectType === subject.subjectType && item.subjectId === subject.id,
    );
    setAvailabilityReview({
      requestId: crypto.randomUUID(),
      locationId: workspace.activeLocation.id,
      subjectType: subject.subjectType,
      subjectId: subject.id,
      subjectLabel: subject.label,
      expectedEventId: current?.id ?? null,
      status,
      estimatedPortions: numberOrNull(form.get("estimatedPortions")),
      reason: optional(form.get("reason")),
      effectiveAt: new Date().toISOString(),
      expectedRestorationAt: null,
      notes: optional(form.get("notes")),
      undoStatus:
        current?.status === "running_low" || current?.status === "eighty_sixed"
          ? current.status
          : current?.status === "available"
            ? "available"
            : "restored",
    });
  }

  async function confirmAvailability() {
    if (!availabilityReview) return;
    const change = availabilityReview;
    const saved = await perform(
      recordServiceAvailabilityAction(change),
      `${change.subjectLabel} updated for the whole team.`,
    );
    setAvailabilityReview(null);
    if (saved) setAvailabilityUndo(change);
  }

  async function undoAvailability() {
    if (!availabilityUndo) return;
    const change = availabilityUndo;
    const restored = await perform(
      recordServiceAvailabilityAction({
        ...change,
        requestId: crypto.randomUUID(),
        expectedEventId: change.requestId,
        status: change.undoStatus,
        estimatedPortions: null,
        reason: "Undone from Service Control",
        effectiveAt: new Date().toISOString(),
        notes: `Reversed ${sentence(change.status)} update.`,
      }),
      `${change.subjectLabel} returned to its previous status.`,
    );
    if (restored) setAvailabilityUndo(null);
  }
  function managerLogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(
      saveManagerLogAction({
        requestId: crypto.randomUUID(),
        entryId: null,
        locationId: workspace.activeLocation.id,
        businessDate: model.date,
        servicePeriod: form.get("servicePeriod"),
        category: form.get("category"),
        severity: form.get("severity"),
        title: form.get("title"),
        narrative: form.get("narrative"),
        status: form.get("status"),
        resolution: null,
        dueDate: null,
      }),
      "Manager handoff saved with version history.",
    );
  }
  function preshiftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void perform(
      savePreshiftAction({
        requestId: crypto.randomUUID(),
        preshiftId: null,
        locationId: workspace.activeLocation.id,
        businessDate: model.date,
        servicePeriod: form.get("servicePeriod"),
        status: form.get("status"),
        bookedCovers: numberOrNull(form.get("bookedCovers")),
        projectedCovers: null,
        vipNotes: optional(form.get("vipNotes")),
        allergyNotes: optional(form.get("allergyNotes")),
        largePartyNotes: optional(form.get("largePartyNotes")),
        specials: optional(form.get("specials")),
        staffingNotes: optional(form.get("staffingNotes")),
        serviceGoal: optional(form.get("serviceGoal")),
        trainingPoint: optional(form.get("trainingPoint")),
        managerNotes: optional(form.get("managerNotes")),
      }),
      `Pre-shift ${form.get("status") === "published" ? "published" : "draft saved"}.`,
    );
  }

  return (
    <PageFrame>
      <section className="rounded-[26px] bg-[var(--graphite)] p-6 text-white sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="neutral" className="bg-white/[0.08] text-white">
            Server snapshot
          </StatusPill>
          <span className="text-xs text-white/50">
            {workspace.activeLocation.name}
          </span>
        </div>
        <h2 className="mt-4 text-3xl font-medium tracking-[-0.05em]">
          Service control
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
          Availability, shift handoff, and the published pre-shift—one shared
          operating picture without invented reservation data.
        </p>
      </section>
      <RealtimeSyncStatus {...realtime} />
      {notice ? (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-xs text-[var(--accent-strong)]"
        >
          <span className="min-w-0 flex-1">{notice}</span>
          {availabilityUndo ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void undoAvailability()}>
              Undo availability change
            </Button>
          ) : null}
        </div>
      ) : null}
      <section className="mt-8">
        <SectionHeading
          eyebrow="Live availability"
          title="Running low & 86"
          detail="Internal status only; Toast is not changed."
        />
        {model.canManageAvailability ? (
          <form
            onSubmit={availabilitySubmit}
            className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 md:grid-cols-6"
          >
            <select
              required
              aria-label="Availability item"
              name="subject"
              defaultValue=""
              className={`${field} md:col-span-3`}
            >
              <option value="" disabled>Choose a menu item or component</option>
              {model.availabilitySubjects.map((subject) => (
                <option key={`${subject.subjectType}:${subject.id}`} value={`${subject.subjectType}:${subject.id}`}>
                  {subject.subjectType === "menu_item" ? "Menu" : "Component"} · {subject.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Availability status"
              name="status"
              className={field}
            >
              <option value="running_low">Running low</option>
              <option value="eighty_sixed">86</option>
              <option value="restored">Restored</option>
            </select>
            <input
              name="estimatedPortions"
              type="number"
              min="0"
              step="0.001"
              placeholder="Portions"
              className={field}
            />
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Radio className="size-4" />
              )}
              Update
            </Button>
            <input
              name="reason"
              placeholder="Reason (optional)"
              className={`${field} md:col-span-3`}
            />
            <input
              name="notes"
              placeholder="Team note (optional)"
              className={`${field} md:col-span-3`}
            />
          </form>
        ) : null}
        {model.canManageAvailability && !model.availabilitySubjects.length ? (
          <p className="mt-3 rounded-xl bg-[var(--warning-soft)] px-4 py-3 text-xs text-[var(--warning)]">
            Add an active recipe or inventory item before recording availability.
          </p>
        ) : null}
        <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {model.availability.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold">
                  {item.subjectLabel}
                </span>
                <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                  {item.reason || item.notes || "No note"}
                </span>
              </span>
              {item.estimatedPortions != null ? (
                <span className="numeric text-xs">
                  {item.estimatedPortions} portions
                </span>
              ) : null}
              <StatusPill
                tone={
                  item.status === "eighty_sixed"
                    ? "danger"
                    : item.status === "running_low"
                      ? "warning"
                      : "positive"
                }
              >
                {item.status === "eighty_sixed" ? "86" : sentence(item.status)}
              </StatusPill>
            </div>
          ))}
          {!model.availability.length ? (
            <p className="py-8 text-center text-xs text-[var(--ink-faint)]">
              No availability events yet.
            </p>
          ) : null}
        </div>
      </section>
      <div
        className={`mt-9 grid gap-9 ${model.canManageLog ? "xl:grid-cols-2" : "max-w-3xl"}`}
      >
        {model.canManageLog ? (
          <section>
            <SectionHeading
              eyebrow="Handoff"
              title="Manager Log"
              detail="Unresolved entries carry into the next service."
            />
            <form
              onSubmit={managerLogSubmit}
              className="grid gap-3 rounded-2xl border border-[var(--line)] p-4 sm:grid-cols-2"
            >
              <input
                required
                name="title"
                placeholder="Handoff title"
                className={`${field} sm:col-span-2`}
              />
              <textarea
                required
                name="narrative"
                placeholder="What happened and what needs follow-up?"
                className={`${area} sm:col-span-2`}
              />
              <select
                aria-label="Manager log service period"
                name="servicePeriod"
                className={field}
              >
                <option value="dinner">Dinner</option>
                <option value="lunch">Lunch</option>
                <option value="all_day">All day</option>
                <option value="other">Other</option>
              </select>
              <select
                aria-label="Manager log category"
                name="category"
                className={field}
              >
                <option value="foh">FOH</option>
                <option value="boh">BOH</option>
                <option value="guest">Guest</option>
                <option value="equipment">Equipment</option>
                <option value="inventory">Inventory</option>
                <option value="maintenance">Maintenance</option>
                <option value="other">Other</option>
              </select>
              <select
                aria-label="Manager log severity"
                name="severity"
                className={field}
              >
                <option value="awareness">Awareness</option>
                <option value="action_required">Action required</option>
                <option value="critical">Critical</option>
                <option value="informational">Informational</option>
              </select>
              <select
                aria-label="Manager log status"
                name="status"
                className={field}
              >
                <option value="needs_follow_up">Needs follow-up</option>
                <option value="informational">Informational</option>
                <option value="in_progress">In progress</option>
              </select>
              <Button
                type="submit"
                variant="secondary"
                disabled={busy}
                className="sm:col-span-2"
              >
                <Plus className="size-4" />
                Add handoff
              </Button>
            </form>
            <ConversationLog
              className="mt-4"
              label="Unresolved manager handoffs"
              entries={model.managerLog.map((entry) => ({
                id: entry.id,
                summary: entry.title,
                body: entry.narrative,
                leading: (
                  <ClipboardPenLine className="size-4 text-[var(--accent-strong)]" />
                ),
                context: (
                  <>
                    <span>{sentence(entry.category)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{sentence(entry.servicePeriod)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{entry.businessDate}</span>
                  </>
                ),
                trailing: (
                  <StatusPill
                    tone={
                      entry.severity === "critical"
                        ? "danger"
                        : entry.severity === "action_required"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {sentence(entry.severity)}
                  </StatusPill>
                ),
              }))}
              empty="No unresolved handoffs."
            />
          </section>
        ) : null}
        <section>
          <SectionHeading
            eyebrow="Before service"
            title="Pre-shift"
            detail="Publish facts; employees acknowledge what they read."
          />
          {model.canManagePreshift ? (
            <form
              onSubmit={preshiftSubmit}
              className="grid gap-3 rounded-2xl border border-[var(--line)] p-4 sm:grid-cols-2"
            >
              <select
                aria-label="Pre-shift service period"
                name="servicePeriod"
                className={field}
              >
                <option value="dinner">Dinner</option>
                <option value="lunch">Lunch</option>
                <option value="all_day">All day</option>
              </select>
              <input
                name="bookedCovers"
                type="number"
                min="0"
                placeholder="Booked covers (if known)"
                className={field}
              />
              <textarea
                name="vipNotes"
                placeholder="VIP notes"
                className={area}
              />
              <textarea
                name="allergyNotes"
                placeholder="Allergies"
                className={area}
              />
              <textarea
                name="largePartyNotes"
                placeholder="Large parties"
                className={area}
              />
              <textarea
                name="specials"
                placeholder="Specials and 86 context"
                className={area}
              />
              <textarea
                name="staffingNotes"
                placeholder="Staffing notes"
                className={area}
              />
              <textarea
                name="serviceGoal"
                placeholder="Service goal"
                className={area}
              />
              <input
                name="trainingPoint"
                placeholder="Training point"
                className={`${field} sm:col-span-2`}
              />
              <textarea
                name="managerNotes"
                placeholder="Manager notes"
                className={`${area} sm:col-span-2`}
              />
              <select
                aria-label="Pre-shift publication status"
                name="status"
                className={field}
              >
                <option value="draft">Save draft</option>
                <option value="published">Publish now</option>
              </select>
              <Button type="submit" variant="accent" disabled={busy}>
                <BookOpenCheck className="size-4" />
                Save pre-shift
              </Button>
            </form>
          ) : null}
          <div className="mt-4 space-y-3">
            {model.preshifts.map((preshift) => (
              <PreshiftBrief
                key={preshift.id}
                preshift={preshift}
                canManage={model.canManagePreshift}
                busy={busy}
                acknowledge={() =>
                  void perform(
                    acknowledgePreshiftAction({
                      requestId: crypto.randomUUID(),
                      preshiftId: preshift.id,
                      comment: null,
                    }),
                    "Pre-shift acknowledged.",
                  )
                }
              />
            ))}
            {!model.preshifts.length ? (
              <div className="flex items-center gap-2 rounded-xl bg-[var(--warning-soft)] p-4 text-xs text-[var(--warning)]">
                <AlertTriangle className="size-4" />
                No pre-shift has been created for this service.
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <ConfirmActionDialog
        open={Boolean(availabilityReview)}
        labelledBy="confirm-service-availability"
        title={availabilityReview ? `Confirm ${availabilityReview.subjectLabel} update?` : "Confirm availability update?"}
        description="This immediately changes the shared service status seen by the team. Toast is not changed."
        confirmLabel="Confirm & update"
        confirmVariant={availabilityReview?.status === "eighty_sixed" ? "danger" : "accent"}
        busy={busy}
        onClose={() => setAvailabilityReview(null)}
        onConfirm={confirmAvailability}
      >
        {availabilityReview ? (
          <dl className="grid gap-3 rounded-[16px] bg-[var(--canvas)] p-4 text-xs">
            <div><dt className="font-semibold text-[var(--ink-faint)]">Item</dt><dd className="mt-1">{availabilityReview.subjectLabel}</dd></div>
            <div><dt className="font-semibold text-[var(--ink-faint)]">New status</dt><dd className="mt-1">{availabilityReview.status === "eighty_sixed" ? "86" : sentence(availabilityReview.status)}</dd></div>
            <div><dt className="font-semibold text-[var(--ink-faint)]">Reason</dt><dd className="mt-1">{availabilityReview.reason || "No reason entered"}</dd></div>
          </dl>
        ) : null}
      </ConfirmActionDialog>
    </PageFrame>
  );
}
