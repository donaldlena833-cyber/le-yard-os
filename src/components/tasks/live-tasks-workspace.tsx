"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileClock,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  PencilLine,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  acknowledgeSopAction,
  completeChecklistRunAction,
  createChecklistEvidenceUploadUrlAction,
  createChecklistTemplateVersionAction,
  createIncidentAction,
  createMaintenanceRequestAction,
  createTaskAction,
  createSopDraftAction,
  createSopVersionAction,
  publishChecklistTemplateAction,
  publishSopVersionAction,
  recordChecklistResponseAction,
  setIncidentStatusAction,
  setMaintenanceStatusAction,
  startChecklistRunAction,
  transitionTaskAction,
  updateSopDraftAction,
} from "@/app/actions/workflows/operations";
import { createPrivateFileDownloadUrlAction } from "@/app/actions/workflows/files";
import { ObjectActionBar } from "@/components/actions/object-action-bar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import { StatusPill } from "@/components/ui/status-pill";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import {
  localDateTimeParts,
  zonedLocalToIso,
} from "@/data/read-models/local-time";
import type {
  LiveChecklistItem,
  LiveChecklistRun,
  LiveIncident,
  LiveMaintenanceRequest,
  LiveOperationsModel,
  LiveOperationsTask,
  LiveSopDocument,
  LiveTaskStatus,
} from "@/data/read-models/operations";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  resolveWorkMode,
  type ActionResolutionContext,
} from "@/lib/actions/action-registry";
import { useModalDialog } from "@/lib/accessibility/use-modal-dialog";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { createClient } from "@/lib/supabase/client";
import { validatePrivateFile } from "@/lib/storage/private-files";
import { cn, formatMoney } from "@/lib/utils";

type Tab = "tasks" | "checklists" | "sops" | "maintenance" | "incidents";
type Notice = { tone: "success" | "error"; text: string };
type ActionResult = { ok: boolean; message?: string };
type RunAction = (
  successMessage: string,
  operation: () => Promise<ActionResult>,
  onSuccess?: () => void,
) => void;
type DialogState =
  | { kind: "task-create" }
  | {
      kind: "task-transition";
      task: LiveOperationsTask;
      suggestedStatus?: LiveTaskStatus;
    }
  | { kind: "checklist-start" }
  | { kind: "checklist-author" }
  | { kind: "sop-create" }
  | { kind: "sop-edit"; sop: LiveSopDocument }
  | { kind: "sop-version"; sop: LiveSopDocument }
  | { kind: "maintenance-create" }
  | { kind: "maintenance-transition"; request: LiveMaintenanceRequest }
  | { kind: "incident-create" }
  | { kind: "incident-transition"; incident: LiveIncident };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "checklists", label: "Checklists" },
  { id: "sops", label: "SOPs" },
  { id: "maintenance", label: "Maintenance" },
  { id: "incidents", label: "Incidents" },
];

const terminalTaskStatuses = new Set(["completed", "cancelled"]);
const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50";
const textAreaClass =
  "w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs leading-5 outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50";

