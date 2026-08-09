"use client";

import {
  BriefcaseBusiness,
  CalendarRange,
  MapPin,
  PencilLine,
  Plus,
  Power,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createEmployeeJobAssignmentAction,
  createJobRoleDefinitionAction,
  deactivateJobRoleDefinitionAction,
  endEmployeeJobAssignmentAction,
  updateEmployeeJobAssignmentAction,
  updateJobRoleDefinitionAction,
} from "@/app/actions/workflows/people-configuration";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveJobAssignment,
  LiveJobRoleDefinition,
  LiveTeamMember,
} from "@/data/read-models/team";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { cn } from "@/lib/utils";

type Notice = { tone: "success" | "error"; message: string };
type RoleEditor =
  | { kind: "create" }
  | { kind: "edit"; role: LiveJobRoleDefinition }
  | { kind: "deactivate"; role: LiveJobRoleDefinition };
type AssignmentEditor =
  | { kind: "create" }
  | { kind: "edit"; assignment: LiveJobAssignment }
  | { kind: "end"; assignment: LiveJobAssignment };

const fieldClass =
  "focus-ring h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xs placeholder:text-[var(--ink-faint)]";

function canConfigurePeople(workspace: WorkspaceContextValue) {
  return (
    workspace.role === "admin" ||
    (workspace.role === "owner" && workspace.identity.aal === "aal2")
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function parseRequiredNumber(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw ? Number(raw) : Number.NaN;
}

function parsePrivateRateCents(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  return raw ? Math.round(Number(raw) * 100) : null;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-xs leading-4 text-[var(--ink-faint)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function InlineNotice({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "mt-3 rounded-xl px-3 py-2.5 text-xs",
        notice.tone === "success"
          ? "bg-[var(--positive-soft)] text-[var(--positive)]"
          : "bg-[var(--danger-soft)] text-[var(--danger)]",
      )}
    >
      {notice.message}
    </p>
  );
}

function EditorActions({
  busy,
  submitLabel,
  onCancel,
  danger = false,
}: {
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-4">
      <Button type="button" variant="quiet" size="sm" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button
        type="submit"
        variant={danger ? "danger" : "accent"}
        size="sm"
        disabled={busy}
      >
        {busy ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}

export function JobRoleConfigurationPanel({
  workspace,
  roles,
}: {
  workspace: WorkspaceContextValue;
  roles: LiveJobRoleDefinition[];
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<RoleEditor | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startTransition] = useTransition();
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);

  if (!canConfigurePeople(workspace)) return null;

  function closeEditor() {
    requestRef.current = null;
    setEditor(null);
  }

  function openEditor(next: RoleEditor) {
    requestRef.current = null;
    setNotice(null);
    setEditor(next);
  }

  function requestIdFor(operation: string, payload: Record<string, unknown>) {
    const fingerprint = `${operation}:${JSON.stringify(payload)}`;
    if (requestRef.current?.fingerprint === fingerprint) return requestRef.current.id;
    const id = crypto.randomUUID();
    requestRef.current = { fingerprint, id };
    return id;
  }

  function runAction(
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setNotice({
            tone: "error",
            message: result.message ?? "The role definition could not be saved.",
          });
          return;
        }
        requestRef.current = null;
        setEditor(null);
        setNotice({ tone: "success", message: successMessage });
        router.refresh();
      } catch {
        setNotice({
          tone: "error",
          message:
            "We could not confirm whether the change completed. Retry the unchanged form to safely check the same request.",
        });
      }
    });
  }

  const editedRole = editor && editor.kind !== "create" ? editor.role : null;
  return (
    <section className="mt-6 rounded-[22px] border border-[var(--line)] bg-[var(--paper)] p-5 sm:p-6">
      <SectionHeading
        eyebrow="Team setup"
        title="Job role catalog"
        detail="Define the roles your restaurant actually uses—nothing is assumed or prefilled."
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => openEditor({ kind: "create" })}
          >
            <Plus className="size-3.5" /> Add role
          </Button>
        }
      />

      {roles.length ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <article
              key={role.id}
              className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {role.color ? (
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: role.color }}
                      />
                    ) : (
                      <BriefcaseBusiness className="size-3.5 shrink-0 text-[var(--ink-faint)]" />
                    )}
                    <h3 className="truncate text-xs font-semibold">{role.name}</h3>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {role.code}
                    {role.department ? ` · ${role.department}` : ""}
                  </p>
                </div>
                <StatusPill tone={role.active ? "positive" : "neutral"}>
                  {role.active ? "Active" : "Inactive"}
                </StatusPill>
              </div>
              <p className="mt-3 text-xs text-[var(--ink-soft)]">
                {role.isTipped ? `${role.defaultTipPoints} default tip points` : "Not tip eligible"}
              </p>
              {role.active ? (
                <div className="mt-3 flex gap-1 border-t border-[var(--line)] pt-3">
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() => openEditor({ kind: "edit", role })}
                  >
                    <PencilLine className="size-3.5" /> Edit
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() => openEditor({ kind: "deactivate", role })}
                  >
                    <Power className="size-3.5" /> Deactivate
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--canvas)] px-5 py-7 text-center">
          <BriefcaseBusiness className="mx-auto size-5 text-[var(--ink-faint)]" />
          <p className="mt-3 text-xs font-semibold">Start with your real job roles</p>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-4 text-[var(--ink-faint)]">
            Roles connect employees to schedules, clock activity, and future tip-pool rules.
            Add the first definition using your approved title, code, and tip eligibility.
          </p>
        </div>
      )}

      {editor ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] p-4 sm:p-5">
          {editor.kind === "deactivate" && editedRole ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const payload = { jobRoleId: editedRole.id };
                runAction("Job role deactivated.", () =>
                  deactivateJobRoleDefinitionAction({
                    requestId: requestIdFor("people.job_role.deactivate", payload),
                    ...payload,
                  }),
                );
              }}
            >
              <h3 className="text-sm font-semibold">Deactivate {editedRole.name}?</h3>
              <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                Active and future employee assignments must be ended first. Historical records
                remain intact.
              </p>
              <EditorActions
                busy={busy}
                submitLabel="Deactivate role"
                onCancel={closeEditor}
                danger
              />
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const payload = {
                  name: String(form.get("name")),
                  code: String(form.get("code")),
                  department: String(form.get("department") || "") || null,
                  color: String(form.get("color") || "") || null,
                  defaultTipPoints: parseRequiredNumber(form.get("defaultTipPoints")),
                  isTipped: form.get("isTipped") === "on",
                };
                if (editedRole) {
                  const command = { jobRoleId: editedRole.id, ...payload };
                  runAction("Job role updated.", () =>
                    updateJobRoleDefinitionAction({
                      requestId: requestIdFor("people.job_role.update", command),
                      ...command,
                    }),
                  );
                } else {
                  const command = {
                    organizationId: workspace.organization.id,
                    ...payload,
                  };
                  runAction("Job role created.", () =>
                    createJobRoleDefinitionAction({
                      requestId: requestIdFor("people.job_role.create", command),
                      ...command,
                    }),
                  );
                }
              }}
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold">
                  {editedRole ? `Edit ${editedRole.name}` : "Create a job role"}
                </h3>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Tip points are configuration evidence, not a finalized tip policy.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Role name">
                  <input
                    name="name"
                    required
                    maxLength={120}
                    defaultValue={editedRole?.name ?? ""}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Short code">
                  <input
                    name="code"
                    required
                    maxLength={32}
                    pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
                    defaultValue={editedRole?.code ?? ""}
                    placeholder="Approved code"
                    className={fieldClass}
                  />
                </Field>
                <Field label="Department">
                  <input
                    name="department"
                    maxLength={120}
                    defaultValue={editedRole?.department ?? ""}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Color" hint="Optional six-digit hex value, such as #1F2937.">
                  <input
                    name="color"
                    maxLength={7}
                    pattern="#[0-9A-Fa-f]{6}"
                    defaultValue={editedRole?.color ?? ""}
                    placeholder="#RRGGBB"
                    className={fieldClass}
                  />
                </Field>
                <Field label="Default tip points" hint="Enter the approved value; no default is assumed.">
                  <input
                    name="defaultTipPoints"
                    type="number"
                    required
                    min="0"
                    max="99999.999"
                    step="0.001"
                    defaultValue={editedRole?.defaultTipPoints ?? ""}
                    className={fieldClass}
                  />
                </Field>
                <label className="flex items-center gap-3 self-end rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2.5 text-xs">
                  <input
                    name="isTipped"
                    type="checkbox"
                    defaultChecked={editedRole?.isTipped ?? false}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span>
                    <span className="block font-semibold">Tip eligible</span>
                    <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                      Used only after an approved tip-pool rule references it.
                    </span>
                  </span>
                </label>
              </div>
              <EditorActions
                busy={busy}
                submitLabel={editedRole ? "Save role" : "Create role"}
                onCancel={closeEditor}
              />
            </form>
          )}
        </div>
      ) : null}
      <InlineNotice notice={notice} />
    </section>
  );
}

