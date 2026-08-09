"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileClock,
  FileUp,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createManualCsvUploadUrlAction,
  finalizeManualCsvImportAction,
  retryIntegrationSyncAction,
} from "@/app/actions/workflows/integrations";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveIntegrationAuditEvent,
  LiveIntegrationConnection,
  LiveIntegrationEvent,
  LiveIntegrationImportJob,
  LiveIntegrationsModel,
  LiveIntegrationSyncJob,
} from "@/data/read-models/integrations";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  manualCsvImportDefinitions,
  manualCsvImportTypeValues,
  MANUAL_CSV_MAX_BYTES,
  type ManualCsvImportType,
  type ManualCsvValidationSuccess,
  validateManualCsvText,
} from "@/lib/integrations/csv-import";
import {
  integrationAdapters,
  retryDelayMinutes,
} from "@/lib/integrations/adapters";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { IntegrationProvider } from "@/types";

type ActivityTab = "syncs" | "imports" | "events" | "audit";

const catalogProviders: readonly IntegrationProvider[] = [
  "toast",
  "resy",
  "csv",
  "payroll",
  "accounting",
];

const providerMarks: Record<IntegrationProvider, string> = {
  toast: "T",
  resy: "R",
  csv: "CSV",
  payroll: "P",
  accounting: "A",
};

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timestamp(value: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Invalid timestamp";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function compactDate(value: string | null): string {
  if (!value) return "None";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function statusTone(status: string) {
  if (status === "connected" || status === "succeeded") return "positive" as const;
  if (
    status === "degraded" ||
    status === "partially_succeeded" ||
    status === "pending" ||
    status === "warning"
  ) {
    return "warning" as const;
  }
  if (status === "failed") return "danger" as const;
  if (status === "running") return "accent" as const;
  return "neutral" as const;
}

function latestSuccessfulTimestamp(model: LiveIntegrationsModel): string | null {
  const candidates = [
    ...model.connections.flatMap((connection) =>
      connection.lastSyncedAt ? [connection.lastSyncedAt] : [],
    ),
    ...model.syncJobs.flatMap((job) =>
      job.status === "succeeded" && job.completedAt ? [job.completedAt] : [],
    ),
    ...model.importJobs.flatMap((job) =>
      job.status === "succeeded" && job.completedAt ? [job.completedAt] : [],
    ),
  ];
  return candidates.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function EmptyLedger({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <FileClock className="mx-auto size-5 text-[var(--ink-faint)]" />
      <p className="mt-3 text-xs font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-4 text-[var(--ink-faint)]">
        {detail}
      </p>
    </div>
  );
}

function SyncLedger({
  jobs,
  canManage,
  ownerNeedsMfa,
  retryingId,
  onRetry,
}: {
  jobs: LiveIntegrationSyncJob[];
  canManage: boolean;
  ownerNeedsMfa: boolean;
  retryingId: string | null;
  onRetry: (job: LiveIntegrationSyncJob) => void;
}) {
  if (!jobs.length) {
    return (
      <EmptyLedger
        title="No sync jobs yet"
        detail="Live Toast and Resy jobs appear only after approved access is supplied. Manual imports have their own ledger."
      />
    );
  }
  return (
    <div className="divide-y divide-[var(--line)]">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.2fr)_.85fr_.7fr_auto] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-xs font-semibold">{job.connectionName}</p>
              <StatusPill tone={statusTone(job.status)} dot={job.status === "running"}>
                {humanize(job.status)}
              </StatusPill>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              {humanize(job.resourceType)} · {job.direction} · attempt {job.attempts} of {job.maxAttempts}
            </p>
            {job.errorMessage ? (
              <p className="mt-2 max-w-2xl text-xs leading-4 text-[var(--danger)]">
                {job.errorMessage}
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs text-[var(--ink-faint)]">Started</p>
            <p className="numeric mt-1 text-xs">{timestamp(job.startedAt ?? job.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--ink-faint)]">Evidence</p>
            <p className="numeric mt-1 text-xs">{job.recordsProcessed.toLocaleString()} processed</p>
            {Object.keys(job.recordOutcomes).length ? (
              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                {Object.entries(job.recordOutcomes)
                  .map(([outcome, count]) => `${count} ${outcome}`)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="sm:text-right">
            {job.canRetry && canManage ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={ownerNeedsMfa || retryingId === job.id}
                onClick={() => onRetry(job)}
              >
                {retryingId === job.id ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Retry
              </Button>
            ) : (
              <p className="text-xs text-[var(--ink-faint)]">
                {job.nextAttemptAt
                  ? `Next ${timestamp(job.nextAttemptAt)}`
                  : job.status === "failed"
                    ? "Retry unavailable"
                    : job.completedAt
                      ? "Complete"
                      : `${retryDelayMinutes(job.attempts)}m backoff`}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ImportLedger({ jobs }: { jobs: LiveIntegrationImportJob[] }) {
  if (!jobs.length) {
    return (
      <EmptyLedger
        title="No manual imports"
        detail="A validated CSV will appear here only after its private upload is bound to a server-stamped import job."
      />
    );
  }
  return (
    <div className="divide-y divide-[var(--line)]">
      {jobs.map((job) => (
        <div
          key={job.id}
          className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.2fr)_.8fr_.7fr_.7fr] sm:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-xs font-semibold">{job.fileName}</p>
              <StatusPill tone={statusTone(job.status)}>{humanize(job.status)}</StatusPill>
            </div>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">{humanize(job.importType)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--ink-faint)]">Requested</p>
            <p className="mt-1 text-xs">{job.requestedBy}</p>
            <p className="numeric mt-1 text-xs text-[var(--ink-faint)]">{timestamp(job.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--ink-faint)]">Rows</p>
            <p className="numeric mt-1 text-xs">
              {job.totalRows == null ? "Pending scan" : job.totalRows.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--ink-faint)]">Outcome</p>
            <p className="numeric mt-1 text-xs">
              {job.successfulRows.toLocaleString()} accepted · {job.failedRows.toLocaleString()} failed
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventLedger({ events }: { events: LiveIntegrationEvent[] }) {
  if (!events.length) {
    return (
      <EmptyLedger
        title="No adapter events"
        detail="Provider warnings and worker status messages will appear here without exposing credentials or raw payloads."
      />
    );
  }
  return (
    <div className="divide-y divide-[var(--line)]">
      {events.map((event) => (
        <div key={event.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[.8fr_minmax(0,1.6fr)_.7fr] sm:items-center">
          <div>
            <StatusPill tone={statusTone(event.severity === "error" ? "failed" : event.severity)}>
              {humanize(event.severity)}
            </StatusPill>
            <p className="mt-2 text-xs text-[var(--ink-faint)]">
              {event.connectionName ?? "Organization event"} · {humanize(event.eventType)}
            </p>
          </div>
          <p className="text-xs leading-4 text-[var(--ink-soft)]">{event.message}</p>
          <p className="numeric text-xs text-[var(--ink-faint)] sm:text-right">
            {timestamp(event.occurredAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

function AuditLedger({ events }: { events: LiveIntegrationAuditEvent[] }) {
  if (!events.length) {
    return (
      <EmptyLedger
        title="No immutable audit events"
        detail="Database mutation evidence will appear after an authorized import, sync, or connection change."
      />
    );
  }
  return (
    <div className="divide-y divide-[var(--line)]">
      {events.map((event) => (
        <div key={event.id} className="grid gap-2 px-4 py-4 sm:grid-cols-[.75fr_1fr_.75fr] sm:items-center">
          <div>
            <p className="text-xs font-semibold">{humanize(event.action)}</p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">{humanize(event.tableName)}</p>
          </div>
          <div>
            <p className="text-xs">{event.actorName}</p>
            <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
              {event.actorRole ? humanize(event.actorRole) : "Server"}
              {event.requestId ? ` · request ${event.requestId.slice(0, 8)}` : ""}
            </p>
          </div>
          <p className="numeric text-xs text-[var(--ink-faint)] sm:text-right">
            {timestamp(event.occurredAt)}
          </p>
        </div>
      ))}
    </div>
  );
}

function AdapterDrawer({
  provider,
  connections,
  canImport,
  onImport,
  onClose,
}: {
  provider: IntegrationProvider;
  connections: LiveIntegrationConnection[];
  canImport: boolean;
  onImport: () => void;
  onClose: () => void;
}) {
  const adapter = integrationAdapters[provider];
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-adapter-title"
        className="absolute inset-y-0 right-0 w-[min(94vw,540px)] overflow-y-auto bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 360, damping: 38 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Integration adapter</p>
            <h3 id="integration-adapter-title" className="mt-3 text-xl font-medium tracking-[-0.04em]">
              {adapter.label}
            </h3>
            <p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">{adapter.description}</p>
          </div>
          <Button variant="quiet" size="icon" onClick={onClose} aria-label="Close integration details">
            <X className="size-4" />
          </Button>
        </div>

        <section className="mt-7 border-y border-[var(--line)]">
          <div className="py-4">
            <p className="text-xs font-semibold">Access boundary</p>
            <p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">{adapter.accessNote}</p>
          </div>
        </section>

        <section className="mt-7">
          <SectionHeading title="Recorded connections" detail="Only current tenant and location scope is shown." />
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {connections.map((connection) => (
              <div key={connection.id} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{connection.displayName}</p>
                    <p className="mt-1 text-xs text-[var(--ink-faint)]">
                      {connection.scopeLabel} · adapter {connection.adapterVersion}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(connection.status)}>{humanize(connection.status)}</StatusPill>
                </div>
                <p className="mt-3 text-xs text-[var(--ink-faint)]">
                  {connection.lastSyncedAt ? `Last sync ${timestamp(connection.lastSyncedAt)}` : "No successful sync recorded"}
                </p>
              </div>
            ))}
            {!connections.length ? (
              <div className="py-8 text-center">
                <LockKeyhole className="mx-auto size-4 text-[var(--ink-faint)]" />
                <p className="mt-3 text-xs font-semibold">No connection record</p>
                <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                  No live or sandbox access is implied for this adapter.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-7">
          <SectionHeading title="Adapter capabilities" />
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {adapter.capabilities.map((capability) => (
              <div key={capability.id} className="flex items-center gap-3 py-3.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-[var(--canvas-strong)]">
                  <Check className="size-3 text-[var(--positive)]" />
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold">{capability.label}</span>
                <StatusPill tone={capability.requiresApproval ? "warning" : "neutral"}>
                  {capability.requiresApproval ? "Approval required" : capability.direction}
                </StatusPill>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-7 flex gap-3 border-y border-[var(--line)] py-4">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" />
          <div>
            <p className="text-xs font-semibold">Credential material is intentionally absent</p>
            <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
              This panel never reads ciphertext, raw connection configuration, tokens, or passwords.
            </p>
          </div>
        </div>

        {adapter.supportsManualImport && canImport ? (
          <div className="mt-6 flex justify-end">
            <Button variant="accent" onClick={onImport}>
              <FileUp className="size-4" /> Open manual import
            </Button>
          </div>
        ) : null}
      </motion.aside>
    </motion.div>
  );
}

function ImportDialog({
  locationName,
  busy,
  importType,
  file,
  validation,
  error,
  inputRef,
  onImportType,
  onFile,
  onSubmit,
  onClose,
}: {
  locationName: string;
  busy: boolean;
  importType: ManualCsvImportType;
  file: File | null;
  validation: ManualCsvValidationSuccess | null;
  error: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onImportType: (value: ManualCsvImportType) => void;
  onFile: (file: File | null) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const definition = manualCsvImportDefinitions[importType];
  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4 backdrop-blur-[3px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-import-title"
        className="max-h-[92svh] w-full max-w-2xl overflow-y-auto rounded-[24px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7"
        initial={{ y: 14, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 10, scale: 0.985 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Private manual import</p>
            <h3 id="manual-import-title" className="mt-2 text-xl font-medium tracking-[-0.04em]">
              Validate and queue CSV
            </h3>
            <p className="mt-2 text-xs text-[var(--ink-faint)]">Location · {locationName}</p>
          </div>
          <Button variant="quiet" size="icon" disabled={busy} onClick={onClose} aria-label="Close import dialog">
            <X className="size-4" />
          </Button>
        </div>

        <label className="mt-6 block">
          <span className="mb-1.5 block text-xs font-semibold">Import contract</span>
          <select
            value={importType}
            disabled={busy}
            onChange={(event) => onImportType(event.target.value as ManualCsvImportType)}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none focus:border-[var(--accent)]"
          >
            {manualCsvImportTypeValues.map((value) => (
              <option key={value} value={value}>
                {manualCsvImportDefinitions[value].sourceLabel}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">{definition.description}</p>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="focus-ring mt-5 flex w-full items-center gap-4 rounded-[18px] border border-dashed border-[var(--line-strong)] bg-[var(--canvas)] px-4 py-5 text-left transition-colors hover:bg-[var(--canvas-strong)] disabled:opacity-50"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-[var(--paper-strong)]">
            <UploadCloud className="size-4 text-[var(--accent-strong)]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{file?.name ?? "Choose a UTF-8 CSV"}</span>
            <span className="mt-1 block text-xs text-[var(--ink-faint)]">
              Maximum {MANUAL_CSV_MAX_BYTES / 1_048_576} MB · formulas and unsafe control bytes rejected
            </span>
          </span>
          <ChevronRight className="size-4 text-[var(--ink-faint)]" />
        </button>

        <div className="mt-4 border-y border-[var(--line)] py-4">
          <p className="text-xs font-semibold">Required headers</p>
          <p className="mt-2 font-mono text-xs leading-4 text-[var(--ink-faint)]">
            {definition.requiredHeaders.join(", ")}
            {definition.oneOfHeaders ? ` · plus ${definition.oneOfHeaders.join(" or ")}` : ""}
          </p>
        </div>

        {validation ? (
          <div className="mt-4 flex items-start gap-3 rounded-[16px] bg-[var(--positive-soft)] px-4 py-3 text-[var(--positive)]">
            <FileCheck2 className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="text-xs font-semibold">
                {validation.totalRows.toLocaleString()} row{validation.totalRows === 1 ? "" : "s"} passed local validation
              </p>
              <p className="mt-1 text-xs leading-4 opacity-80">
                The server downloads and validates the exact uploaded bytes again before creating a job.
              </p>
            </div>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 flex items-start gap-3 rounded-[16px] bg-[var(--danger-soft)] px-4 py-3 text-xs leading-4 text-[var(--danger)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-5">
          <p className="max-w-sm text-xs leading-4 text-[var(--ink-faint)]">
            Queued rows remain pending until the authorized import processor validates mappings and applies them.
          </p>
          <Button variant="accent" disabled={busy || !file || !validation} onClick={onSubmit}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {busy ? "Securing…" : "Queue import"}
          </Button>
        </div>
      </motion.section>
    </motion.div>
  );
}

export function LiveIntegrationsWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveIntegrationsModel>;
}) {
  const router = useRouter();
  const model = result.ok ? result.data : null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedProvider, setSelectedProvider] = useState<IntegrationProvider | null>(null);
  const [activityTab, setActivityTab] = useState<ActivityTab>("syncs");
  const [importOpen, setImportOpen] = useState(false);
  const [importType, setImportType] = useState<ManualCsvImportType>("toast_sales");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importValidation, setImportValidation] = useState<ManualCsvValidationSuccess | null>(null);
  const [importError, setImportError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [uploadedImport, setUploadedImport] = useState<{
    requestId: string;
    uploadId: string;
    objectPath: string;
  } | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();

  const overlayOpen = Boolean(selectedProvider || importOpen);
  useEffect(() => {
    if (!overlayOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busy) return;
      if (importOpen) setImportOpen(false);
      else setSelectedProvider(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, importOpen, overlayOpen]);

  useEffect(() => {
    if (!model) return;
    const supabase = createClient();
    const refresh = () => router.refresh();
    const channel = supabase
      .channel(`integrations-${workspace.organization.id}-${workspace.activeLocation.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "integration_connections", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "integration_sync_jobs", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "import_jobs", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "integration_events", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [model, router, workspace.activeLocation.id, workspace.organization.id]);

  const connectionGroups = useMemo(() => {
    const groups = new Map<string, LiveIntegrationConnection[]>();
    for (const connection of model?.connections ?? []) {
      groups.set(connection.provider, [...(groups.get(connection.provider) ?? []), connection]);
    }
    return groups;
  }, [model?.connections]);

  if (!result.ok || !model) {
    return (
      <PageFrame>
        <section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center">
          <CircleAlert className="mx-auto size-6 text-[var(--warning)]" />
          <h2 className="mt-4 text-xl font-medium">Integration records unavailable</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
            {result.ok ? "Integration data could not be loaded safely." : result.message}
          </p>
        </section>
      </PageFrame>
    );
  }

  const canMutate = model.canManageSettings && !model.ownerNeedsMfa;
  const activeConnections = model.connections.filter((connection) =>
    ["connected", "degraded"].includes(connection.status),
  ).length;
  const failedJobs = model.syncJobs.filter((job) => job.status === "failed").length;
  const degradedConnections = model.connections.filter((connection) => connection.status === "degraded").length;
  const syncRecordsProcessed = model.syncJobs.reduce(
    (total, job) => total + job.recordsProcessed,
    0,
  );
  const importRowsAccepted = model.importJobs.reduce(
    (total, job) => total + job.successfulRows,
    0,
  );
  const lastSuccess = latestSuccessfulTimestamp(model);

  async function validateSelectedFile(file: File, type: ManualCsvImportType) {
    setImportValidation(null);
    setImportError("");
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Choose a file with a .csv extension.");
      return;
    }
    if (!file.size || file.size > MANUAL_CSV_MAX_BYTES) {
      setImportError(`Choose a non-empty CSV no larger than ${MANUAL_CSV_MAX_BYTES / 1_048_576} MB.`);
      return;
    }
    try {
      const validation = validateManualCsvText({ text: await file.text(), importType: type });
      if (!validation.ok) {
        setImportError(
          `${validation.message}${validation.row ? ` Row ${validation.row}${validation.column ? `, column ${validation.column}` : ""}.` : ""}`,
        );
        return;
      }
      setImportValidation(validation);
    } catch {
      setImportError("The selected file could not be read as UTF-8 CSV text.");
    }
  }

  async function chooseFile(file: File | null) {
    setImportFile(file);
    setImportValidation(null);
    setImportError("");
    if (file) await validateSelectedFile(file, importType);
  }

  function changeImportType(value: ManualCsvImportType) {
    setImportType(value);
    setImportValidation(null);
    setImportError("");
    if (importFile) void validateSelectedFile(importFile, value);
  }

  function openImport(provider?: IntegrationProvider) {
    if (provider === "resy") setImportType("resy_reservations");
    else if (provider === "toast") setImportType("toast_sales");
    setSelectedProvider(null);
    setImportFile(null);
    setImportValidation(null);
    setImportError("");
    setImportOpen(true);
  }

  async function queueImport() {
    if (!model || !importFile || !importValidation || !canMutate) return;
    setBusy(true);
    setImportError("");
    const requestScope = `integrations.import.request:${model.locationId}`;
    const uploadScope = `integrations.import.upload:${model.locationId}`;
    const payload = {
      locationId: model.locationId,
      importType,
      fileName: importFile.name,
      mimeType: "text/csv" as const,
      sizeBytes: importFile.size,
    };
    const requestId = requestIdFor(requestScope, payload);
    const uploadId = requestIdFor(uploadScope, payload);
    try {
      let objectPath =
        uploadedImport?.requestId === requestId && uploadedImport.uploadId === uploadId
          ? uploadedImport.objectPath
          : null;
      if (!objectPath) {
        const prepared = await createManualCsvUploadUrlAction({
          requestId,
          uploadId,
          ...payload,
        });
        if (!prepared.ok || !("data" in prepared)) {
          setImportError(prepared.ok ? "The secure upload could not start." : prepared.message);
          setBusy(false);
          return;
        }
        const supabase = createClient();
        const uploaded = await supabase.storage
          .from("imports")
          .uploadToSignedUrl(prepared.data.objectPath, prepared.data.token, importFile, {
            contentType: "text/csv",
          });
        if (uploaded.error) {
          setImportError("The private CSV transfer did not finish. Choose the file and retry.");
          setBusy(false);
          return;
        }
        objectPath = prepared.data.objectPath;
        setUploadedImport({ requestId, uploadId, objectPath });
      }
      const finalized = await finalizeManualCsvImportAction({
        requestId,
        uploadId,
        objectPath,
        ...payload,
      });
      if (!finalized.ok) {
        setImportError(finalized.message);
        setBusy(false);
        return;
      }
      setBusy(false);
      setUploadedImport(null);
      rotateRequestId(requestScope);
      rotateRequestId(uploadScope);
      setImportOpen(false);
      setMessage(
        `${importValidation.totalRows.toLocaleString()} validated row${importValidation.totalRows === 1 ? "" : "s"} queued for server-side import review.`,
      );
      setActivityTab("imports");
      router.refresh();
    } catch {
      setBusy(false);
      setImportError("The import could not be queued. Check the connection and retry safely.");
    }
  }

  async function retry(job: LiveIntegrationSyncJob) {
    if (!canMutate) return;
    setRetryingId(job.id);
    setMessage("");
    const scope = `integrations.sync.retry:${job.id}`;
    const payload = { syncJobId: job.id };
    try {
      const result = await retryIntegrationSyncAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      });
      setRetryingId(null);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId(scope);
      setMessage("A new auditable retry job was queued from the failed sync.");
      router.refresh();
    } catch {
      setRetryingId(null);
      setMessage("The retry could not be queued. No existing sync evidence was changed.");
    }
  }

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="positive" dot>Tenant scoped</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">{model.locationName}</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Integrations</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Connection state, manual imports, retries, and audit evidence—without exposing credentials.
          </p>
        </div>
        {model.canManageSettings ? (
          <Button variant="accent" disabled={model.ownerNeedsMfa} onClick={() => openImport()}>
            <FileUp className="size-4" /> Import CSV
          </Button>
        ) : (
          <StatusPill tone="neutral">View only</StatusPill>
        )}
      </div>

      {message ? (
        <div role="status" className="mt-5 flex items-start gap-3 rounded-[16px] bg-[var(--accent-soft)]/45 px-4 py-3 text-xs leading-4 text-[var(--accent-strong)]">
          <Clock3 className="mt-0.5 size-4 shrink-0" /> {message}
        </div>
      ) : null}

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Active connections" value={String(activeConnections)} detail={`${model.connections.length} recorded in scope`} />
        <Metric label="Last success" value={compactDate(lastSuccess)} detail={lastSuccess ? timestamp(lastSuccess) : "No success recorded"} />
        <Metric
          label="Recorded jobs"
          value={String(model.syncJobs.length + model.importJobs.length)}
          detail={`${syncRecordsProcessed.toLocaleString()} sync records · ${importRowsAccepted.toLocaleString()} import rows`}
        />
        <Metric
          label="Open issues"
          value={String(failedJobs + degradedConnections)}
          detail={`${failedJobs} failed job${failedJobs === 1 ? "" : "s"} · ${degradedConnections} degraded`}
          trend={{
            label: failedJobs + degradedConnections ? "Review" : "Clear",
            tone: failedJobs + degradedConnections ? "negative" : "positive",
          }}
        />
      </section>

      <section className="mt-8">
        <SectionHeading
          title="Adapter status"
          detail={`Showing organization-wide and ${model.locationName} connection records only.`}
        />
        <div className="grid gap-x-8 md:grid-cols-2">
          {catalogProviders.map((provider) => {
            const adapter = integrationAdapters[provider];
            const connections = connectionGroups.get(provider) ?? [];
            const primary = connections.find((connection) => connection.locationId === model.locationId) ?? connections[0];
            const manualAvailable = provider === "csv" && !primary;
            return (
              <button
                key={provider}
                onClick={() => setSelectedProvider(provider)}
                className="focus-ring group flex items-start gap-4 border-b border-[var(--line)] py-5 text-left"
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-[13px] text-[13px] font-bold",
                    primary?.status === "connected"
                      ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                      : manualAvailable
                        ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "bg-[var(--canvas-strong)] text-[var(--ink-soft)]",
                  )}
                >
                  {providerMarks[provider]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{adapter.label}</span>
                    <StatusPill tone={primary ? statusTone(primary.status) : manualAvailable ? "accent" : "neutral"}>
                      {primary ? humanize(primary.status) : manualAvailable ? "Manual available" : "Not configured"}
                    </StatusPill>
                    {connections.length > 1 ? <span className="text-xs text-[var(--ink-faint)]">+{connections.length - 1} scope</span> : null}
                  </span>
                  <span className="mt-1.5 block text-xs leading-4 text-[var(--ink-faint)]">{adapter.description}</span>
                  <span className="mt-2 block text-xs text-[var(--ink-faint)]">
                    {primary?.lastSyncedAt
                      ? `Last sync ${timestamp(primary.lastSyncedAt)}`
                      : manualAvailable
                        ? "Private CSV validation is available without provider credentials."
                        : adapter.accessNote}
                  </span>
                </span>
                <ChevronRight className="mt-3 size-4 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-9">
        <SectionHeading
          title="Activity ledger"
          detail="Status is read from persisted jobs; terminal evidence is never simulated in the browser."
        />
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] pb-2">
          {([
            ["syncs", "Sync jobs", model.syncJobs.length],
            ["imports", "Imports", model.importJobs.length],
            ["events", "Adapter events", model.events.length],
            ["audit", "Audit", model.auditEvents.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              onClick={() => setActivityTab(value)}
              className={cn(
                "focus-ring rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap",
                activityTab === value
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]",
              )}
            >
              {label} · {count}
            </button>
          ))}
        </div>
        <div className="overflow-hidden border-b border-[var(--line)]">
          {activityTab === "syncs" ? (
            <SyncLedger
              jobs={model.syncJobs}
              canManage={model.canManageSettings}
              ownerNeedsMfa={model.ownerNeedsMfa}
              retryingId={retryingId}
              onRetry={(job) => void retry(job)}
            />
          ) : activityTab === "imports" ? (
            <ImportLedger jobs={model.importJobs} />
          ) : activityTab === "events" ? (
            <EventLedger events={model.events} />
          ) : (
            <AuditLedger events={model.auditEvents} />
          )}
        </div>
        {model.syncRecordEvidenceLimited ? (
          <p className="mt-3 text-xs text-[var(--warning)]">
            Per-record outcome evidence is capped at 10,000 rows in this view; job totals remain authoritative.
          </p>
        ) : null}
      </section>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-[16px] bg-[var(--positive-soft)] px-4 py-3 text-xs leading-4 text-[var(--positive)]">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          Credential ciphertext remains in a private schema that browser roles cannot read. This screen does not request it.
        </div>
        <div className="flex items-start gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-4 text-[var(--warning)]">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          Toast and Resy API status is “not configured” until approved credentials and restaurant authorization are supplied.
        </div>
      </div>

      <AnimatePresence>
        {selectedProvider ? (
          <AdapterDrawer
            provider={selectedProvider}
            connections={connectionGroups.get(selectedProvider) ?? []}
            canImport={canMutate}
            onImport={() => openImport(selectedProvider)}
            onClose={() => setSelectedProvider(null)}
          />
        ) : null}
        {importOpen ? (
          <ImportDialog
            locationName={model.locationName}
            busy={busy}
            importType={importType}
            file={importFile}
            validation={importValidation}
            error={importError}
            inputRef={fileInputRef}
            onImportType={changeImportType}
            onFile={(file) => void chooseFile(file)}
            onSubmit={() => void queueImport()}
            onClose={() => setImportOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </PageFrame>
  );
}
