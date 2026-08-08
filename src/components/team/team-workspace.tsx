"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  Filter,
  KeyRound,
  LockKeyhole,
  MailPlus,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  UserRoundPlus,
  UserX,
  X,
} from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { inviteUserAction, type AuthActionState } from "@/app/actions/auth";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoIds, demoWorkspace } from "@/lib/demo";
import {
  canInviteFromWorkspace,
  invitableRolesForActor,
  type WorkspaceContextValue,
  type WorkspaceLocation,
} from "@/lib/auth/workspace-context";
import {
  canAssignRole,
  canCreateUsers,
  canSuspendUser,
  canViewSensitiveField,
  type PermissionActor,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { AppRole, PersonProfile } from "@/types";

const demoInvitationActionIds = {
  organization: "11111111-1111-4111-8111-111111111111",
  garden: "22222222-2222-4222-8222-222222222221",
} as const;

const initialInviteState: AuthActionState = { status: "idle" };

const realPlaygroundPeople = demoWorkspace.people.filter((person) =>
  [demoIds.people.donald, demoIds.people.maris, demoIds.people.irini, demoIds.people.mateo].includes(person.id as never),
);

const roleLabel: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

const roleTone: Record<AppRole, "accent" | "positive" | "warning" | "neutral"> = {
  owner: "accent",
  admin: "positive",
  manager: "warning",
  employee: "neutral",
};

function availabilitySummary(person: PersonProfile) {
  const available = person.availability.filter((entry) => entry.available);
  if (available.length === 7) return "Open availability";
  return `${available.length} days available`;
}

function TeamRow({
  person,
  visibleLocations,
  selected,
  role,
  status,
  index,
  onSelect,
}: {
  person: PersonProfile;
  visibleLocations: WorkspaceLocation[];
  selected: boolean;
  role: AppRole;
  status: PersonProfile["status"];
  index: number;
  onSelect: () => void;
}) {
  const locations = visibleLocations.filter((location) => person.locationIds.includes(location.id));
  const jobs = demoWorkspace.jobRoles.filter((job) => person.jobRoleIds.includes(job.id));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "focus-ring group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[var(--line)] px-3 py-3.5 text-left transition-colors last:border-b-0 hover:bg-[var(--paper)] sm:px-4",
        selected && "bg-[var(--paper-strong)] shadow-[inset_3px_0_var(--accent)]",
      )}
    >
      <span className="relative">
        <Avatar name={person.displayName} index={index} />
        {status === "active" ? (
          <span className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-[var(--paper-strong)] bg-[var(--positive)]" aria-label="Active" />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold">{person.displayName}</span>
          {role === "owner" ? <ShieldCheck className="size-3.5 shrink-0 text-[var(--accent)]" aria-label="Owner" /> : null}
        </span>
        <span className="mt-1 block truncate text-[10px] text-[var(--ink-faint)]">
          {jobs.map((job) => job.name).join(" · ")} · {locations.map((location) => location.name.replace(" — Demo", "")).join(", ")}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {status !== "active" ? <StatusPill tone={status === "invited" ? "warning" : "danger"}>{status}</StatusPill> : null}
        <ChevronRight className={cn("size-3.5 text-[var(--ink-faint)] transition-transform", selected && "translate-x-0.5 text-[var(--ink)]")} />
      </span>
    </button>
  );
}