function sentenceCase(value: string) {
  const label = value.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function statusTone(
  value: string,
): "neutral" | "positive" | "warning" | "danger" {
  if (["completed", "resolved", "closed"].includes(value)) return "positive";
  if (["blocked", "high", "urgent", "critical", "emergency"].includes(value))
    return "danger";
  if (["in_progress", "investigating", "medium"].includes(value))
    return "warning";
  return "neutral";
}

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function localInputValue(value: string | null, timeZone: string) {
  if (!value) return "";
  const parts = localDateTimeParts(value, timeZone);
  return `${parts.date}T${parts.time}`;
}

function restaurantInstant(value: FormDataEntryValue | null, timeZone: string) {
  if (typeof value !== "string" || !value) return null;
  const [date, time] = value.split("T");
  return zonedLocalToIso(date, time, timeZone);
}

function managementReady(workspace: WorkspaceContextValue) {
  return (
    workspace.role === "admin" ||
    workspace.role === "manager" ||
    workspace.role === "owner"
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <ReadState
      compact
      state="empty"
      title={title}
      description={detail}
      icon={icon}
      className="rounded-none border-x-0 shadow-none"
    />
  );
}

function ModalFrame({
  title,
  description,
  labelledBy,
  onClose,
  children,
}: {
  title: string;
  description: string;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog({ dialogRef, overlayRef, onClose });

  return (
    <motion.div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/30 px-3 py-5 backdrop-blur-[3px] sm:py-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={`${labelledBy}-description`}
        className="mx-auto w-full max-w-xl overflow-hidden rounded-[26px] bg-[var(--paper-strong)] shadow-[var(--shadow-float)]"
        initial={{ y: 14, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 10, scale: 0.985 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <header className="flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-5 sm:px-7">
          <div>
            <h3
              id={labelledBy}
              className="text-xl font-medium tracking-[-0.04em]"
            >
              {title}
            </h3>
            <p
              id={`${labelledBy}-description`}
              className="mt-1 text-[13px] leading-5 text-[var(--ink-faint)]"
            >
              {description}
            </p>
          </div>
          <Button
            data-modal-initial
            variant="quiet"
            size="icon"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </header>
        {children}
      </motion.section>
    </motion.div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold">{label}</span>
      {children}
    </label>
  );
}

function DialogFooter({
  busy,
  onClose,
  action,
}: {
  busy: boolean;
  onClose: () => void;
  action: string;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] px-5 py-4 sm:px-7">
      <Button variant="quiet" disabled={busy} onClick={onClose}>
        Cancel
      </Button>
      <Button type="submit" variant="accent" disabled={busy}>
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        {action}
      </Button>
    </div>
  );
}

function TaskStatusIcon({ task }: { task: LiveOperationsTask }) {
  if (task.status === "completed") return <Check className="size-3.5" />;
  if (task.status === "in_progress") return <FileClock className="size-3.5" />;
  if (task.status === "blocked") return <CircleAlert className="size-3.5" />;
  return <Circle className="size-4" />;
}

function taskTransitions(
  status: LiveTaskStatus,
  manager: boolean,
): LiveTaskStatus[] {
  if (terminalTaskStatuses.has(status)) return [];
  if (status === "blocked") {
    return manager ? ["open", "in_progress", "cancelled"] : ["in_progress"];
  }
  return manager
    ? (["open", "in_progress", "blocked", "completed", "cancelled"].filter(
        (value) => value !== status,
      ) as LiveTaskStatus[])
    : (["in_progress", "blocked", "completed"].filter(
        (value) => value !== status,
      ) as LiveTaskStatus[]);
}

function taskActionContext(
  workspace: WorkspaceContextValue,
  mayOperate: boolean,
): ActionResolutionContext {
  return {
    role: workspace.role,
    persona: workspace.persona,
    workMode: resolveWorkMode(workspace, workspace.activeJob),
    capabilities: workspace.capabilities,
    servicePhase: "off_hours",
    satisfiedPrerequisites: [
      "active_workspace",
      "selected_task",
      ...(mayOperate ? (["task_operable"] as const) : []),
    ],
  };
}

function checklistItemsFromLines(value: string) {
  const allowed = new Set([
    "checkbox",
    "text",
    "number",
    "photo",
    "temperature",
  ]);
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length)
    return { ok: false as const, message: "Add at least one checklist item." };
  const items = [];
  for (const line of lines) {
    const [
      label = "",
      rawType = "checkbox",
      rawRequired = "required",
      instructions = "",
    ] = line.split("|").map((part) => part.trim());
    const responseType = rawType || "checkbox";
    const requiredWord = rawRequired.toLowerCase() || "required";
    if (
      !label ||
      !allowed.has(responseType) ||
      !["required", "optional"].includes(requiredWord)
    ) {
      return {
        ok: false as const,
        message: `Check this item line: “${line.slice(0, 100)}”.`,
      };
    }
    items.push({
      label,
      instructions: instructions || null,
      responseType,
      required: requiredWord === "required",
      validation: {},
    });
  }
  return { ok: true as const, items };
}

function TaskPanel({
  model,
  workspace,
  canManage,
  busy,
  onDialog,
}: {
  model: LiveOperationsModel;
  workspace: WorkspaceContextValue;
  canManage: boolean;
  busy: boolean;
  onDialog: (dialog: DialogState) => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const tasks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? model.tasks.filter((task) =>
          [
            task.title,
            task.description ?? "",
            task.assigneeName ?? "",
            task.priority,
          ].some((value) => value.toLocaleLowerCase().includes(normalized)),
        )
      : model.tasks;
    return [...filtered].sort(
      (left, right) =>
        Number(terminalTaskStatuses.has(left.status)) -
          Number(terminalTaskStatuses.has(right.status)) ||
        (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999"),
    );
  }, [model.tasks, query]);

  return (
    <section className="mt-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <SectionHeading
          title="Work queue"
          detail="Management creates work; assignees can start, block, or complete their own tasks."
          className="mb-0"
        />
        <div className="flex gap-2">
          <label className="relative block min-w-0 sm:w-64">
            <span className="sr-only">Search tasks</span>
            <Search className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search work"
              className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-3 pl-9 text-xs outline-none transition-colors focus:border-[var(--accent)]"
            />
          </label>
          {canManage ? (
            <Button
              variant="accent"
              size="sm"
              disabled={busy}
              onClick={() => onDialog({ kind: "task-create" })}
            >
              <Plus className="size-3.5" />
              New task
            </Button>
          ) : null}
        </div>
      </div>
      {tasks.length ? (
        <div className="border-y border-[var(--line)]">
          {tasks.map((task) => {
            const mayOperate =
              canManage || task.assignedEmployeeId === model.currentEmployeeId;
            const options = taskTransitions(task.status, canManage);
            const expanded = expandedTaskId === task.id;
            const detailId = `task-details-${task.id}`;
            const openTransition = (status: LiveTaskStatus) =>
              onDialog({
                kind: "task-transition",
                task,
                suggestedStatus: status,
              });
            return (
              <article
                key={task.id}
                className="border-t border-[var(--line)] first:border-0"
              >
                <div className="flex items-start gap-2 px-2 py-3 sm:gap-3 sm:px-3">
                  <Button
                    variant="quiet"
                    size="icon"
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    aria-label={`${expanded ? "Hide" : "Show"} details for ${task.title}`}
                    onClick={() =>
                      setExpandedTaskId((current) =>
                        current === task.id ? null : task.id,
                      )
                    }
                  >
                    <ChevronRight
                      className={cn(
                        "size-4 transition-transform motion-reduce:transition-none",
                        expanded && "rotate-90",
                      )}
                    />
                  </Button>
                  <span
                    className={cn(
                      "mt-1.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                      task.status === "completed" &&
                        "bg-[var(--positive-soft)] text-[var(--positive)]",
                      task.status === "in_progress" &&
                        "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
                      task.status === "blocked" &&
                        "bg-[var(--danger-soft)] text-[var(--danger)]",
                      ["open", "cancelled"].includes(task.status) &&
                        "bg-[var(--canvas-strong)] text-[var(--ink-faint)]",
                    )}
                  >
                    <TaskStatusIcon task={task} />
                  </span>
                  <div className="min-w-0 flex-1 py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={cn(
                          "text-xs font-semibold",
                          task.status === "completed" &&
                            "text-[var(--ink-faint)] line-through",
                        )}
                      >
                        {task.title}
                      </h3>
                      <StatusPill tone={statusTone(task.priority)}>
                        {sentenceCase(task.priority)}
                      </StatusPill>
                      <StatusPill tone={statusTone(task.status)}>
                        {sentenceCase(task.status)}
                      </StatusPill>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-faint)]">
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3" />
                        {task.assigneeName ?? "Unassigned"}
                      </span>
                      <span className="numeric inline-flex items-center gap-1">
                        <Clock3 className="size-3" />
                        {task.dueAt
                          ? `Due ${dateTimeLabel(task.dueAt, model.timeZone)}`
                          : "No due time"}
                      </span>
                    </div>
                  </div>
                  {terminalTaskStatuses.has(task.status) ? (
                    <LockKeyhole
                      className="mt-3 size-3.5 shrink-0 text-[var(--ink-faint)]"
                      aria-label="Terminal task locked"
                    />
                  ) : null}
                </div>
                {expanded ? (
                  <div
                    id={detailId}
                    className="border-t border-[var(--line)] bg-[var(--canvas)] px-4 py-4 sm:ml-[88px] sm:px-5"
                  >
                    <p className="max-w-3xl text-xs leading-5 text-[var(--ink-soft)]">
                      {task.description || "No additional task instructions."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-faint)]">
                      <span>
                        Source ·{" "}
                        {task.sourceType
                          ? sentenceCase(task.sourceType)
                          : "Manual task"}
                      </span>
                      <span>
                        Created {dateTimeLabel(task.createdAt, model.timeZone)}
                      </span>
                    </div>
                    {task.completedAt ? (
                      <p className="mt-3 text-xs text-[var(--positive)]">
                        Completed{" "}
                        {dateTimeLabel(task.completedAt, model.timeZone)}
                        {task.completedByName
                          ? ` by ${task.completedByName}`
                          : ""}
                      </p>
                    ) : null}
                    {mayOperate && options.length ? (
                      <ObjectActionBar
                        entity="task"
                        state={task.status}
                        context={taskActionContext(workspace, mayOperate)}
                        label={`Actions for ${task.title}`}
                        className="mt-4 flex flex-wrap gap-2"
                        size="sm"
                        busy={busy}
                        handlers={{
                          "task.start": () => openTransition("in_progress"),
                          "task.resume": () => openTransition("in_progress"),
                          "task.block": () => openTransition("blocked"),
                          "task.complete": () => openTransition("completed"),
                          ...(canManage
                            ? {
                                "task.reset": () => openTransition("open"),
                                "task.cancel": () =>
                                  openTransition("cancelled"),
                              }
                            : {}),
                        }}
                        icons={{
                          "task.start": <FileClock className="size-3.5" />,
                          "task.resume": <ArrowUpRight className="size-3.5" />,
                          "task.block": <CircleAlert className="size-3.5" />,
                          "task.complete": (
                            <CheckCircle2 className="size-3.5" />
                          ),
                          "task.reset": <Circle className="size-3.5" />,
                          "task.cancel": <X className="size-3.5" />,
                        }}
                        variants={{
                          "task.complete": "accent",
                          "task.cancel": "danger",
                        }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<CheckCircle2 className="size-4" />}
          title={
            model.tasks.length
              ? "No matching tasks"
              : "No tasks in this location scope"
          }
          detail={
            model.tasks.length
              ? "Try a different title, assignee, or priority."
              : canManage
                ? "Create the first tenant-scoped task for this location."
                : "Management has not assigned work in this location scope."
          }
        />
      )}
    </section>
  );
}

function checklistDisplayStatus(run: LiveChecklistRun) {
  return run.approvedAt ? "approved" : run.status;
}

function initialChecklistValue(item: LiveChecklistItem) {
  if (typeof item.response === "boolean")
    return item.response ? "true" : "false";
  if (typeof item.response === "number" || typeof item.response === "string")
    return String(item.response);
  return "";
}

function ChecklistResponseForm({
  item,
  run,
  busy,
  onRun,
}: {
  item: LiveChecklistItem;
  run: LiveChecklistRun;
  busy: boolean;
  onRun: RunAction;
}) {
  const [value, setValue] = useState(() => initialChecklistValue(item));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  if (item.responseType === "photo") {
    function savePhoto(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!photo) return;
      const validation = validatePrivateFile(
        "checklists",
        photo.type,
        photo.size,
      );
      if (!validation.ok) {
        onRun(
          validation.message ?? "Choose a supported checklist image.",
          async () => ({
            ok: false,
            message:
              validation.message ?? "Choose a supported checklist image.",
          }),
        );
        return;
      }
      const uploadScope = `operations.checklist.photo-upload.${run.id}.${item.id}`;
      const uploadPayload = {
        runId: run.id,
        templateItemId: item.id,
        fileName: photo.name,
        mimeType: photo.type,
        sizeBytes: photo.size,
      };
      const responseScope = `operations.checklist.photo-response.${run.id}.${item.id}`;
      onRun(
        `${item.label} photo evidence recorded.`,
        async () => {
          const prepared = await createChecklistEvidenceUploadUrlAction({
            uploadId: requestIdFor(uploadScope, {
              ...uploadPayload,
              lastModified: photo.lastModified,
            }),
            ...uploadPayload,
          });
          if (!prepared.ok || !("data" in prepared)) {
            return {
              ok: false,
              message: prepared.ok
                ? "The private checklist upload could not start."
                : prepared.message,
            };
          }
          const uploaded = await createClient()
            .storage.from("checklists")
            .uploadToSignedUrl(
              prepared.data.objectPath,
              prepared.data.token,
              photo,
              {
                contentType: photo.type,
              },
            );
          if (uploaded.error) {
            return {
              ok: false,
              message: "The encrypted checklist image transfer did not finish.",
            };
          }
          const responsePayload = {
            runId: run.id,
            templateItemId: item.id,
            response: {
              file_name: photo.name,
              mime_type: photo.type,
              size_bytes: photo.size,
            },
            storagePath: prepared.data.objectPath,
            notes: notes.trim() || null,
          };
          return recordChecklistResponseAction({
            requestId: requestIdFor(responseScope, responsePayload),
            ...responsePayload,
          });
        },
        () => {
          rotateRequestId(uploadScope);
          rotateRequestId(responseScope);
          setPhoto(null);
        },
      );
    }

    return (
      <form
        onSubmit={savePhoto}
        className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
      >
        <div>
          <span className="mb-1.5 block text-xs font-semibold">
            Private image
          </span>
          <label className="focus-ring flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">
            <ImagePlus className="size-3.5 text-[var(--accent-strong)]" />
            <span className="min-w-0 flex-1 truncate">
              {photo?.name ??
                (item.recorded ? "Replace evidence" : "Choose image")}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={busy}
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <FieldLabel label="Note">
          <input
            value={notes}
            maxLength={2_000}
            disabled={busy}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional context"
            className={fieldClass}
          />
        </FieldLabel>
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={busy || !photo}
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {item.recorded ? "Replace" : "Upload"}
        </Button>
      </form>
    );
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let response: boolean | number | string = value;
    if (item.responseType === "checkbox") response = value === "true";
    if (["number", "temperature"].includes(item.responseType))
      response = Number(value);
    const scope = `operations.checklist.response.${run.id}.${item.id}`;
    const payload = {
      runId: run.id,
      templateItemId: item.id,
      response,
      storagePath: null,
      notes: notes.trim() || null,
    };
    onRun(
      `${item.label} recorded with server-stamped evidence.`,
      () =>
        recordChecklistResponseAction({
          requestId: requestIdFor(scope, payload),
          ...payload,
        }),
      () => rotateRequestId(scope),
    );
  }

  return (
    <form
      onSubmit={save}
      className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
    >
      <FieldLabel label="Response">
        {item.responseType === "checkbox" ? (
          <select
            required
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            className={fieldClass}
          >
            <option value="">Choose</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : (
          <input
            required
            type={
              ["number", "temperature"].includes(item.responseType)
                ? "number"
                : "text"
            }
            step="any"
            maxLength={item.responseType === "text" ? 10_000 : undefined}
            value={value}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            className={fieldClass}
          />
        )}
      </FieldLabel>
      <FieldLabel label="Note">
        <input
          value={notes}
          maxLength={2_000}
          disabled={busy}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional context"
          className={fieldClass}
        />
      </FieldLabel>
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={busy || value === ""}
      >
        {busy ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
        {item.recorded ? "Update" : "Record"}
      </Button>
    </form>
  );
}

function ChecklistPanel({
  model,
  canManage,
  busy,
  onDialog,
  onRun,
}: {
  model: LiveOperationsModel;
  canManage: boolean;
  busy: boolean;
  onDialog: (dialog: DialogState) => void;
  onRun: RunAction;
}) {
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const today = model.checklistRuns.filter(
    (run) => run.businessDate === model.date,
  );
  const [selectedId, setSelectedId] = useState(
    today[0]?.id ?? model.checklistRuns[0]?.id ?? null,
  );
  const selected =
    model.checklistRuns.find((run) => run.id === selectedId) ?? null;
  const mayStart = canManage || Boolean(model.currentEmployeeId);
  const mayOperateSelected = Boolean(
    selected &&
    (canManage || selected.assignedEmployeeId === model.currentEmployeeId),
  );
  const requiredComplete = selected
    ? selected.requiredResponseCount === selected.requiredCount
    : false;

  return (
    <section className="mt-5 grid gap-7 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
      <div>
        <SectionHeading
          title="Checklist runs"
          detail={`${dateLabel(model.date)} · responses are server stamped`}
          action={
            <div className="flex gap-2">
              {canManage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDialog({ kind: "checklist-author" })}
                >
                  <PencilLine className="size-3.5" />
                  New version
                </Button>
              ) : null}
              {mayStart &&
              model.checklistTemplates.some((template) => template.active) ? (
                <Button
                  variant="accent"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDialog({ kind: "checklist-start" })}
                >
                  <Plus className="size-3.5" />
                  Start run
                </Button>
              ) : null}
            </div>
          }
        />
        {model.checklistRuns.length ? (
          <div className="border-y border-[var(--line)]">
            {model.checklistRuns.map((run) => (
              <button
                key={run.id}
                onClick={() => setSelectedId(run.id)}
                aria-pressed={selected?.id === run.id}
                className={cn(
                  "focus-ring flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)]",
                  selected?.id === run.id && "bg-[var(--paper)]",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]">
                  <FileCheck2 className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {run.templateName}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                    {dateLabel(run.businessDate)} · {run.responseCount}/
                    {run.items.length} responses · v{run.templateVersion}
                  </span>
                </span>
                <StatusPill tone={statusTone(checklistDisplayStatus(run))}>
                  {sentenceCase(checklistDisplayStatus(run))}
                </StatusPill>
                <ChevronRight className="size-3.5 text-[var(--ink-faint)]" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileCheck2 className="size-4" />}
            title="No checklist runs yet"
            detail={
              mayStart
                ? "Start an active template for this location and business date."
                : "An active employee profile is required to start a staff checklist."
            }
          />
        )}
        {model.checklistTemplates.length ? (
          <div className="mt-6">
            <p className="eyebrow mb-2">Template versions</p>
            <div className="border-y border-[var(--line)]">
              {model.checklistTemplates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center gap-3 border-t border-[var(--line)] px-3 py-3 first:border-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {template.name}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                      {sentenceCase(template.checklistType)} · v
                      {template.version} · {template.itemCount} items ·{" "}
                      {template.requiredCount} required
                    </span>
                  </span>
                  <StatusPill
                    tone={
                      !template.active
                        ? "neutral"
                        : template.todayRunId
                          ? "positive"
                          : "warning"
                    }
                  >
                    {!template.active
                      ? "Draft"
                      : template.todayRunId
                        ? "Run created"
                        : "Published"}
                  </StatusPill>
                  {canManage && !template.active ? (
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        const scope = `operations.checklist.publish.${template.id}`;
                        const payload = { templateId: template.id };
                        onRun(
                          `Checklist ${template.name} v${template.version} published.`,
                          () =>
                            publishChecklistTemplateAction({
                              requestId: requestIdFor(scope, payload),
                              ...payload,
                            }),
                          () => rotateRequestId(scope),
                        );
                      }}
                    >
                      Publish
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {selected ? (
        <article className="self-start overflow-hidden rounded-[24px] bg-[var(--paper)]">
          <header className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="eyebrow">
                  {sentenceCase(selected.checklistType)} · Version{" "}
                  {selected.templateVersion}
                </p>
                <h3 className="mt-2 text-xl font-medium tracking-[-0.04em]">
                  {selected.templateName}
                </h3>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {dateLabel(selected.businessDate)} ·{" "}
                  {selected.assigneeName ?? "Unassigned"}
                </p>
              </div>
              <StatusPill
                tone={statusTone(checklistDisplayStatus(selected))}
                dot
              >
                {sentenceCase(checklistDisplayStatus(selected))}
              </StatusPill>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <StatusPill tone={requiredComplete ? "positive" : "warning"}>
                {selected.requiredResponseCount}/{selected.requiredCount}{" "}
                required responses recorded
              </StatusPill>
              {terminalTaskStatuses.has(selected.status) ||
              selected.approvedAt ? (
                <StatusPill tone="neutral">
                  <LockKeyhole className="size-3" />
                  Evidence locked
                </StatusPill>
              ) : mayOperateSelected ? (
                <StatusPill tone="warning">In progress</StatusPill>
              ) : (
                <StatusPill tone="neutral">
                  Assigned to another teammate
                </StatusPill>
              )}
            </div>
          </header>
          {selected.items.length ? (
            <div>
              {selected.items.map((item, index) => (
                <div
                  key={item.id}
                  className="border-t border-[var(--line)] px-5 py-4 first:border-0 sm:px-6"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                        item.recorded
                          ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]"
                          : "border-[var(--line-strong)] text-[var(--ink-faint)]",
                      )}
                    >
                      {item.recorded ? (
                        <Check className="size-3.5" />
                      ) : (
                        <span className="numeric text-xs">{index + 1}</span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold">{item.label}</p>
                        {item.required ? (
                          <StatusPill tone="neutral">Required</StatusPill>
                        ) : null}
                      </div>
                      {item.instructions ? (
                        <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                          {item.instructions}
                        </p>
                      ) : null}
                      {item.recorded ? (
                        <p className="mt-2 text-xs text-[var(--ink-soft)]">
                          Response ·{" "}
                          <span className="font-semibold">
                            {item.responseLabel}
                          </span>
                          {item.notes ? ` · ${item.notes}` : ""}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--ink-faint)]">
                          No response recorded
                        </p>
                      )}
                      {item.respondedAt ? (
                        <p className="numeric mt-1 text-xs text-[var(--ink-faint)]">
                          {item.respondedBy} ·{" "}
                          {dateTimeLabel(item.respondedAt, model.timeZone)}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill tone="neutral">
                      {sentenceCase(item.responseType)}
                    </StatusPill>
                  </div>
                  {selected.status === "in_progress" && mayOperateSelected ? (
                    <ChecklistResponseForm
                      item={item}
                      run={selected}
                      busy={busy}
                      onRun={onRun}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-6 py-12 text-center text-xs text-[var(--ink-faint)]">
              This template has no visible items.
            </div>
          )}
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-4 sm:px-6">
            <p className="text-xs leading-4 text-[var(--ink-faint)]">
              Completion locks the run and every response. All required items
              must be recorded.
            </p>
            {selected.status === "in_progress" && mayOperateSelected ? (
              <Button
                variant="accent"
                size="sm"
                disabled={busy || !requiredComplete}
                onClick={() => {
                  if (
                    window.confirm(
                      "Complete this checklist and lock its responses?",
                    )
                  ) {
                    const scope = `operations.checklist.complete.${selected.id}`;
                    const payload = { runId: selected.id, note: null };
                    onRun(
                      "Checklist completed and evidence locked.",
                      () =>
                        completeChecklistRunAction({
                          requestId: requestIdFor(scope, payload),
                          ...payload,
                        }),
                      () => rotateRequestId(scope),
                    );
                  }
                }}
              >
                <CheckCircle2 className="size-3.5" />
                Complete run
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                <LockKeyhole className="size-3.5" />
                {terminalTaskStatuses.has(selected.status)
                  ? "Complete run"
                  : "Not assigned"}
              </Button>
            )}
          </footer>
        </article>
      ) : (
        <div className="self-start rounded-[24px] bg-[var(--paper)] px-6 py-14 text-center">
          <FileCheck2 className="mx-auto size-5 text-[var(--ink-faint)]" />
          <p className="mt-3 text-xs font-semibold">No run selected</p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            Checklist evidence will appear here.
          </p>
        </div>
      )}
    </section>
  );
}

function SopPanel({
  model,
  canManage,
  busy,
  onDialog,
  onRun,
}: {
  model: LiveOperationsModel;
  canManage: boolean;
  busy: boolean;
  onDialog: (dialog: DialogState) => void;
  onRun: RunAction;
}) {
  const [selectedId, setSelectedId] = useState(model.sops[0]?.id ?? null);
  const selected = model.sops.find((sop) => sop.id === selectedId) ?? null;
  return (
    <section className="mt-5 grid gap-7 lg:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
      <div>
        <SectionHeading
          title="Procedures"
          detail={
            canManage
              ? "Draft, version, and publish controlled restaurant procedures."
              : "Only the current published version is shown to staff."
          }
          action={
            canManage ? (
              <Button
                variant="accent"
                size="sm"
                disabled={busy}
                onClick={() => onDialog({ kind: "sop-create" })}
              >
                <Plus className="size-3.5" />
                New SOP
              </Button>
            ) : undefined
          }
        />
        {model.sops.length ? (
          <div className="border-y border-[var(--line)]">
            {model.sops.map((sop) => (
              <button
                key={sop.id}
                onClick={() => setSelectedId(sop.id)}
                aria-pressed={selected?.id === sop.id}
                className={cn(
                  "focus-ring flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)]",
                  selected?.id === sop.id && "bg-[var(--paper)]",
                )}
              >
                <BookOpenText className="size-4 shrink-0 text-[var(--ink-faint)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {sop.title}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                    v{sop.version} · {sop.category || "Uncategorized"}
                    {sop.isDraft
                      ? " · unpublished"
                      : ` · ${sop.acknowledgementCount} acknowledgements`}
                  </span>
                </span>
                <StatusPill
                  tone={
                    sop.isDraft
                      ? "warning"
                      : sop.requiresAcknowledgement &&
                          !sop.acknowledgedByCurrentEmployee
                        ? "warning"
                        : "positive"
                  }
                >
                  {sop.isDraft
                    ? "Draft"
                    : sop.requiresAcknowledgement
                      ? sop.acknowledgedByCurrentEmployee
                        ? "Acknowledged"
                        : "Review"
                      : "Published"}
                </StatusPill>
                <ChevronRight className="size-3.5 text-[var(--ink-faint)]" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpenText className="size-4" />}
            title={canManage ? "No SOPs yet" : "No published SOPs"}
            detail={
              canManage
                ? "Author the first location procedure, then publish it for staff."
                : "Published tenant-scoped versions will appear here."
            }
          />
        )}
      </div>
      {selected ? (
        <SopDetail
          sop={selected}
          model={model}
          canManage={canManage}
          busy={busy}
          onDialog={onDialog}
          onRun={onRun}
        />
      ) : null}
    </section>
  );
}

function SopDetail({
  sop,
  model,
  canManage,
  busy,
  onDialog,
  onRun,
}: {
  sop: LiveSopDocument;
  model: LiveOperationsModel;
  canManage: boolean;
  busy: boolean;
  onDialog: (dialog: DialogState) => void;
  onRun: RunAction;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  async function openFile() {
    if (!sop.storagePath) return;
    setDownloading(true);
    setDownloadNotice(null);
    try {
      const result = await createPrivateFileDownloadUrlAction({
        bucket: "sops",
        objectPath: sop.storagePath,
        downloadFileName: `${sop.title} v${sop.version}`,
      });
      if (!result.ok || !("data" in result)) {
        setDownloadNotice(
          result.ok ? "The private SOP file is unavailable." : result.message,
        );
        return;
      }
      window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
      setDownloadNotice("A short-lived private file link was opened.");
    } finally {
      setDownloading(false);
    }
  }
  return (
    <article className="self-start overflow-hidden rounded-[24px] bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] px-5 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">
              {sop.category || "Procedure"} · Version {sop.version}
            </p>
            <h3 className="mt-2 text-xl font-medium tracking-[-0.04em]">
              {sop.title}
            </h3>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              {sop.isDraft
                ? "Unpublished management draft"
                : `Published ${dateTimeLabel(sop.publishedAt, model.timeZone)}`}
            </p>
          </div>
          <StatusPill tone={sop.isDraft ? "warning" : "positive"} dot>
            {sop.isDraft ? "Draft" : "Published"}
          </StatusPill>
        </div>
        {sop.changeSummary ? (
          <p className="mt-4 rounded-xl bg-[var(--canvas)] px-3.5 py-3 text-xs leading-4 text-[var(--ink-soft)]">
            Version note · {sop.changeSummary}
          </p>
        ) : null}
      </header>
      <div className="max-h-[52svh] overflow-y-auto px-5 py-6 sm:px-7">
        {sop.body ? (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--ink-soft)]">
            {sop.body}
          </div>
        ) : (
          <div className="py-8 text-center">
            <FileCheck2 className="mx-auto size-5 text-[var(--ink-faint)]" />
            <p className="mt-3 text-xs font-semibold">File-backed procedure</p>
            <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
              {sop.storagePath
                ? "Open the current version through a short-lived signed link."
                : "No readable body or source file is attached to this published version."}
            </p>
          </div>
        )}
        {downloadNotice ? (
          <p
            aria-live="polite"
            className="mt-4 text-xs text-[var(--ink-faint)]"
          >
            {downloadNotice}
          </p>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-5 py-4 sm:px-7">
        {sop.isDraft ? (
          <StatusPill tone="warning">
            Not visible as current to staff
          </StatusPill>
        ) : (
          <StatusPill
            tone={
              sop.acknowledgedByCurrentEmployee
                ? "positive"
                : sop.requiresAcknowledgement
                  ? "warning"
                  : "neutral"
            }
          >
            {sop.acknowledgedByCurrentEmployee
              ? `Acknowledged ${dateTimeLabel(sop.currentEmployeeAcknowledgedAt, model.timeZone)}`
              : sop.requiresAcknowledgement
                ? `${sop.acknowledgementCount} acknowledgements`
                : "Acknowledgement not required"}
          </StatusPill>
        )}
        {sop.storagePath ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={downloading}
            onClick={() => void openFile()}
          >
            {downloading ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpRight className="size-3.5" />
            )}
            Open private file
          </Button>
        ) : null}
        {canManage && sop.isDraft ? (
          <>
            <Button
              className="ml-auto"
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => onDialog({ kind: "sop-edit", sop })}
            >
              <PencilLine className="size-3.5" />
              Edit draft
            </Button>
            <Button
              variant="accent"
              size="sm"
              disabled={busy}
              onClick={() => {
                const scope = `operations.sop.publish.${sop.versionId}`;
                const payload = { sopVersionId: sop.versionId };
                onRun(
                  `SOP v${sop.version} published.`,
                  () =>
                    publishSopVersionAction({
                      requestId: requestIdFor(scope, payload),
                      ...payload,
                    }),
                  () => rotateRequestId(scope),
                );
              }}
            >
              <Check className="size-3.5" />
              Publish
            </Button>
          </>
        ) : canManage ? (
          <Button
            className="ml-auto"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onDialog({ kind: "sop-version", sop })}
          >
            <Plus className="size-3.5" />
            New version
          </Button>
        ) : sop.requiresAcknowledgement &&
          !sop.acknowledgedByCurrentEmployee ? (
          <Button
            className="ml-auto"
            variant="accent"
            size="sm"
            disabled={busy || !model.currentEmployeeId}
            title={
              model.currentEmployeeId
                ? undefined
                : "An active employee profile is required"
            }
            onClick={() => {
              const scope = `operations.sop.acknowledge.${sop.versionId}`;
              const payload = { sopVersionId: sop.versionId };
              onRun(
                `SOP v${sop.version} acknowledged.`,
                () =>
                  acknowledgeSopAction({
                    requestId: requestIdFor(scope, payload),
                    ...payload,
                  }),
                () => rotateRequestId(scope),
              );
            }}
          >
            <Check className="size-3.5" />
            Acknowledge v{sop.version}
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

function MaintenancePanel({
  model,
  canManage,
  busy,
  onDialog,
}: {
  model: LiveOperationsModel;
  canManage: boolean;
  busy: boolean;
  onDialog: (dialog: DialogState) => void;
}) {
  return (
    <section className="mt-5">
      <SectionHeading
        title="Maintenance requests"
        detail="Any teammate can report an issue; management owns assignment, cost, and resolution."
        action={
          <Button
            variant="accent"
            size="sm"
            disabled={busy}
            onClick={() => onDialog({ kind: "maintenance-create" })}
          >
            <Plus className="size-3.5" />
            Report issue
          </Button>
        }
      />
      {model.maintenance.length ? (
        <div className="border-y border-[var(--line)]">
          {model.maintenance.map((request) => (
            <article
              key={request.id}
              className="grid gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:px-4"
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-xl",
                  request.priority === "emergency"
                    ? "bg-[var(--danger-soft)] text-[var(--danger)]"
                    : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]",
                )}
              >
                <Wrench className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold">{request.title}</h3>
                  <StatusPill tone={statusTone(request.priority)}>
                    {sentenceCase(request.priority)}
                  </StatusPill>
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-4 text-[var(--ink-faint)]">
                  {request.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-faint)]">
                  <span>Reported by {request.reportedBy}</span>
                  <span>
                    {request.assignedTo
                      ? `Assigned · ${request.assignedTo}`
                      : "Unassigned"}
                  </span>
                  <span>
                    {request.dueAt
                      ? `Due ${dateTimeLabel(request.dueAt, model.timeZone)}`
                      : `Reported ${dateTimeLabel(request.createdAt, model.timeZone)}`}
                  </span>
                  {request.actualCostCents !== null ? (
                    <span>
                      Actual ·{" "}
                      {formatMoney(request.actualCostCents, model.currencyCode)}
                    </span>
                  ) : request.estimatedCostCents !== null ? (
                    <span>
                      Estimate ·{" "}
                      {formatMoney(
                        request.estimatedCostCents,
                        model.currencyCode,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <StatusPill tone={statusTone(request.status)}>
                  {sentenceCase(request.status)}
                </StatusPill>
                {canManage && !terminalTaskStatuses.has(request.status) ? (
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      onDialog({ kind: "maintenance-transition", request })
                    }
                  >
                    <PencilLine className="size-3.5" />
                    Manage
                  </Button>
                ) : terminalTaskStatuses.has(request.status) ? (
                  <LockKeyhole className="size-3.5 text-[var(--ink-faint)]" />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Wrench className="size-4" />}
          title="No maintenance requests"
          detail="No live issues are visible in this location scope."
        />
      )}
    </section>
  );
}

function incidentSummary(incident: LiveIncident) {
  const singleLine = incident.description.replaceAll(/\s+/g, " ").trim();
  return singleLine.length > 150 ? `${singleLine.slice(0, 147)}…` : singleLine;
}

function IncidentPanel({
  model,
  canManage,
  busy,
  onDialog,
}: {
  model: LiveOperationsModel;
  canManage: boolean;
  busy: boolean;
  onDialog: (dialog: DialogState) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    model.incidents.find((incident) => incident.id === selectedId) ?? null;
  return (
    <section className="mt-5">
      <div className="mb-5 flex items-start gap-3 rounded-2xl bg-[var(--warning-soft)] px-4 py-3 text-xs leading-4 text-[var(--warning)]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Incident records are sensitive. The database limits this list to
          reports you filed or management records in your current location
          scope.
        </span>
      </div>
      <SectionHeading
        title="Incident log"
        detail="Select a record to reveal its authorized detail."
        action={
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => onDialog({ kind: "incident-create" })}
          >
            <AlertTriangle className="size-3.5" />
            Report incident
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,.7fr)]">
        {model.incidents.length ? (
          <div className="border-y border-[var(--line)]">
            {model.incidents.map((incident) => (
              <button
                key={incident.id}
                onClick={() => setSelectedId(incident.id)}
                aria-pressed={selected?.id === incident.id}
                className={cn(
                  "focus-ring flex w-full items-start gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)] sm:px-4",
                  selected?.id === incident.id && "bg-[var(--paper)]",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]">
                  <ShieldAlert className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">
                    {sentenceCase(incident.incidentType)}
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-[var(--ink-faint)]">
                    {incidentSummary(incident)}
                  </span>
                  <span className="numeric mt-2 block text-xs text-[var(--ink-faint)]">
                    {dateTimeLabel(incident.occurredAt, model.timeZone)} ·
                    reported by {incident.reportedBy}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-2">
                  <StatusPill tone={statusTone(incident.severity)}>
                    {sentenceCase(incident.severity)}
                  </StatusPill>
                  <StatusPill tone={statusTone(incident.status)}>
                    {sentenceCase(incident.status)}
                  </StatusPill>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ShieldCheck className="size-4" />}
            title="No incident records visible"
            detail="No incidents are available in your role and location scope."
          />
        )}
        {selected ? (
          <article className="self-start rounded-[24px] bg-[var(--paper)] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Sensitive record</p>
                <h3 className="mt-2 text-lg font-semibold">
                  {sentenceCase(selected.incidentType)}
                </h3>
              </div>
              <StatusPill tone={statusTone(selected.status)}>
                {sentenceCase(selected.status)}
              </StatusPill>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--line)] py-4 text-xs">
              <div>
                <dt className="text-[var(--ink-faint)]">Occurred</dt>
                <dd className="mt-1 font-semibold">
                  {dateTimeLabel(selected.occurredAt, model.timeZone)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-faint)]">Severity</dt>
                <dd className="mt-1 font-semibold">
                  {sentenceCase(selected.severity)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--ink-faint)]">Reported by</dt>
                <dd className="mt-1 font-semibold">{selected.reportedBy}</dd>
              </div>
              <div>
                <dt className="text-[var(--ink-faint)]">Involved staff</dt>
                <dd className="mt-1 font-semibold">
                  {selected.involvedEmployeeNames.length
                    ? selected.involvedEmployeeNames.join(", ")
                    : "None recorded"}
                </dd>
              </div>
            </dl>
            <div className="mt-5">
              <p className="text-xs font-semibold">Description</p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[var(--ink-soft)]">
                {selected.description}
              </p>
            </div>
            {selected.followUp ? (
              <div className="mt-5 border-t border-[var(--line)] pt-4">
                <p className="text-xs font-semibold">Follow-up</p>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[var(--ink-soft)]">
                  {selected.followUp}
                </p>
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--canvas)] p-3">
              <p className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-4 text-[var(--ink-faint)]">
                <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
                {selected.resolvedAt
                  ? `Resolved ${dateTimeLabel(selected.resolvedAt, model.timeZone)}${selected.resolvedBy ? ` by ${selected.resolvedBy}` : ""}.`
                  : "Status and follow-up changes are manager-only and server stamped."}
              </p>
              {canManage && selected.status !== "closed" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    onDialog({
                      kind: "incident-transition",
                      incident: selected,
                    })
                  }
                >
                  <PencilLine className="size-3.5" />
                  Update status
                </Button>
              ) : null}
            </div>
          </article>
        ) : (
          <div className="self-start rounded-[24px] bg-[var(--paper)] px-6 py-12 text-center">
            <ShieldAlert className="mx-auto size-5 text-[var(--ink-faint)]" />
            <p className="mt-3 text-xs font-semibold">Details stay concealed</p>
            <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
              Select an authorized incident to view its full record.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function OperationDialog({
  dialog,
  model,
  workspace,
  canManage,
  busy,
  onClose,
  onRun,
  onError,
}: {
  dialog: DialogState;
  model: LiveOperationsModel;
  workspace: WorkspaceContextValue;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: RunAction;
  onError: (message: string) => void;
}) {
  const { requestIdFor } = useStableRequestIds();

  function command<T extends Record<string, unknown>>(
    scope: string,
    payload: T,
  ) {
    return {
      requestId: requestIdFor(`operations.${scope}`, payload),
      ...payload,
    };
  }

  function dueInstant(form: FormData, name: string) {
    const value = form.get(name);
    if (!value) return null;
    const instant = restaurantInstant(value, model.timeZone);
    if (!instant)
      onError(
        "That local date and time does not exist in the restaurant timezone.",
      );
    return instant;
  }

  if (dialog.kind === "task-create")
    return (
      <ModalFrame
        title="Create task"
        description={`Add a location-scoped task for ${workspace.activeLocation.name}. The server records the creator and request evidence.`}
        labelledBy="create-task-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const dueAt = dueInstant(form, "dueAt");
            if (form.get("dueAt") && !dueAt) return;
            const payload = {
              locationId: workspace.activeLocation.id,
              title: String(form.get("title")),
              description: String(form.get("description") || "") || null,
              priority: String(form.get("priority")),
              assignedEmployeeId:
                String(form.get("assignedEmployeeId") || "") || null,
              dueAt,
            };
            onRun(
              "Task created.",
              () => createTaskAction(command("task.create", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Task title">
              <input
                name="title"
                required
                maxLength={240}
                autoFocus
                className={fieldClass}
              />
            </FieldLabel>
            <FieldLabel label="Description">
              <textarea
                name="description"
                rows={4}
                maxLength={10_000}
                className={textAreaClass}
              />
            </FieldLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Priority">
                <select
                  name="priority"
                  defaultValue="normal"
                  className={fieldClass}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </FieldLabel>
              <FieldLabel label="Assignment">
                <select name="assignedEmployeeId" className={fieldClass}>
                  <option value="">Unassigned</option>
                  {model.assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.name}
                      {assignee.id === model.currentEmployeeId ? " (you)" : ""}
                    </option>
                  ))}
                </select>
              </FieldLabel>
            </div>
            <FieldLabel label={`Due time · ${model.timeZone}`}>
              <input
                name="dueAt"
                type="datetime-local"
                className={fieldClass}
              />
            </FieldLabel>
            <p className="text-xs leading-4 text-[var(--ink-faint)]">
              Only active employees assigned to this location today are listed.
              The server revalidates the selected due date.
            </p>
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Create task" />
        </form>
      </ModalFrame>
    );

  if (dialog.kind === "task-transition") {
    const options = taskTransitions(dialog.task.status, canManage);
    const selectedStatus =
      dialog.suggestedStatus && options.includes(dialog.suggestedStatus)
        ? dialog.suggestedStatus
        : options[0];
    return (
      <ModalFrame
        title="Update task"
        description={`${dialog.task.title} · current status ${sentenceCase(dialog.task.status)}.`}
        labelledBy="transition-task-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = {
              taskId: dialog.task.id,
              status: String(form.get("status")),
              note: String(form.get("note") || "") || null,
            };
            onRun(
              "Task status updated.",
              () => transitionTaskAction(command("task.transition", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Next status">
              <select
                name="status"
                required
                defaultValue={selectedStatus}
                className={fieldClass}
              >
                {options.map((status) => (
                  <option key={status} value={status}>
                    {sentenceCase(status)}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Transition note">
              <textarea
                name="note"
                rows={4}
                maxLength={2_000}
                placeholder="Optional handoff or blocker context"
                className={textAreaClass}
              />
            </FieldLabel>
            <p className="flex items-start gap-2 rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Completion time and actor are generated by the server. Terminal
              tasks cannot be reopened.
            </p>
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Update task" />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "checklist-start") {
    const activeTemplates = model.checklistTemplates.filter(
      (template) => template.active,
    );
    return (
      <ModalFrame
        title="Start checklist"
        description="Create an active run from a published template and restaurant business date."
        labelledBy="start-checklist-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = {
              locationId: workspace.activeLocation.id,
              templateId: String(form.get("templateId")),
              businessDate: String(form.get("businessDate")),
              assignedEmployeeId: canManage
                ? String(form.get("assignedEmployeeId") || "") || null
                : model.currentEmployeeId,
            };
            onRun(
              "Checklist run started.",
              () =>
                startChecklistRunAction(command("checklist.start", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Template">
              <select
                name="templateId"
                required
                defaultValue=""
                className={fieldClass}
              >
                <option value="" disabled>
                  Choose a template
                </option>
                {activeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · v{template.version}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Business date">
              <input
                name="businessDate"
                type="date"
                required
                defaultValue={model.date}
                className={fieldClass}
              />
            </FieldLabel>
            {canManage ? (
              <>
                <FieldLabel label="Assignment">
                  <select name="assignedEmployeeId" className={fieldClass}>
                    <option value="">Unassigned</option>
                    {model.assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.name}
                        {assignee.id === model.currentEmployeeId
                          ? " (you)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
                <p className="text-xs leading-4 text-[var(--ink-faint)]">
                  The roster reflects current effective assignments. The server
                  revalidates the selected business date.
                </p>
              </>
            ) : (
              <p className="rounded-xl bg-[var(--accent-soft)]/55 p-3 text-xs leading-4 text-[var(--accent-strong)]">
                This run will be assigned to your active employee profile.
              </p>
            )}
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Start run" />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "checklist-author") {
    return (
      <ModalFrame
        title="Author checklist version"
        description="Create a complete inactive version. Publish it only after reviewing every item."
        labelledBy="author-checklist-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const parsed = checklistItemsFromLines(
              String(form.get("items") || ""),
            );
            if (!parsed.ok) {
              onError(parsed.message);
              return;
            }
            const payload = {
              locationId: workspace.activeLocation.id,
              name: String(form.get("name")),
              checklistType: String(form.get("checklistType")),
              items: parsed.items,
            };
            onRun(
              "Checklist version created as a draft.",
              () =>
                createChecklistTemplateVersionAction(
                  command("checklist.author", payload),
                ),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Template name">
                <input
                  name="name"
                  required
                  maxLength={240}
                  autoFocus
                  placeholder="Closing bar"
                  className={fieldClass}
                />
              </FieldLabel>
              <FieldLabel label="Routine type">
                <select
                  name="checklistType"
                  defaultValue="custom"
                  className={fieldClass}
                >
                  <option value="opening">Opening</option>
                  <option value="closing">Closing</option>
                  <option value="safety">Safety</option>
                  <option value="cleaning">Cleaning</option>
                  <option value="custom">Custom</option>
                </select>
              </FieldLabel>
            </div>
            <FieldLabel label="Items · one per line">
              <textarea
                name="items"
                required
                rows={9}
                maxLength={100_000}
                placeholder={
                  "Lock front door | checkbox | required | Confirm deadbolt\nWalk-in temperature | temperature | required | Enter °F\nClosing photo | photo | optional | Photograph clean bar"
                }
                className={textAreaClass}
              />
            </FieldLabel>
            <p className="rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]">
              Format: label | checkbox, text, number, photo, or temperature |
              required or optional | instructions. A new version with the same
              name keeps prior run evidence intact.
            </p>
          </div>
          <DialogFooter
            busy={busy}
            onClose={onClose}
            action="Create draft version"
          />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "sop-create") {
    return (
      <ModalFrame
        title="Author SOP draft"
        description={`Create an unpublished procedure for ${workspace.activeLocation.name}.`}
        labelledBy="create-sop-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = {
              locationId: workspace.activeLocation.id,
              title: String(form.get("title")),
              category: String(form.get("category") || "") || null,
              requiresAcknowledgement:
                form.get("requiresAcknowledgement") === "on",
              body: String(form.get("body")),
              changeSummary: String(form.get("changeSummary") || "") || null,
            };
            onRun(
              "SOP draft created.",
              () => createSopDraftAction(command("sop.create", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Procedure title">
                <input
                  name="title"
                  required
                  maxLength={240}
                  autoFocus
                  className={fieldClass}
                />
              </FieldLabel>
              <FieldLabel label="Category">
                <input
                  name="category"
                  maxLength={120}
                  placeholder="Service, safety…"
                  className={fieldClass}
                />
              </FieldLabel>
            </div>
            <FieldLabel label="Procedure body">
              <textarea
                name="body"
                required
                rows={12}
                maxLength={100_000}
                className={textAreaClass}
              />
            </FieldLabel>
            <FieldLabel label="Version note">
              <textarea
                name="changeSummary"
                rows={2}
                maxLength={2_000}
                placeholder="Why this procedure exists"
                className={textAreaClass}
              />
            </FieldLabel>
            <label className="flex items-center gap-2 text-xs font-semibold">
              <input
                name="requiresAcknowledgement"
                type="checkbox"
                className="size-4 rounded border-[var(--line)]"
              />
              Require each employee to acknowledge the published version
            </label>
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Create draft" />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "sop-edit") {
    return (
      <ModalFrame
        title="Edit SOP draft"
        description={`${dialog.sop.title} · version ${dialog.sop.version}. Published versions cannot be edited.`}
        labelledBy="edit-sop-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = {
              sopVersionId: dialog.sop.versionId,
              body: String(form.get("body")),
              changeSummary: String(form.get("changeSummary") || "") || null,
            };
            onRun(
              "SOP draft updated.",
              () => updateSopDraftAction(command("sop.edit", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Procedure body">
              <textarea
                name="body"
                required
                rows={14}
                maxLength={100_000}
                defaultValue={dialog.sop.body ?? ""}
                autoFocus
                className={textAreaClass}
              />
            </FieldLabel>
            <FieldLabel label="Version note">
              <textarea
                name="changeSummary"
                rows={3}
                maxLength={2_000}
                defaultValue={dialog.sop.changeSummary ?? ""}
                className={textAreaClass}
              />
            </FieldLabel>
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Save draft" />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "sop-version") {
    return (
      <ModalFrame
        title="Create next SOP version"
        description={`${dialog.sop.title} · start from the current published body, then describe the change.`}
        labelledBy="version-sop-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const payload = {
              sopDocumentId: dialog.sop.id,
              body: String(form.get("body")),
              changeSummary: String(form.get("changeSummary") || "") || null,
            };
            onRun(
              "Next SOP version created as a draft.",
              () => createSopVersionAction(command("sop.version", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Procedure body">
              <textarea
                name="body"
                required
                rows={14}
                maxLength={100_000}
                defaultValue={dialog.sop.body ?? ""}
                autoFocus
                className={textAreaClass}
              />
            </FieldLabel>
            <FieldLabel label="Change summary">
              <textarea
                name="changeSummary"
                required
                rows={3}
                maxLength={2_000}
                placeholder="What changed and why"
                className={textAreaClass}
              />
            </FieldLabel>
            <p className="text-xs leading-4 text-[var(--ink-faint)]">
              The current published version remains visible until this draft is
              explicitly published.
            </p>
          </div>
          <DialogFooter
            busy={busy}
            onClose={onClose}
            action="Create version draft"
          />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "maintenance-create")
    return (
      <ModalFrame
        title="Report maintenance issue"
        description="Create a server-stamped location record. Management can assign and cost it after review."
        labelledBy="create-maintenance-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const dueAt = canManage ? dueInstant(form, "dueAt") : null;
            if (canManage && form.get("dueAt") && !dueAt) return;
            const payload = {
              locationId: workspace.activeLocation.id,
              title: String(form.get("title")),
              description: String(form.get("description")),
              category: String(form.get("category") || "") || null,
              priority: String(form.get("priority")),
              assignedTo: canManage
                ? String(form.get("assignedTo") || "") || null
                : null,
              vendorId: null,
              dueAt,
            };
            onRun(
              "Maintenance issue reported.",
              () =>
                createMaintenanceRequestAction(
                  command("maintenance.create", payload),
                ),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Issue title">
              <input
                name="title"
                required
                maxLength={240}
                autoFocus
                className={fieldClass}
              />
            </FieldLabel>
            <FieldLabel label="Description">
              <textarea
                name="description"
                required
                rows={5}
                maxLength={10_000}
                className={textAreaClass}
              />
            </FieldLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Category">
                <input
                  name="category"
                  maxLength={120}
                  placeholder="Equipment, facilities…"
                  className={fieldClass}
                />
              </FieldLabel>
              <FieldLabel label="Priority">
                <select
                  name="priority"
                  defaultValue="normal"
                  className={fieldClass}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="emergency">Emergency</option>
                </select>
              </FieldLabel>
            </div>
            {canManage ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldLabel label="Assigned to">
                  <input
                    name="assignedTo"
                    maxLength={240}
                    placeholder="Person or team"
                    className={fieldClass}
                  />
                </FieldLabel>
                <FieldLabel label={`Due time · ${model.timeZone}`}>
                  <input
                    name="dueAt"
                    type="datetime-local"
                    className={fieldClass}
                  />
                </FieldLabel>
              </div>
            ) : null}
            <p className="text-xs leading-4 text-[var(--ink-faint)]">
              Vendor selection stays unset because this read model has no
              verified vendor roster.
            </p>
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Report issue" />
        </form>
      </ModalFrame>
    );

  if (dialog.kind === "maintenance-transition") {
    const request = dialog.request;
    const options = taskTransitions(request.status, true);
    return (
      <ModalFrame
        title="Manage maintenance"
        description={`${request.title} · blank optional fields retain their current server value.`}
        labelledBy="transition-maintenance-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const dueAt = dueInstant(form, "dueAt");
            if (form.get("dueAt") && !dueAt) return;
            const estimate = String(form.get("estimatedCost") || "").trim();
            const actual = String(form.get("actualCost") || "").trim();
            const payload = {
              maintenanceRequestId: request.id,
              status: String(form.get("status")),
              assignedTo: String(form.get("assignedTo") || "") || null,
              vendorId: null,
              estimatedCostCents: estimate
                ? Math.round(Number(estimate) * 100)
                : null,
              actualCostCents: actual ? Math.round(Number(actual) * 100) : null,
              dueAt,
              note: String(form.get("note") || "") || null,
            };
            onRun(
              "Maintenance request updated.",
              () =>
                setMaintenanceStatusAction(
                  command("maintenance.transition", payload),
                ),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <FieldLabel label="Next status">
              <select
                name="status"
                required
                defaultValue={options[0]}
                className={fieldClass}
              >
                {options.map((status) => (
                  <option key={status} value={status}>
                    {sentenceCase(status)}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel label="Assigned to">
              <input
                name="assignedTo"
                maxLength={240}
                defaultValue={request.assignedTo ?? ""}
                placeholder="Keep current assignment"
                className={fieldClass}
              />
            </FieldLabel>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label={`Estimated cost · ${model.currencyCode}`}>
                <input
                  name="estimatedCost"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    request.estimatedCostCents === null
                      ? ""
                      : (request.estimatedCostCents / 100).toFixed(2)
                  }
                  className={fieldClass}
                />
              </FieldLabel>
              <FieldLabel label={`Actual cost · ${model.currencyCode}`}>
                <input
                  name="actualCost"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    request.actualCostCents === null
                      ? ""
                      : (request.actualCostCents / 100).toFixed(2)
                  }
                  className={fieldClass}
                />
              </FieldLabel>
            </div>
            <FieldLabel label={`Due time · ${model.timeZone}`}>
              <input
                name="dueAt"
                type="datetime-local"
                defaultValue={localInputValue(request.dueAt, model.timeZone)}
                className={fieldClass}
              />
            </FieldLabel>
            <FieldLabel label="Status note">
              <textarea
                name="note"
                rows={3}
                maxLength={2_000}
                className={textAreaClass}
              />
            </FieldLabel>
            <p className="text-xs leading-4 text-[var(--ink-faint)]">
              Vendor remains unchanged because this surface has no verified
              vendor source. Completion records the resolver and time on the
              server.
            </p>
          </div>
          <DialogFooter busy={busy} onClose={onClose} action="Update request" />
        </form>
      </ModalFrame>
    );
  }

  if (dialog.kind === "incident-create") {
    const now = localDateTimeParts(new Date().toISOString(), model.timeZone);
    return (
      <ModalFrame
        title="Report incident"
        description="Sensitive record. Submit only factual operational details visible to authorized staff and management."
        labelledBy="create-incident-dialog"
        onClose={onClose}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const occurredAt = dueInstant(form, "occurredAt");
            if (!occurredAt) return;
            const payload = {
              locationId: workspace.activeLocation.id,
              incidentType: String(form.get("incidentType")),
              severity: String(form.get("severity")),
              description: String(form.get("description")),
              occurredAt,
              involvedEmployeeIds: [],
              guestId: null,
            };
            onRun(
              "Incident recorded in the restricted log.",
              () => createIncidentAction(command("incident.create", payload)),
              onClose,
            );
          }}
        >
          <div className="grid gap-4 px-5 py-5 sm:px-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldLabel label="Incident type">
                <input
                  name="incidentType"
                  required
                  maxLength={120}
                  autoFocus
                  placeholder="Equipment, safety…"
                  className={fieldClass}
                />
              </FieldLabel>
              <FieldLabel label="Severity">
                <select
                  name="severity"
                  defaultValue="medium"
                  className={fieldClass}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </FieldLabel>
            </div>
            <FieldLabel label={`Occurred · ${model.timeZone}`}>
              <input
                name="occurredAt"
                type="datetime-local"
                required
                defaultValue={`${now.date}T${now.time}`}
                className={fieldClass}
              />
            </FieldLabel>
            <FieldLabel label="Factual description">
              <textarea
                name="description"
                required
                rows={7}
                maxLength={20_000}
                className={textAreaClass}
              />
            </FieldLabel>
            <p className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] p-3 text-xs leading-4 text-[var(--warning)]">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              Staff and guest links remain empty because this Operations source
              does not expose verified selectors. They are never inferred from
              names.
            </p>
          </div>
          <DialogFooter
            busy={busy}
            onClose={onClose}
            action="Record incident"
          />
        </form>
      </ModalFrame>
    );
  }

  const incident = dialog.incident;
  const options =
    incident.status === "open"
      ? ["investigating", "resolved", "closed"]
      : incident.status === "investigating"
        ? ["open", "resolved", "closed"]
        : ["closed"];
  return (
    <ModalFrame
      title="Update incident"
      description={`${sentenceCase(incident.incidentType)} · current status ${sentenceCase(incident.status)}.`}
      labelledBy="transition-incident-dialog"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const payload = {
            incidentId: incident.id,
            status: String(form.get("status")),
            followUp: String(form.get("followUp") || "") || null,
          };
          onRun(
            "Incident status updated.",
            () =>
              setIncidentStatusAction(command("incident.transition", payload)),
            onClose,
          );
        }}
      >
        <div className="grid gap-4 px-5 py-5 sm:px-7">
          <FieldLabel label="Next status">
            <select
              name="status"
              required
              defaultValue={options[0]}
              className={fieldClass}
            >
              {options.map((status) => (
                <option key={status} value={status}>
                  {sentenceCase(status)}
                </option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel label="Follow-up">
            <textarea
              name="followUp"
              rows={6}
              maxLength={10_000}
              defaultValue={incident.followUp ?? ""}
              className={textAreaClass}
            />
          </FieldLabel>
          <p className="flex items-start gap-2 rounded-xl bg-[var(--canvas)] p-3 text-xs leading-4 text-[var(--ink-faint)]">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Resolving records the manager and time. Closed incidents and their
            evidence are immutable.
          </p>
        </div>
        <DialogFooter busy={busy} onClose={onClose} action="Update incident" />
      </form>
    </ModalFrame>
  );
}

export function LiveTasksWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveOperationsModel>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("tasks");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startTransition] = useTransition();
  const model = result.ok ? result.data : null;
  const canManage = managementReady(workspace);

  useEffect(() => {
    if (!model) return;
    const supabase = createClient();
    const channel = supabase
      .channel(
        `operations-${workspace.organization.id}-${workspace.activeLocation.id}`,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `organization_id=eq.${workspace.organization.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "checklist_runs",
          filter: `location_id=eq.${workspace.activeLocation.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "checklist_responses" },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sop_documents",
          filter: `organization_id=eq.${workspace.organization.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sop_versions",
          filter: `organization_id=eq.${workspace.organization.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sop_acknowledgements",
          filter: `organization_id=eq.${workspace.organization.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "maintenance_requests",
          filter: `location_id=eq.${workspace.activeLocation.id}`,
        },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incidents",
          filter: `location_id=eq.${workspace.activeLocation.id}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [model, router, workspace.activeLocation.id, workspace.organization.id]);

  function run(
    successMessage: string,
    operation: () => Promise<ActionResult>,
    onSuccess?: () => void,
  ) {
    setNotice(null);
    startTransition(async () => {
      try {
        const response = await operation();
        if (!response.ok) {
          setNotice({
            tone: "error",
            text: response.message ?? "The operation could not be completed.",
          });
          return;
        }
        setNotice({ tone: "success", text: successMessage });
        onSuccess?.();
        router.refresh();
      } catch {
        setNotice({
          tone: "error",
          text: "The operation could not be completed. Try again.",
        });
      }
    });
  }

  if (!result.ok)
    return (
      <PageFrame>
        <section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center">
          <CircleAlert className="mx-auto size-6 text-[var(--warning)]" />
          <h2 className="mt-4 text-xl font-medium">Operations unavailable</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
            {result.message}
          </p>
        </section>
      </PageFrame>
    );
  if (!model) return null;

  const openTasks = model.tasks.filter(
    (task) => !terminalTaskStatuses.has(task.status),
  );
  const overdue = openTasks.filter(
    (task) => task.dueAt && task.dueAt < model.loadedAt,
  );
  const todayRuns = model.checklistRuns.filter(
    (run) => run.businessDate === model.date,
  );
  const incompleteTodayRuns = todayRuns.filter(
    (run) => !terminalTaskStatuses.has(run.status),
  );
  const acknowledgementDue = model.sops.filter(
    (sop) =>
      !sop.isDraft &&
      sop.requiresAcknowledgement &&
      !sop.acknowledgedByCurrentEmployee,
  );
  const openMaintenance = model.maintenance.filter(
    (request) => !terminalTaskStatuses.has(request.status),
  );

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="positive" dot>
              Connected
            </StatusPill>
            <StatusPill tone={canManage ? "positive" : "neutral"}>
              {canManage ? "Management controls" : "Staff controls"}
            </StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">
              Live · {workspace.activeLocation.name}
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">
            Tasks & SOPs
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Routines, handoffs, maintenance, and exception records in one
            location-scoped workspace.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="accent"
            disabled={busy}
            onClick={() => setDialog({ kind: "task-create" })}
          >
            <Plus className="size-4" />
            Create task
          </Button>
        ) : null}
      </div>
      {notice ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-xs leading-4",
            notice.tone === "success"
              ? "bg-[var(--positive-soft)] text-[var(--positive)]"
              : "bg-[var(--danger-soft)] text-[var(--danger)]",
          )}
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          {notice.text}
        </div>
      ) : null}
      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric
          label="Open tasks"
          value={String(openTasks.length)}
          detail={`${overdue.length} overdue by recorded due time`}
          trend={{
            label: overdue.length ? "Review" : "On time",
            tone: overdue.length ? "negative" : "positive",
          }}
        />
        <Metric
          label="Today’s checklists"
          value={`${todayRuns.length - incompleteTodayRuns.length}/${todayRuns.length}`}
          detail="Terminal runs / runs created"
        />
        <Metric
          label="SOP acknowledgements"
          value={String(acknowledgementDue.length)}
          detail={
            model.currentEmployeeId
              ? "Current versions due for you"
              : "No active employee profile linked"
          }
        />
        <Metric
          label="Open maintenance"
          value={String(openMaintenance.length)}
          detail={`${model.maintenance.length} visible location records`}
          trend={{
            label: openMaintenance.some(
              (request) => request.priority === "emergency",
            )
              ? "Emergency"
              : "Current",
            tone: openMaintenance.some(
              (request) => request.priority === "emergency",
            )
              ? "negative"
              : "neutral",
          }}
        />
      </section>
      <Tabs
        id="operations"
        label="Operations sections"
        className="mt-6"
        items={tabs.map((item) => ({
          value: item.id,
          label: item.label,
          badge:
            item.id === "tasks"
              ? openTasks.length || undefined
              : item.id === "maintenance"
                ? openMaintenance.length || undefined
                : item.id === "incidents"
                  ? model.incidents.length || undefined
                  : undefined,
        }))}
        value={tab}
        onValueChange={setTab}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.14 }}
        >
          <TabPanel id="operations" value={tab}>
            {tab === "tasks" ? (
              <TaskPanel
                model={model}
                workspace={workspace}
                canManage={canManage}
                busy={busy}
                onDialog={setDialog}
              />
            ) : null}
            {tab === "checklists" ? (
              <ChecklistPanel
                model={model}
                canManage={canManage}
                busy={busy}
                onDialog={setDialog}
                onRun={run}
              />
            ) : null}
            {tab === "sops" ? (
              <SopPanel
                model={model}
                canManage={canManage}
                busy={busy}
                onDialog={setDialog}
                onRun={run}
              />
            ) : null}
            {tab === "maintenance" ? (
              <MaintenancePanel
                model={model}
                canManage={canManage}
                busy={busy}
                onDialog={setDialog}
              />
            ) : null}
            {tab === "incidents" ? (
              <IncidentPanel
                model={model}
                canManage={canManage}
                busy={busy}
                onDialog={setDialog}
              />
            ) : null}
          </TabPanel>
        </motion.div>
      </AnimatePresence>
      <div className="mt-8 flex items-start gap-3 border-t border-[var(--line)] pt-5 text-xs leading-4 text-[var(--ink-faint)]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--positive)]" />
        <span>
          Every count and control is derived from live rows visible through the
          current organization, location, and role policies. Actor identity,
          completion times, and terminal evidence are written by server-owned
          commands.
        </span>
      </div>
      <AnimatePresence>
        {dialog ? (
          <OperationDialog
            dialog={dialog}
            model={model}
            workspace={workspace}
            canManage={canManage}
            busy={busy}
            onClose={() => setDialog(null)}
            onRun={run}
            onError={(message) => setNotice({ tone: "error", text: message })}
          />
        ) : null}
      </AnimatePresence>
    </PageFrame>
  );
}
