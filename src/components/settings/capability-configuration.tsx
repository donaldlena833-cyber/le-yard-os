"use client";

import { Check, KeyRound, LoaderCircle, MapPin, ShieldCheck } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { configureJobRoleCapabilityAction } from "@/app/actions/workflows/configuration";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveSettingsModel } from "@/data/read-models/settings";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { cn } from "@/lib/utils";

function dateInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function CapabilityConfiguration({
  data,
  workspace,
}: {
  data: LiveSettingsModel;
  workspace: WorkspaceContextValue;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedRoleId, setSelectedRoleId] = useState(data.jobRoles.find((role) => role.active)?.id ?? "");
  const [scope, setScope] = useState<"location" | "organization">("location");
  const [message, setMessage] = useState<string | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const selectedRole = data.jobRoles.find((role) => role.id === selectedRoleId) ?? null;
  const locationId = scope === "location" ? workspace.activeLocation.id : null;

  const assignments = useMemo(
    () => new Map(
      data.jobRoleCapabilities
        .filter((assignment) => assignment.jobRoleId === selectedRoleId && assignment.locationId === locationId)
        .map((assignment) => [assignment.capabilityKey, assignment]),
    ),
    [data.jobRoleCapabilities, locationId, selectedRoleId],
  );
  const domains = useMemo(() => {
    const grouped = new Map<string, LiveSettingsModel["capabilityDefinitions"]>();
    for (const definition of data.capabilityDefinitions) {
      grouped.set(definition.domain, [...(grouped.get(definition.domain) ?? []), definition]);
    }
    return [...grouped.entries()];
  }, [data.capabilityDefinitions]);

  function toggle(capabilityKey: LiveSettingsModel["capabilityDefinitions"][number]["key"]) {
    if (!selectedRole) return;
    const assignment = assignments.get(capabilityKey);
    const nextActive = !assignment?.active;
    const requestScope = `job-role-capability:${selectedRole.id}:${locationId ?? "organization"}:${capabilityKey}`;
    const payload = {
      organizationId: workspace.organization.id,
      assignmentId: assignment?.id ?? null,
      jobRoleId: selectedRole.id,
      capabilityKey,
      locationId,
      effectiveFrom: assignment?.effectiveFrom ?? dateInTimeZone(data.organization.timeZone),
      effectiveTo: assignment?.effectiveTo ?? null,
      active: nextActive,
    };
    setMessage(null);
    startTransition(async () => {
      const result = await configureJobRoleCapabilityAction({
        requestId: requestIdFor(requestScope, payload),
        ...payload,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      rotateRequestId(requestScope);
      setMessage(`${capabilityKey} ${nextActive ? "assigned" : "deactivated"} for ${selectedRole.name}.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          title="Job-role capabilities"
          detail="Operational permissions are effective-dated and scoped independently from organization administration."
        />
        <div className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--paper)] p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label>
            <span className="mb-1.5 block text-xs font-semibold tracking-[.08em] text-[var(--ink-faint)] uppercase">Job role</span>
            <select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-[13px]">
              {data.jobRoles.map((role) => <option key={role.id} value={role.id}>{role.name}{role.active ? "" : " · inactive"}</option>)}
            </select>
          </label>
          <div className="flex rounded-xl border border-[var(--line)] bg-[var(--canvas)] p-1" role="group" aria-label="Capability scope">
            <button type="button" onClick={() => setScope("location")} className={cn("focus-ring flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", scope === "location" ? "bg-[var(--paper-strong)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-faint)]")}><MapPin className="size-3" />This location</button>
            <button type="button" onClick={() => setScope("organization")} className={cn("focus-ring flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold", scope === "organization" ? "bg-[var(--paper-strong)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-faint)]")}><ShieldCheck className="size-3" />All locations</button>
          </div>
        </div>
        <p className="mt-3 text-xs leading-4 text-[var(--ink-faint)]">
          {scope === "location" ? `Assignments below apply only at ${workspace.activeLocation.name}.` : "Assignments below apply at every active location this employee can access."}
        </p>
      </section>

      {selectedRole ? domains.map(([domain, definitions]) => (
        <section key={domain}>
          <div className="mb-3 flex items-center gap-2"><KeyRound className="size-3.5 text-[var(--accent-strong)]" /><h3 className="text-xs font-semibold tracking-[.12em] uppercase">{domain}</h3></div>
          <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {definitions.map((definition) => {
              const assignment = assignments.get(definition.key);
              const active = assignment?.active === true;
              return (
                <div key={definition.key} className="flex items-center gap-3 py-3.5">
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{definition.label}</span><span className="mt-1 block text-xs leading-4 text-[var(--ink-faint)]">{definition.description}</span><code className="mt-1.5 block text-xs text-[var(--ink-faint)]">{definition.key}</code></span>
                  <StatusPill tone={active ? "positive" : "neutral"}>{active ? "Assigned" : "Off"}</StatusPill>
                  <Button variant={active ? "quiet" : "secondary"} size="sm" disabled={pending || !selectedRole.active} onClick={() => toggle(definition.key)}>
                    {pending ? <LoaderCircle className="size-3 animate-spin" /> : active ? null : <Check className="size-3" />}
                    {active ? "Remove" : "Assign"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )) : <p className="rounded-[18px] border border-dashed border-[var(--line-strong)] p-8 text-center text-xs text-[var(--ink-faint)]">Create a job role before assigning operational capabilities.</p>}

      {message ? <p role="status" aria-live="polite" className="rounded-xl bg-[var(--canvas)] px-4 py-3 text-xs">{message}</p> : null}
      <p className="flex items-start gap-2 rounded-[16px] bg-[var(--accent-soft)]/50 p-4 text-xs leading-4 text-[var(--accent-strong)]"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Owners and Admins retain their existing administrative boundary. A job-role capability never grants user management, credentials, security settings, or owner approval powers.</p>
    </div>
  );
}