function InviteDialog({
  open,
  onClose,
  organizationId,
  locations,
  roles,
  actorRole,
  demo = false,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  locations: readonly Pick<WorkspaceLocation, "id" | "name">[];
  roles: readonly AppRole[];
  actorRole: AppRole;
  demo?: boolean;
}) {
  const [state, formAction, pending] = useActionState(inviteUserAction, initialInviteState);
  const defaultRole = roles.includes("employee") ? "employee" : roles[0];

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-title"
            className="w-full max-w-xl rounded-[24px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7"
            initial={{ y: 14, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 10, scale: 0.98 }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><MailPlus className="size-4" /></span>
                <h3 id="invite-title" className="mt-4 text-xl font-medium tracking-[-0.04em]">Invite a teammate</h3>
                <p className="mt-1 text-[11px] leading-5 text-[var(--ink-faint)]">They’ll receive a one-time invitation and create their own password. Existing passwords are never visible.</p>
              </div>
              <Button variant="quiet" size="icon" aria-label="Close invitation" onClick={onClose}><X className="size-4" /></Button>
            </div>

            <form action={formAction} className="mt-6 grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="organizationId" value={organizationId} />
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-semibold">Full name</span>
                <input name="fullName" required autoComplete="name" placeholder="New teammate" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs placeholder:text-[var(--ink-faint)]" />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-semibold">Work email</span>
                <input name="email" required type="email" autoComplete="email" placeholder={demo ? "teammate@example.invalid" : "teammate@restaurant.com"} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs placeholder:text-[var(--ink-faint)]" />
              </label>
              <label>
                <span className="mb-1.5 block text-[10px] font-semibold">Access role</span>
                <select name="role" defaultValue={defaultRole} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">
                  {roles.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-[10px] font-semibold">Primary location</span>
                <select name="locationId" defaultValue={locations[0]?.id} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">
                  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <div className="sm:col-span-2 rounded-xl bg-[var(--canvas)] px-3.5 py-3 text-[10px] leading-4 text-[var(--ink-faint)]">
                <span className="flex items-center gap-2 font-semibold text-[var(--ink-soft)]"><KeyRound className="size-3.5" /> Secure account handoff</span>
                <p className="mt-1">{actorRole === "admin" ? "Admins can invite admins, managers, and employees. Only an owner can grant owner access." : "Owners must use MFA before inviting or assigning access."}</p>
              </div>
              {state.status !== "idle" ? (
                <p role="status" aria-live="polite" className={cn("sm:col-span-2 rounded-xl px-3.5 py-3 text-[11px]", state.status === "success" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--danger-soft)] text-[var(--danger)]")}>
                  {state.message}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
                <Button variant="quiet" onClick={onClose}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={pending}>{pending ? "Preparing…" : "Send invitation"}</Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function DemoTeamWorkspace({ workspace }: { workspace: WorkspaceContextValue }) {
  const visibleLocations = workspace.locations as WorkspaceLocation[];
  const people = realPlaygroundPeople;
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string>(workspace.identity.userId);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleOverrides, setRoleOverrides] = useState<Record<string, AppRole>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, PersonProfile["status"]>>({});
  const [notice, setNotice] = useState("");

  const viewer: PermissionActor = {
    userId: workspace.identity.userId,
    organizationId: demoIds.organization,
    role: workspace.role,
    membershipStatus: "active",
    locationIds: workspace.locations.map((location) => location.id),
    organizationWide: workspace.organizationWide,
    mfaEnabled: true,
  };

  const filteredPeople = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return people.filter((person) => {
      const inScope = person.locationIds.some((locationId) => visibleLocations.some((location) => location.id === locationId));
      const role = roleOverrides[person.id] ?? person.primaryRole;
      const jobs = demoWorkspace.jobRoles.filter((job) => person.jobRoleIds.includes(job.id));
      const matchesQuery = !normalizedQuery || [person.displayName, person.email, ...jobs.map((job) => job.name)].some((value) => value.toLowerCase().includes(normalizedQuery));
      return inScope && matchesQuery && (roleFilter === "all" || role === roleFilter) && (locationFilter === "all" || person.locationIds.includes(locationFilter));
    });
  }, [locationFilter, people, query, roleFilter, roleOverrides, visibleLocations]);

  const selected = people.find((person) => person.id === selectedId) ?? filteredPeople[0] ?? people[0];
  const selectedRole = roleOverrides[selected.id] ?? selected.primaryRole;
  const selectedStatus = statusOverrides[selected.id] ?? selected.status;
  const selectedMembership = demoWorkspace.memberships.find((membership) => membership.userId === selected.id);
  const selectedJobs = demoWorkspace.jobRoles.filter((job) => selected.jobRoleIds.includes(job.id));
  const selectedLocations = visibleLocations.filter((location) => selected.locationIds.includes(location.id));
  const selectedTimeOff = demoWorkspace.timeOffRequests.filter((request) => request.personId === selected.id);
  const selectedCertifications = demoWorkspace.certifications.filter((certification) => certification.personId === selected.id);
  const selectedDocuments = demoWorkspace.employeeDocuments.filter((document) => document.personId === selected.id);
  const canManageRole = canAssignRole(viewer, selectedRole) && selected.id !== viewer.userId;
  const canSuspend = selectedMembership ? canSuspendUser(viewer, { userId: selected.id, organizationId: selectedMembership.organizationId, role: selectedRole }) : false;
  const canSeeEmergency = canViewSensitiveField(viewer, "emergency_contact", { organizationId: demoIds.organization, subjectUserId: selected.id });

  function updateRole(role: AppRole) {
    setRoleOverrides((current) => ({ ...current, [selected.id]: role }));
    setNotice(`${selected.displayName} now has ${roleLabel[role]} access in this demo.`);
  }

  function toggleSuspension() {
    const nextStatus = selectedStatus === "suspended" ? "active" : "suspended";
    setStatusOverrides((current) => ({ ...current, [selected.id]: nextStatus }));
    setNotice(`${selected.displayName} was ${nextStatus === "suspended" ? "suspended" : "reactivated"} in this demo.`);
  }

  const activeCount = people.filter((person) => (statusOverrides[person.id] ?? person.status) === "active").length;
  const managerCount = people.filter((person) => ["owner", "admin", "manager"].includes(roleOverrides[person.id] ?? person.primaryRole)).length;

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2"><StatusPill tone="positive" dot>{activeCount} active</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Le Yard users</span></div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Your whole team, in one place</h2>
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">Profiles, access, availability, and documents within your visible Le Yard scope.</p>
        </div>
        <Button variant="accent" onClick={() => setInviteOpen(true)} disabled={!canCreateUsers(viewer)}><UserRoundPlus className="size-4" /> Invite teammate</Button>
      </div>

      <section aria-label="Team metrics" className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Active team" value={String(activeCount)} detail={`${people.length - activeCount} pending or suspended`} />
        <Metric label="Leadership" value={String(managerCount)} detail="Owners and managers" />
        <Metric label="Locations" value={String(visibleLocations.length)} detail="Visible restaurant scope" />
        <Metric label="Needs review" value="3" detail="Time off, certificate, invitation" trend={{ label: "Action", tone: "negative" }} />
      </section>

      <div className="mt-6 grid min-h-[720px] overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper)] xl:grid-cols-[390px_minmax(0,1fr)]">
        <section className="border-b border-[var(--line)] xl:border-r xl:border-b-0" aria-label="Team directory">
          <div className="space-y-3 border-b border-[var(--line)] p-4">
            <label className="relative block">
              <span className="sr-only">Search team</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ink-faint)]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Search people or roles" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-3 pl-10 text-xs placeholder:text-[var(--ink-faint)]" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="relative">
                <span className="sr-only">Filter by role</span>
                <Filter className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | AppRole)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-2 pl-9 text-[10px]">
                  <option value="all">All access roles</option>
                  {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Filter by location</span>
                <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-[10px]">
                  <option value="all">All locations</option>
                  {visibleLocations.map((location) => <option key={location.id} value={location.id}>{location.name.replace(" — Demo", "")}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="max-h-[690px] overflow-y-auto">
            {filteredPeople.map((person, index) => <TeamRow key={person.id} person={person} visibleLocations={visibleLocations} index={index} selected={selected.id === person.id} role={roleOverrides[person.id] ?? person.primaryRole} status={statusOverrides[person.id] ?? person.status} onSelect={() => setSelectedId(person.id)} />)}
            {!filteredPeople.length ? <div className="px-5 py-14 text-center"><Search className="mx-auto size-5 text-[var(--ink-faint)]" /><p className="mt-3 text-xs font-semibold">No people match</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">Try a different search or filter.</p></div> : null}
          </div>
        </section>

        <aside className="min-w-0 bg-[var(--paper-strong)]" aria-label={`${selected.displayName} profile`}>
          <div className="border-b border-[var(--line)] p-5 sm:p-7">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
              <div className="flex items-center gap-4">
                <Avatar name={selected.displayName} size="lg" index={people.findIndex((person) => person.id === selected.id)} className="size-14 text-base" />
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-xl font-medium tracking-[-0.04em]">{selected.displayName}</h3><StatusPill tone={roleTone[selectedRole]}>{roleLabel[selectedRole]}</StatusPill><StatusPill tone={selectedStatus === "active" ? "positive" : selectedStatus === "invited" ? "warning" : "danger"} dot={selectedStatus === "active"}>{selectedStatus}</StatusPill></div><p className="mt-1 text-[11px] text-[var(--ink-faint)]">{selectedJobs.map((job) => job.name).join(" · ")} · joined {selected.hiredOn}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label>
                  <span className="sr-only">Access role</span>
                  <select value={selectedRole} onChange={(event) => updateRole(event.target.value as AppRole)} disabled={!canManageRole} className="h-9 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-55">
                    {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <Button variant="danger" size="sm" onClick={toggleSuspension} disabled={!canSuspend}>{selectedStatus === "suspended" ? <Check className="size-3.5" /> : <UserX className="size-3.5" />}{selectedStatus === "suspended" ? "Reactivate" : "Suspend"}</Button>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-[var(--ink-faint)]">
              <span className="flex items-center gap-1.5"><MailPlus className="size-3.5" />{selected.email}</span>
              <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{selected.phone}</span>
              <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{selectedLocations.map((location) => location.name.replace(" — Demo", "")).join(" · ")}</span>
            </div>
            {!canManageRole ? <p className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2.5 text-[10px] text-[var(--ink-faint)]"><LockKeyhole className="size-3.5" />Your own owner role is protected. Account ownership changes require another owner.</p> : null}
          </div>

          <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-2">
            <section>
              <SectionHeading eyebrow="Work pattern" title="Availability" detail={availabilitySummary(selected)} />
              <div className="grid grid-cols-7 gap-1.5" aria-label="Weekly availability">
                {selected.availability.map((entry) => <div key={entry.weekday} className={cn("rounded-xl border px-1 py-2.5 text-center", entry.available ? "border-[var(--positive)]/20 bg-[var(--positive-soft)]" : "border-[var(--line)] bg-[var(--canvas)]")}><p className="text-[9px] font-semibold">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][entry.weekday]}</p><p className={cn("mt-1 text-[8px]", entry.available ? "text-[var(--positive)]" : "text-[var(--ink-faint)]")}>{entry.available ? entry.startsAtLocal : "Off"}</p></div>)}
              </div>
              <div className="mt-5">
                <p className="text-[10px] font-semibold">Time off</p>
                {selectedTimeOff.length ? <div className="mt-2 space-y-2">{selectedTimeOff.map((request) => <div key={request.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-3"><div><p className="text-[10px] font-semibold capitalize">{request.kind}</p><p className="numeric mt-1 text-[9px] text-[var(--ink-faint)]">{request.startsOn}{request.endsOn !== request.startsOn ? `–${request.endsOn}` : ""}</p></div><StatusPill tone={request.status === "approved" ? "positive" : "warning"}>{request.status}</StatusPill></div>)}</div> : <p className="mt-2 text-[10px] text-[var(--ink-faint)]">No requests on file.</p>}
              </div>
            </section>

            <section>
              <SectionHeading eyebrow="Readiness" title="Certifications & documents" />
              <div className="space-y-2">
                {selectedCertifications.map((certification) => <div key={certification.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-3"><span className={cn("flex size-8 items-center justify-center rounded-xl", certification.status === "current" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--warning-soft)] text-[var(--warning)]")}><BadgeCheck className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-semibold">{certification.name}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{certification.expiresOn ? `Expires ${certification.expiresOn}` : "No expiry"}</p></div><StatusPill tone={certification.status === "current" ? "positive" : "warning"}>{certification.status}</StatusPill></div>)}
                {selectedDocuments.map((document) => <div key={document.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] px-3 py-3"><FileCheck2 className="size-4 text-[var(--ink-faint)]" /><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-semibold">{document.title}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Private · {Math.round(document.file.byteSize / 1000)} KB</p></div>{document.acknowledgedAt ? <Check className="size-3.5 text-[var(--positive)]" aria-label="Acknowledged" /> : null}</div>)}
                {!selectedCertifications.length && !selectedDocuments.length ? <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-7 text-center text-[10px] text-[var(--ink-faint)]">No certifications or documents attached.</div> : null}
              </div>
            </section>

            <section>
              <SectionHeading eyebrow="Private" title="Emergency contact" detail="Visible only to authorized management" />
              {canSeeEmergency && selected.emergencyContact ? <div className="rounded-2xl bg-[var(--canvas)] p-4"><p className="text-xs font-semibold">{selected.emergencyContact.name}</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">{selected.emergencyContact.relationship}</p><p className="numeric mt-3 flex items-center gap-2 text-[10px]"><Phone className="size-3.5 text-[var(--ink-faint)]" />{selected.emergencyContact.phone}</p></div> : <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-[10px] text-[var(--ink-faint)]">{selected.emergencyContact ? "You do not have permission to view this field." : "Not provided yet."}</div>}
            </section>

            <section>
              <SectionHeading eyebrow="Security" title="Account access" />
              <dl className="space-y-3 rounded-2xl border border-[var(--line)] p-4 text-[10px]"><div className="flex justify-between gap-4"><dt className="text-[var(--ink-faint)]">Sign-in</dt><dd className="font-semibold">{selected.authUserId ? "Active account" : "Invitation pending"}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--ink-faint)]">MFA</dt><dd className="font-semibold">{selectedMembership?.mfaEnabled ? "Enabled" : selectedRole === "owner" ? "Required" : "Available"}</dd></div><div className="flex justify-between gap-4"><dt className="text-[var(--ink-faint)]">Scope</dt><dd className="text-right font-semibold">{selectedMembership?.organizationWide ? "All locations" : `${selected.locationIds.length} location${selected.locationIds.length === 1 ? "" : "s"}`}</dd></div></dl>
            </section>
          </div>
        </aside>
      </div>

      <div aria-live="polite" className="mt-4 min-h-5 text-[10px] text-[var(--positive)]">{notice ? <span className="inline-flex items-center gap-2"><Check className="size-3.5" />{notice}</span> : null}</div>
      <div className="mt-2 flex items-start gap-3 rounded-2xl bg-[var(--accent-soft)]/40 px-4 py-3 text-[10px] leading-4 text-[var(--ink-soft)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-strong)]" /><span>Only owners and admins can create, invite, suspend, or assign access. Teammates set their own passwords; no password is stored or shown here.</span></div>
      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        organizationId={demoInvitationActionIds.organization}
        locations={[
          { id: demoInvitationActionIds.garden, name: "Le Yard" },
        ]}
        roles={invitableRolesForActor("owner")}
        actorRole="owner"
        demo
      />
    </PageFrame>
  );
}

function ConnectedTeamWorkspace({ workspace }: { workspace: WorkspaceContextValue }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const roles = invitableRolesForActor(workspace.role);
  const canInvite = canInviteFromWorkspace(workspace.role, workspace.identity.aal);
  const isAuthorizedRole = workspace.role === "owner" || workspace.role === "admin";
  const needsMfa = workspace.role === "owner" && workspace.identity.aal !== "aal2";

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="positive" dot>Connected</StatusPill>
            <span className="text-[10px] text-[var(--ink-faint)]">{workspace.organization.name}</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Secure team provisioning</h2>
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">Invite teammates into the server-verified organization and location scope.</p>
        </div>
        <Button
          variant="accent"
          onClick={() => setInviteOpen(true)}
          disabled={!canInvite}
        >
          <UserRoundPlus className="size-4" />
          Invite teammate
        </Button>
      </div>

      <section aria-label="Connected team access" className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Access role" value={roleLabel[workspace.role]} detail="Active organization membership" />
        <Metric label="Locations" value={String(workspace.locations.length)} detail={workspace.organizationWide ? "Organization-wide access" : "Assigned access"} />
        <Metric label="Current location" value={workspace.activeLocation.name} detail="Selected on the server" />
        <Metric label="Session" value={workspace.identity.aal.toUpperCase()} detail={workspace.identity.aal === "aal2" ? "MFA verified" : "Standard assurance"} />
      </section>

      <section className="mt-6 rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] p-6 sm:p-8">
        <div className="flex max-w-2xl items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            {isAuthorizedRole ? <ShieldCheck className="size-4" /> : <LockKeyhole className="size-4" />}
          </span>
          <div>
            <p className="eyebrow">Invitation authority</p>
            <h3 className="mt-2 text-lg font-medium tracking-[-0.035em]">
              {needsMfa
                ? "Complete MFA to invite teammates"
                : isAuthorizedRole
                  ? `${roleLabel[workspace.role]} access verified`
                  : "Owner or admin access is required"}
            </h3>
            <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
              {needsMfa
                ? "Owner invitations stay locked until this session reaches AAL2."
                : isAuthorizedRole
                  ? workspace.role === "admin"
                    ? "You can invite admins, managers, and employees. Owner access is not offered and is rejected server-side."
                    : "You can invite all access roles. New owners must enroll in MFA."
                  : "Managers and employees can view team operations, but cannot create accounts or assign access."}
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {workspace.locations.map((location) => (
            <div key={location.id} className="flex items-center gap-3 rounded-2xl bg-[var(--canvas)] px-4 py-3">
              <MapPin className="size-4 text-[var(--accent-strong)]" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">{location.name}</p>
                <p className="mt-0.5 text-[10px] text-[var(--ink-faint)]">Available invitation scope</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {canInvite ? (
        <InviteDialog
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          organizationId={workspace.organization.id}
          locations={workspace.locations}
          roles={roles}
          actorRole={workspace.role}
        />
      ) : null}
    </PageFrame>
  );
}

export function TeamWorkspace() {
  const workspace = useWorkspaceContext();
  return workspace.mode === "demo" ? (
    <DemoTeamWorkspace workspace={workspace} />
  ) : (
    <ConnectedTeamWorkspace workspace={workspace} />
  );
}