export function EmployeeJobAssignmentPanel({
  workspace,
  member,
  roles,
}: {
  workspace: WorkspaceContextValue;
  member: LiveTeamMember;
  roles: LiveJobRoleDefinition[];
}) {
  const router = useRouter();
  const [editor, setEditor] = useState<AssignmentEditor | null>(null);
  const [changePrivateRate, setChangePrivateRate] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, startTransition] = useTransition();
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);

  if (!canConfigurePeople(workspace)) return null;

  const activeRoles = roles.filter((role) => role.active);
  const locations = workspace.locations.filter((location) =>
    member.locationIds.includes(location.id),
  );
  const canCreate = Boolean(member.employeeId && activeRoles.length && locations.length);

  function closeEditor() {
    requestRef.current = null;
    setChangePrivateRate(false);
    setEditor(null);
  }

  function openEditor(next: AssignmentEditor) {
    requestRef.current = null;
    setChangePrivateRate(false);
    setNotice(null);
    setEditor(next);
  }

  function requestIdFor(operation: string, payload: Record<string, unknown>) {
    const fingerprint = `${operation}:${JSON.stringify(payload)}`;
    if (requestRef.current?.fingerprint === fingerprint) return requestRef.current.id;
    const id = crypto.randomUUID();
    requestRef.current = { fingerprint, id };
    return id;
  }

  function runAction(
    successMessage: string,
    action: () => Promise<{ ok: boolean; message?: string }>,
  ) {
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setNotice({
            tone: "error",
            message: result.message ?? "The job assignment could not be saved.",
          });
          return;
        }
        requestRef.current = null;
        setEditor(null);
        setNotice({ tone: "success", message: successMessage });
        router.refresh();
      } catch {
        setNotice({
          tone: "error",
          message:
            "We could not confirm whether the change completed. Retry the unchanged form to safely check the same request.",
        });
      }
    });
  }

  const editedAssignment =
    editor && editor.kind !== "create" ? editor.assignment : null;
  const currentRoleIsActive = editedAssignment
    ? activeRoles.some((role) => role.id === editedAssignment.jobRoleId)
    : false;

  return (
    <section className="lg:col-span-2">
      <SectionHeading
        eyebrow="Employment setup"
        title="Job assignments"
        detail="Role, location, and dates are visible here. Private hourly rates are never displayed after save."
        action={
          <Button
            type="button"
            variant="quiet"
            size="sm"
            disabled={busy || !canCreate}
            onClick={() => openEditor({ kind: "create" })}
          >
            <Plus className="size-3.5" /> Assign role
          </Button>
        }
      />

      {!member.employeeId ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--canvas)] p-4 text-xs leading-4 text-[var(--ink-faint)]">
          Provision this account’s employee operations record before assigning a job role.
        </div>
      ) : !activeRoles.length ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--canvas)] p-4 text-xs leading-4 text-[var(--ink-faint)]">
          Create an active job role in the Team setup catalog before assigning this employee.
        </div>
      ) : !locations.length ? (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--canvas)] p-4 text-xs leading-4 text-[var(--ink-faint)]">
          Give this account a verified location relationship before assigning a job role.
        </div>
      ) : member.jobAssignments.length ? (
        <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {member.jobAssignments.map((assignment) => {
            const roleActive = activeRoles.some((role) => role.id === assignment.jobRoleId);
            return (
              <article
                key={assignment.id}
                className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold">{assignment.roleName}</p>
                    {assignment.isPrimary ? <StatusPill tone="accent">Primary</StatusPill> : null}
                    {!roleActive ? <StatusPill tone="neutral">Historical role</StatusPill> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-faint)]">
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3" /> {assignment.locationName}
                    </span>
                    <span className="flex items-center gap-1">
                      <CalendarRange className="size-3" /> {formatDate(assignment.effectiveFrom)}
                      {assignment.effectiveTo ? `–${formatDate(assignment.effectiveTo)}` : "–No end date"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 sm:justify-end">
                  {roleActive ? (
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      disabled={busy}
                      onClick={() => openEditor({ kind: "edit", assignment })}
                    >
                      <PencilLine className="size-3.5" /> Edit
                    </Button>
                  ) : null}
                  {!assignment.effectiveTo ? (
                    <Button
                      type="button"
                      variant="quiet"
                      size="sm"
                      disabled={busy}
                      onClick={() => openEditor({ kind: "end", assignment })}
                    >
                      <Power className="size-3.5" /> End
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--canvas)] p-4 text-xs leading-4 text-[var(--ink-faint)]">
          No job assignments are on file. Choose an approved role, verified location, and
          effective date to add the first one.
        </div>
      )}

      {editor && member.employeeId ? (
        <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--canvas)] p-4 sm:p-5">
          {editor.kind === "end" && editedAssignment ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const payload = {
                  assignmentId: editedAssignment.id,
                  effectiveTo: String(form.get("effectiveTo")),
                };
                runAction("Job assignment ended.", () =>
                  endEmployeeJobAssignmentAction({
                    requestId: requestIdFor("people.job_assignment.end", payload),
                    ...payload,
                  }),
                );
              }}
            >
              <h3 className="text-sm font-semibold">End {editedAssignment.roleName}</h3>
              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                Record the approved last effective date. Historical evidence remains available.
              </p>
              <div className="mt-4 max-w-xs">
                <Field label="Last effective date">
                  <input
                    name="effectiveTo"
                    type="date"
                    required
                    min={editedAssignment.effectiveFrom}
                    className={fieldClass}
                  />
                </Field>
              </div>
              <EditorActions
                busy={busy}
                submitLabel="End assignment"
                onCancel={closeEditor}
                danger
              />
            </form>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const setHourlyRate = editedAssignment ? changePrivateRate : true;
                const payload = {
                  jobRoleId: String(form.get("jobRoleId")),
                  locationId: String(form.get("locationId")),
                  setHourlyRate,
                  hourlyRateCents: setHourlyRate
                    ? parsePrivateRateCents(form.get("hourlyRate"))
                    : null,
                  effectiveFrom: String(form.get("effectiveFrom")),
                  effectiveTo: String(form.get("effectiveTo") || "") || null,
                  isPrimary: form.get("isPrimary") === "on",
                };
                if (editedAssignment) {
                  const command = { assignmentId: editedAssignment.id, ...payload };
                  runAction("Job assignment updated.", () =>
                    updateEmployeeJobAssignmentAction({
                      requestId: requestIdFor("people.job_assignment.update", command),
                      ...command,
                    }),
                  );
                } else {
                  const { setHourlyRate: _setHourlyRate, ...createPayload } = payload;
                  void _setHourlyRate;
                  const command = { employeeId: member.employeeId!, ...createPayload };
                  runAction("Job assignment created.", () =>
                    createEmployeeJobAssignmentAction({
                      requestId: requestIdFor("people.job_assignment.create", command),
                      ...command,
                    }),
                  );
                }
              }}
            >
              <div className="mb-4">
                <h3 className="text-sm font-semibold">
                  {editedAssignment ? `Edit ${editedAssignment.roleName}` : "Assign a job role"}
                </h3>
                <p className="mt-1 flex items-center gap-1.5 text-xs leading-4 text-[var(--ink-faint)]">
                  <ShieldCheck className="size-3.5 shrink-0" /> Hourly rate evidence is private and
                  will not be shown back in this profile.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Job role">
                  <select
                    name="jobRoleId"
                    required
                    defaultValue={editedAssignment?.jobRoleId ?? activeRoles[0]?.id}
                    className={fieldClass}
                  >
                    {editedAssignment && !currentRoleIsActive ? (
                      <option value={editedAssignment.jobRoleId} disabled>
                        {editedAssignment.roleName} · inactive
                      </option>
                    ) : null}
                    {activeRoles.map((role) => (
                      <option key={role.id} value={role.id}>{role.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Verified location">
                  <select
                    name="locationId"
                    required
                    defaultValue={editedAssignment?.locationId ?? locations[0]?.id}
                    className={fieldClass}
                  >
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Effective from">
                  <input
                    name="effectiveFrom"
                    type="date"
                    required
                    defaultValue={editedAssignment?.effectiveFrom ?? ""}
                    className={fieldClass}
                  />
                </Field>
                <Field label="Effective through" hint="Optional. Leave blank for no approved end date.">
                  <input
                    name="effectiveTo"
                    type="date"
                    min={editedAssignment?.effectiveFrom}
                    defaultValue={editedAssignment?.effectiveTo ?? ""}
                    className={fieldClass}
                  />
                </Field>
                {editedAssignment ? (
                  <label className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2.5 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={changePrivateRate}
                      onChange={(event) => setChangePrivateRate(event.target.checked)}
                      className="size-4 accent-[var(--accent)]"
                    />
                    <span>
                      <span className="block font-semibold">Change private hourly rate</span>
                      <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                        Leave off to preserve the stored value without reading it.
                      </span>
                    </span>
                  </label>
                ) : null}
                {!editedAssignment || changePrivateRate ? (
                  <Field
                    label="Private hourly rate"
                    hint="Optional USD amount. Leave blank to store no rate. This value is not displayed after save."
                  >
                    <input
                      name="hourlyRate"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="21474836.47"
                      step="0.01"
                      autoComplete="off"
                      className={fieldClass}
                    />
                  </Field>
                ) : null}
                <label className="flex items-center gap-3 self-end rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2.5 text-xs">
                  <input
                    name="isPrimary"
                    type="checkbox"
                    defaultChecked={editedAssignment?.isPrimary ?? false}
                    className="size-4 accent-[var(--accent)]"
                  />
                  <span className="font-semibold">Primary role at this location</span>
                </label>
              </div>
              <EditorActions
                busy={busy}
                submitLabel={editedAssignment ? "Save assignment" : "Assign role"}
                onCancel={closeEditor}
              />
            </form>
          )}
        </div>
      ) : null}
      <InlineNotice notice={notice} />
    </section>
  );
}
