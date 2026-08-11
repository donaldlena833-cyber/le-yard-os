"use client";

import {
  Archive,
  Check,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { configureRetentionPolicyAction } from "@/app/actions/workflows/financial-configuration";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveSettingsModel } from "@/data/read-models/settings";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

type RetentionPolicy = LiveSettingsModel["retentionPolicies"][number];
type DialogState = { policy: RetentionPolicy | null; policyId: string };

const dataClasses = [
  ["receipts_invoices", "Receipts & invoices"],
  ["employee_documents", "Employee documents"],
  ["guest_records", "Guest records"],
  ["time_payroll_evidence", "Time & payroll evidence"],
  ["chat_messages", "Chat messages"],
  ["operations_incidents", "Operations & incidents"],
  ["audit_events", "Audit events"],
  ["backups", "Backups"],
] as const;

const inputClass =
  "focus-ring h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs";

function labelForDataClass(value: string) {
  return (
    dataClasses.find(([dataClass]) => dataClass === value)?.[1] ??
    value.replaceAll("_", " ")
  );
}

export function RetentionPolicyConfiguration({
  workspace,
  policies,
  canManage,
}: {
  workspace: WorkspaceContextValue;
  policies: LiveSettingsModel["retentionPolicies"];
  canManage: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestAttemptRef = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [mode, setMode] = useState<"" | "window" | "indefinite">("");
  const [busy, setBusy] = useState(false);
  const [dialogNotice, setDialogNotice] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const mayWrite = canManage;

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) {
      element.showModal();
      requestAnimationFrame(() => {
        element.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
      });
    }
  }, [dialog]);

  function openDialog(next: DialogState, opener: HTMLElement) {
    openerRef.current = opener;
    requestAttemptRef.current = null;
    setDialogNotice("");
    setMode(
      next.policy
        ? next.policy.retentionDays === null
          ? "indefinite"
          : "window"
        : "",
    );
    setDialog(next);
  }

  function closeDialog() {
    const element = dialogRef.current;
    if (element?.open) element.close();
    setDialog(null);
    setDialogNotice("");
    requestAttemptRef.current = null;
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  function requestIdFor(payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    if (requestAttemptRef.current?.fingerprint === fingerprint) {
      return requestAttemptRef.current.requestId;
    }
    const requestId = crypto.randomUUID();
    requestAttemptRef.current = { fingerprint, requestId };
    return requestId;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    if (!mode) {
      setDialogNotice("Choose a timed window or no automatic deletion window.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const retentionDays =
      mode === "window" ? Number(form.get("retentionDays") ?? 0) : null;
    const payload = {
      policyId: dialog.policyId,
      organizationId: workspace.organization.id,
      dataClass:
        dialog.policy?.dataClass ?? String(form.get("dataClass") ?? ""),
      retentionDays,
      legalHold: form.get("legalHold") === "on",
      notes: String(form.get("notes") ?? "") || null,
    };
    const requestId = requestIdFor(payload);
    setBusy(true);
    setDialogNotice("");
    const response = await configureRetentionPolicyAction({
      requestId,
      ...payload,
    });
    setBusy(false);
    if (!response.ok) {
      setDialogNotice(response.message);
      return;
    }
    requestAttemptRef.current = null;
    setPageNotice("Retention decision recorded with an audit trail.");
    closeDialog();
    router.refresh();
  }

  return (
    <section>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <SectionHeading
          title="Retention decisions"
          detail="Recorded owner policy only; no deletion schedule is inferred or executed by this release."
        />
        {mayWrite ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(event) =>
              openDialog(
                { policy: null, policyId: crypto.randomUUID() },
                event.currentTarget,
              )
            }
          >
            <Plus className="size-3.5" />Record decision
          </Button>
        ) : null}
      </div>

      {pageNotice ? (
        <p role="status" className="mt-4 rounded-xl bg-[var(--canvas)] px-4 py-3 text-xs">
          {pageNotice}
        </p>
      ) : null}

      <div className="mt-4 border-y border-[var(--line)]">
        {policies.map((policy) => (
          <div
            key={policy.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-[var(--line)] py-3.5 first:border-0"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)]">
              <Archive className="size-4 text-[var(--ink-faint)]" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold capitalize">
                {labelForDataClass(policy.dataClass)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                {policy.configuredAt
                  ? `Recorded ${new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(new Date(policy.configuredAt))}`
                  : "Not activated"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone={policy.legalHold ? "warning" : "neutral"}>
                {policy.legalHold
                  ? "Legal hold"
                  : policy.retentionDays
                    ? `${policy.retentionDays} days`
                    : "No auto-delete"}
              </StatusPill>
              {mayWrite ? (
                <button
                  type="button"
                  aria-label={`Edit ${labelForDataClass(policy.dataClass)} retention decision`}
                  onClick={(event) =>
                    openDialog(
                      { policy, policyId: policy.id },
                      event.currentTarget,
                    )
                  }
                  className="focus-ring flex size-8 items-center justify-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]"
                >
                  <FilePenLine className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {!policies.length ? (
          <div className="py-10 text-center">
            <CircleAlert className="mx-auto size-5 text-[var(--warning)]" />
            <p className="mt-3 text-xs font-semibold">Owner decision required</p>
            <p className="mx-auto mt-2 max-w-md text-xs leading-4 text-[var(--ink-faint)]">
              Retention windows, legal holds, and deletion procedures remain unset until the restaurant records them.
            </p>
          </div>
        ) : null}
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="m-auto max-h-[calc(100svh-2rem)] w-[min(620px,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] shadow-2xl backdrop:bg-black/35"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) closeDialog();
        }}
        onClose={() => {
          if (dialog) setDialog(null);
          requestAnimationFrame(() => openerRef.current?.focus());
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !busy) closeDialog();
        }}
      >
        {dialog ? (
          <div className="flex max-h-[calc(100svh-2rem)] flex-col">
            <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-5 sm:px-7">
              <div>
                <p className="eyebrow">Data governance</p>
                <h2 id={titleId} className="mt-2 text-xl font-medium tracking-[-0.035em]">
                  {dialog.policy ? "Edit retention decision" : "Record retention decision"}
                </h2>
                <p id={descriptionId} className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                  This records policy evidence only. Automated deletion is not enabled by this form.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close retention dialog"
                disabled={busy}
                onClick={closeDialog}
                className="focus-ring flex size-9 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--canvas-strong)]"
              >
                <X className="size-4" />
              </button>
            </header>
            <form
              key={dialog.policyId}
              className="overflow-y-auto px-5 py-6 sm:px-7"
              onSubmit={(event) => void submit(event)}
            >
              <label>
                <span className="mb-1.5 block text-xs font-semibold">Data class</span>
                <select
                  data-initial-focus
                  required
                  name="dataClass"
                  disabled={Boolean(dialog.policy)}
                  defaultValue={dialog.policy?.dataClass ?? ""}
                  className={inputClass}
                >
                  <option value="">Choose a data class</option>
                  {dataClasses.map(([value, label]) => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        !dialog.policy &&
                        policies.some((policy) => policy.dataClass === value)
                      }
                    >
                      {label}
                    </option>
                  ))}
                  {dialog.policy &&
                  !dataClasses.some(([value]) => value === dialog.policy?.dataClass) ? (
                    <option value={dialog.policy.dataClass}>
                      {labelForDataClass(dialog.policy.dataClass)}
                    </option>
                  ) : null}
                </select>
              </label>

              <fieldset className="mt-5">
                <legend className="text-xs font-semibold">Retention mode</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
                    <input
                      type="radio"
                      name="mode"
                      value="window"
                      checked={mode === "window"}
                      onChange={() => setMode("window")}
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                    />
                    <span><span className="block font-semibold">Timed window</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">Record a number of days.</span></span>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
                    <input
                      type="radio"
                      name="mode"
                      value="indefinite"
                      checked={mode === "indefinite"}
                      onChange={() => setMode("indefinite")}
                      className="mt-0.5 size-4 accent-[var(--accent)]"
                    />
                    <span><span className="block font-semibold">No automatic deletion</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">No day-based window is recorded.</span></span>
                  </label>
                </div>
              </fieldset>

              {mode === "window" ? (
                <label className="mt-5 block">
                  <span className="mb-1.5 block text-xs font-semibold">Retention days</span>
                  <input
                    required
                    name="retentionDays"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="36500"
                    step="1"
                    defaultValue={dialog.policy?.retentionDays ?? ""}
                    className={inputClass}
                  />
                </label>
              ) : null}

              <label className="mt-5 flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 text-xs">
                <input
                  name="legalHold"
                  type="checkbox"
                  defaultChecked={dialog.policy?.legalHold ?? false}
                  className="mt-0.5 size-4 accent-[var(--accent)]"
                />
                <span><span className="block font-semibold">Legal hold</span><span className="mt-1 block text-xs leading-4 text-[var(--ink-faint)]">Record that deletion must remain paused. Confirm legal requirements with qualified counsel.</span></span>
              </label>

              <label className="mt-5 block">
                <span className="mb-1.5 block text-xs font-semibold">Decision notes <span className="font-normal text-[var(--ink-faint)]">optional</span></span>
                <textarea
                  name="notes"
                  rows={4}
                  maxLength={2_000}
                  defaultValue={dialog.policy?.notes ?? ""}
                  className="focus-ring w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs"
                />
              </label>

              {dialogNotice ? (
                <p role="alert" className="mt-5 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-xs text-[var(--danger)]">
                  {dialogNotice}
                </p>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="quiet" disabled={busy} onClick={closeDialog}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={busy || !mode}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Save decision
                </Button>
              </div>
            </form>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
